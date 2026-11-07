import { certificateInfo } from "./lan-tls";
import { Elysia, t } from "elysia";
import { db, q, run, type Row } from "./db";
import {
  createUser,
  getUser,
  hasOwner,
  listUsers,
  loginUser,
  revokeUserSessions,
  setupState,
  validateCredentials,
} from "./accounts";
import {
  clearSessionCookie,
  createDevice,
  createPairingCode,
  listDevices,
  revokeDevice,
  removeRevokedDevice,
  pairingAllowed,
  peekToken,
  redeemPairingCode,
  requestUser,
  revokeByToken,
  sessionCookie,
  tokenFromRequest,
} from "./auth";
import { isDirectLoopbackContext, remoteAddress } from "./essentials";
import { getServerId } from "./server-identity";

const error = (message: string, status = 400) =>
  Response.json({ error: message }, { status });
const credentials = t.Object({
  username: t.String({ minLength: 3, maxLength: 40 }),
  password: t.String({ minLength: 1, maxLength: 128 }),
  name: t.Optional(t.String({ maxLength: 80 })),
});
function signedIn(request: Request) {
  return requestUser(request);
}
function admin(request: Request) {
  return signedIn(request)?.role === "admin";
}
function result(request: Request, value: ReturnType<typeof createDevice>) {
  return Response.json(
    { ...value, user: getUser(value.device.userId), serverId: getServerId() },
    {
      headers: {
        "Set-Cookie": sessionCookie(request, value.token),
        "Cache-Control": "no-store",
      },
    },
  );
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .get("/setup", () => setupState())
  .get("/certificate", ({ request }) => {
    if (!signedIn(request)) return error("Sign in first.", 401);
    const info = certificateInfo();
    return info ? { fingerprint: info.fingerprint } : { fingerprint: null };
  })
  .post(
    "/setup/owner",
    async (ctx) => {
      if (!isDirectLoopbackContext(ctx))
        return error(
          "Create the owner account on the computer running Plexy.",
          403,
        );
      if (hasOwner())
        return error("The owner account has already been created.", 409);
      if (!pairingAllowed("owner-setup"))
        return error("Too many attempts. Try again later.", 429);
      const invalid = validateCredentials(ctx.body.username, ctx.body.password);
      if (invalid) return error(invalid);
      try {
        const user = await createUser(
          ctx.body.username,
          ctx.body.password,
          "admin",
          true,
        );
        return result(
          ctx.request,
          createDevice(
            ctx.body.name || "Server owner",
            null,
            remoteAddress(ctx),
            user.id,
          ),
        );
      } catch {
        return error(
          "The owner account could not be created or already exists.",
          409,
        );
      }
    },
    { body: credentials },
  )
  .post(
    "/setup/progress",
    (ctx) => {
      if (!admin(ctx.request))
        return error("Administrator access required.", 403);
      if (setupState().setupComplete)
        return error("Setup is already complete.", 409);
      run(
        "UPDATE server_setup SET step = MAX(step,?) WHERE id=1",
        ctx.body.step,
      );
      return setupState();
    },
    { body: t.Object({ step: t.Integer({ minimum: 1, maximum: 4 }) }) },
  )
  .post("/setup/complete", ({ request }) => {
    if (!admin(request)) return error("Administrator access required.", 403);
    run(
      "UPDATE server_setup SET completed_at=COALESCE(completed_at,datetime('now')), step=4 WHERE id=1",
    );
    return setupState();
  })
  .get("/me", ({ request }) => {
    const token = tokenFromRequest(request);
    const device = token ? peekToken(token) : null;
    const user = device ? getUser(device.userId) : null;
    return user && device
      ? { authenticated: true, device, user }
      : Response.json({ authenticated: false }, { status: 401 });
  })
  .post(
    "/login",
    async (ctx) => {
      // A shared limiter also bounds distributed guessing and expensive password hashing.
      if (
        !pairingAllowed("password-login", 120) ||
        !pairingAllowed(`login:${remoteAddress(ctx)}`)
      )
        return error("Too many attempts. Wait a minute.", 429);
      const user = await loginUser(ctx.body.username, ctx.body.password);
      if (!user) return error("Incorrect username or password.", 401);
      return result(
        ctx.request,
        createDevice(
          ctx.body.name || "Signed-in device",
          null,
          remoteAddress(ctx),
          user.id,
        ),
      );
    },
    { body: credentials },
  )
  .post("/local", () => error("Sign in with your username and password.", 403))
  .post(
    "/pair",
    (ctx) => {
      if (
        !pairingAllowed("pairing-global", 120) ||
        !pairingAllowed(`pair:${remoteAddress(ctx)}`)
      )
        return error("Too many attempts. Wait a minute.", 429);
      const paired = redeemPairingCode(
        ctx.body.code,
        ctx.body.name || "Paired device",
        null,
        remoteAddress(ctx),
      );
      return paired
        ? result(ctx.request, paired)
        : error("The pairing code is invalid, expired, or already used.", 401);
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 100 }),
        name: t.Optional(t.String({ maxLength: 80 })),
      }),
    },
  )
  .post(
    "/pairing-code",
    (ctx) => {
      const user = signedIn(ctx.request);
      if (!user) return error("Sign in first.", 401);
      if (!pairingAllowed(`mint:${user.id}`))
        return error("Too many attempts. Wait a minute.", 429);
      // Password confirmation prevents an unattended session from issuing a new credential.
      return loginUser(user.username, ctx.body.password).then((confirmed) =>
        confirmed
          ? createPairingCode("New device", user.id)
          : error("Incorrect password.", 401),
      );
    },
    { body: t.Object({ password: t.String({ maxLength: 128 }) }) },
  )
  .post("/logout", ({ request }) => {
    const token = tokenFromRequest(request);
    if (token) revokeByToken(token);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": clearSessionCookie(request) } },
    );
  })
  .get("/admin/devices", ({ request }) => {
    if (!admin(request)) return error("Administrator access required.", 403);
    const users = new Map(listUsers().map((user) => [user.id, user.username]));
    return {
      devices: listDevices().map((device) => ({
        ...device,
        username: users.get(device.userId) ?? "Deleted account",
      })),
    };
  })
  .post("/admin/devices/:id/revoke", ({ request, params }) => {
    if (!admin(request)) return error("Administrator access required.", 403);
    if (!revokeDevice(Number(params.id)))
      return error("Unrevoked device not found.", 404);
    return { ok: true };
  })
  .delete("/admin/devices/:id", ({ request, params }) => {
    if (!admin(request)) return error("Administrator access required.", 403);
    if (!removeRevokedDevice(Number(params.id)))
      return error("Revoke the device before deleting its record.", 409);
    return { ok: true };
  })
  .get("/devices", ({ request }) => {
    const user = signedIn(request);
    if (!user) return error("Sign in first.", 401);
    return {
      devices: listDevices().filter((device) => device.userId === user.id),
    };
  })
  .post("/devices/:id/revoke", ({ request, params }) => {
    const user = signedIn(request);
    if (!user) return error("Sign in first.", 401);
    run(
      "UPDATE auth_devices SET revoked=1 WHERE id=? AND user_id=?",
      Number(params.id),
      user.id,
    );
    return { ok: true };
  })
  .delete("/devices/:id", ({ request, params }) => {
    const user = signedIn(request);
    if (!user) return error("Sign in first.", 401);
    run(
      "DELETE FROM auth_devices WHERE id=? AND user_id=? AND revoked=1",
      Number(params.id),
      user.id,
    );
    return { ok: true };
  })
  .post(
    "/password",
    async ({ request, body }) => {
      const user = signedIn(request);
      if (!user) return error("Sign in first.", 401);
      if (!pairingAllowed(`password:${user.id}`))
        return error("Too many attempts. Wait a minute.", 429);
      const invalid = validateCredentials(user.username, body.newPassword);
      if (invalid) return error(invalid);
      if (!(await loginUser(user.username, body.password)))
        return error("Incorrect password.", 401);
      const hash = await Bun.password.hash(body.newPassword, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 3,
      });
      db.transaction(() => {
        run("UPDATE users SET password_hash=? WHERE id=?", hash, user.id);
        revokeUserSessions(user.id);
      })();
      return result(
        request,
        createDevice("Signed-in device", null, null, user.id),
      );
    },
    {
      body: t.Object({
        password: t.String({ maxLength: 128 }),
        newPassword: t.String({ minLength: 12, maxLength: 128 }),
      }),
    },
  )
  .get("/users", ({ request }) =>
    admin(request)
      ? { users: listUsers() }
      : error("Administrator access required.", 403),
  )
  .post(
    "/users",
    async ({ request, body }) => {
      if (!admin(request)) return error("Administrator access required.", 403);
      const invalid = validateCredentials(body.username, body.password);
      if (invalid) return error(invalid);
      try {
        return {
          user: await createUser(body.username, body.password, body.role),
        };
      } catch {
        return error("That username is already taken.", 409);
      }
    },
    {
      body: t.Object({
        ...credentials.properties,
        role: t.Union([t.Literal("user"), t.Literal("admin")]),
      }),
    },
  )
  .put(
    "/users/:id",
    ({ request, params, body }) => {
      const actor = signedIn(request);
      if (actor?.role !== "admin")
        return error("Administrator access required.", 403);
      const id = Number(params.id);
      if (!getUser(id)) return error("User not found.", 404);
      if (actor.id === id && (body.disabled || body.role !== "admin"))
        return error(
          "You cannot disable or demote your own administrator account.",
        );
      db.transaction(() => {
        run(
          "UPDATE users SET role=?,disabled=?,max_age=?,block_unrated=? WHERE id=?",
          body.role,
          body.disabled ? 1 : 0,
          body.maxAge,
          body.blockUnrated ? 1 : 0,
          id,
        );
        // Changing roles or disabling a user invalidates credentials immediately.
        if (body.disabled) revokeUserSessions(id);
      })();
      return { user: getUser(id) };
    },
    {
      body: t.Object({
        role: t.Union([t.Literal("user"), t.Literal("admin")]),
        disabled: t.Boolean(),
        maxAge: t.Union([t.Null(), t.Integer({ minimum: 0, maximum: 21 })]),
        blockUnrated: t.Boolean(),
      }),
    },
  )
  .get("/users/:id/rules", ({ request, params }) =>
    admin(request)
      ? {
          rules: q<Row>(
            "SELECT scope,target,allowed FROM access_rules WHERE user_id=?",
          ).all(Number(params.id)),
        }
      : error("Administrator access required.", 403),
  )
  .put(
    "/users/:id/rules",
    ({ request, params, body }) => {
      if (!admin(request)) return error("Administrator access required.", 403);
      if (!getUser(Number(params.id))) return error("User not found.", 404);
      db.transaction(() => {
        run("DELETE FROM access_rules WHERE user_id=?", Number(params.id));
        for (const rule of body.rules)
          run(
            "INSERT INTO access_rules(user_id,scope,target,allowed) VALUES(?,?,?,?)",
            Number(params.id),
            rule.scope,
            rule.target,
            rule.allowed ? 1 : 0,
          );
      })();
      return { ok: true };
    },
    {
      body: t.Object({
        rules: t.Array(
          t.Object({
            scope: t.Union([
              t.Literal("library"),
              t.Literal("folder"),
              t.Literal("item"),
            ]),
            target: t.String({ minLength: 1, maxLength: 1000 }),
            allowed: t.Boolean(),
          }),
          { maxItems: 500 },
        ),
      }),
    },
  );
