import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations, q, run, type Row } from "../src/db";
import { initConfig } from "../src/config";
import { createDevice, peekToken, redeemPairingCode } from "../src/auth";
import { createUser, getUser, setupState } from "../src/accounts";
import { accessGuard, canAccessItem, certificationAge } from "../src/access";

describe("accounts and scoped pairing", () => {
  let app: ReturnType<typeof buildApp>;
  let owner: string;
  let userToken: string;
  let userId: number;
  const password = "a-long-test-password-9384";
  const request = (
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) =>
    app.handle(
      new Request(`http://localhost:8765/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    app = buildApp({ requireAuth: true });
  });
  test("first-run owner setup is atomic, password required, and local auto-login is closed", async () => {
    expect((await request("/home")).status).toBe(401);
    expect((await request("/auth/local", undefined, {})).status).toBe(403);
    const weak = await request("/auth/setup/owner", undefined, {
      username: "owner-test",
      password: "short",
    });
    expect(weak.status).toBe(400);
    const [a, b] = await Promise.all([
      request("/auth/setup/owner", undefined, {
        username: "owner-test",
        password,
      }),
      request("/auth/setup/owner", undefined, {
        username: "owner-race",
        password,
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const result = await (a.status === 200 ? a : b).json();
    owner = result.token;
    expect(result.user.role).toBe("admin");
    expect(result.user).not.toHaveProperty("password_hash");
    expect(setupState().ownerCreated).toBe(true);
    const hash = q<Row>("SELECT password_hash FROM users WHERE id=?").get(
      result.user.id,
    )!;
    expect(String(hash.password_hash).startsWith("$argon2id$")).toBe(true);
    expect(
      (
        await request("/auth/setup/owner", undefined, {
          username: "intruder",
          password,
        })
      ).status,
    ).toBe(409);
  });
  test("setup completion persists independently of metadata and cannot be reset", async () => {
    expect(
      (await request("/auth/setup/progress", owner, { step: 2 })).status,
    ).toBe(200);
    expect((await request("/auth/setup/complete", owner, {})).status).toBe(200);
    expect(setupState().setupComplete).toBe(true);
    expect(
      (await request("/auth/setup/progress", owner, { step: 1 })).status,
    ).toBe(409);
    const restarted = buildApp({ requireAuth: true });
    const res = await restarted.handle(
      new Request("http://localhost:8765/api/auth/setup"),
    );
    expect((await res.json()).setupComplete).toBe(true);
  });
  test("administrator creates users; no credential can change its own account identity", async () => {
    const response = await request("/auth/users", owner, {
      username: "viewer-test",
      password,
      role: "user",
    });
    expect(response.status).toBe(200);
    userId = (await response.json()).user.id;
    const login = await request("/auth/login", undefined, {
      username: "viewer-test",
      password,
    });
    expect(login.status).toBe(200);
    userToken = (await login.json()).token;
    expect((await request("/auth/users", userToken)).status).toBe(403);
    expect((await request("/settings", userToken)).status).toBe(403);
    expect(
      (
        await request("/auth/login", undefined, {
          username: "viewer-test",
          password: "incorrect",
        })
      ).status,
    ).toBe(401);
    expect((await request("/auth/me", userToken)).status).toBe(200);
  });
  test("pairing keys require the current password, never target another user, and are single-use", async () => {
    expect(
      (await request("/auth/pairing-code", undefined, { password })).status,
    ).toBe(401);
    expect(
      (
        await request("/auth/pairing-code", owner, {
          password: "wrong",
          userId,
        })
      ).status,
    ).toBe(401);
    const minted = await request("/auth/pairing-code", owner, {
      password,
      userId,
    });
    expect(minted.status).toBe(200);
    const key = (await minted.json()).code;
    expect(key).toMatch(/^\d{6}$/);
    const [first, second] = await Promise.all([
      request("/auth/pair", undefined, { code: `${key.slice(0, 3)} ${key.slice(3)}`, userId }),
      request("/auth/pair", undefined, { code: key, userId }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);
    const paired = await (first.status === 200 ? first : second).json();
    expect(paired.user.role).toBe("admin");
    expect(paired.user.id).not.toBe(userId);
    const own = await request("/auth/pairing-code", userToken, { password });
    const ownKey = (await own.json()).code;
    const next = await request("/auth/pairing-code", userToken, { password });
    expect(redeemPairingCode(ownKey, "Expired previous key")).toBeNull();
    const nextKey = (await next.json()).code;
    run(
      "UPDATE auth_pairing SET expires_at=datetime('now','-1 second') WHERE user_id=?",
      userId,
    );
    expect(
      (await request("/auth/pair", undefined, { code: nextKey })).status,
    ).toBe(401);
  });
  test("six-digit codes preserve leading zeros and reject malformed input", () => {
    const ownerId = peekToken(owner)!.userId;
    const code = "000123";
    run(
      "INSERT INTO auth_pairing(code_hash,label,user_id,expires_at) VALUES(?,?,?,datetime('now','+10 minutes'))",
      new Bun.CryptoHasher("sha256").update(code).digest("hex"),
      "Leading zero test",
      ownerId,
    );
    for (const invalid of ["00123", "0001234", "abc123", "000.123"])
      expect(redeemPairingCode(invalid, "Invalid code")).toBeNull();
    const paired = redeemPairingCode("000-123", "Numeric code");
    expect(paired?.device.userId).toBe(ownerId);
    expect(paired?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redeemPairingCode(code, "Already used")).toBeNull();
  });
  test("library and maturity restrictions protect direct media and metadata paths", async () => {
    run(
      "INSERT INTO libraries(id,name,type) VALUES(8001,'Accounts test','movies')",
    );
    for (const [id, cert] of [
      [8001, "PG"],
      [8002, "TV-MA"],
      [8003, null],
    ] as const) {
      run(
        "INSERT INTO items(id,library_id,kind,name,sort_title,match_status) VALUES(?,8001,'movie',?,'test','matched')",
        id,
        `Title ${id}`,
      );
      run(
        "INSERT INTO item_metadata(item_id,certification) VALUES(?,?)",
        id,
        cert,
      );
      run(
        "INSERT INTO media_files(id,library_id,item_id,path,folder_key,size,mtime) VALUES(?,8001,?,?,'movies',100,1)",
        id,
        id,
        `/media/test/${id}.mp4`,
      );
    }
    expect((await request("/items/8001", userToken)).status).toBe(404);
    expect(
      (
        await request(
          "/auth/users/" + userId + "/rules",
          owner,
          { rules: [{ scope: "library", target: "8001", allowed: true }] },
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/auth/users/" + userId,
          owner,
          { role: "user", disabled: false, maxAge: 13, blockUnrated: true },
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect((await request("/items/8001", userToken)).status).toBe(200);
    for (const path of [
      "/items/8002",
      "/stream/8002",
      "/download/8002",
      "/download/8002/info",
      "/subtitles/8002",
      "/trickplay/8002/track.vtt",
      "/items/8003",
    ])
      expect((await request(path, userToken)).status).toBe(404);
    const items = await (
      await request("/items?libraryId=8001", userToken)
    ).json();
    expect(items.items.map((item: any) => item.id)).toEqual([8001]);
    expect(certificationAge("PG-13")).toBe(13);
    expect(certificationAge("U/A 16+")).toBe(16);
    expect(certificationAge("unknown")).toBeNull();
    expect(canAccessItem(getUser(userId), 8001)).toBe(true);
    run(
      "INSERT INTO access_rules(user_id,scope,target,allowed) VALUES(?,'item','8001',0)",
      userId,
    );
    expect((await request("/items/8001", userToken)).status).toBe(404);
    run("DELETE FROM access_rules WHERE user_id=? AND scope='item'", userId);
  });
  test("remote administrators can manage settings while viewers cannot", async () => {
    const remote = (token: string, method = "GET", body?: unknown) => app.handle(
      new Request("https://plexy.example/api/settings", {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Forwarded-For": "192.168.1.50" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    expect((await remote(owner)).status).toBe(200);
    expect((await remote(owner, "PUT", { note: "Managed from mobile" })).status).toBe(200);
    expect((await (await remote(owner)).json()).settings.note).toBe("Managed from mobile");
    expect((await remote(userToken)).status).toBe(403);
    expect((await remote(userToken, "PUT", { note: "Forbidden" })).status).toBe(403);
    const guard = (path: string, method: string) => accessGuard({ server: null, request: new Request(`https://plexy.example/api${path}`, { method, headers: { Authorization: `Bearer ${userToken}` } }) });
    expect(guard("/download/8001/info", "GET")).toBeUndefined();
    expect((await request("/download/8002", userToken, undefined, "HEAD")).status).toBe(404);
    expect(guard("/download/8001", "HEAD")).toBeUndefined();
  });
  test("watch progress and device revocation are scoped to one user", async () => {
    expect(
      (
        await request("/progress", userToken, {
          itemId: 8001,
          position: 50,
          duration: 100,
          played: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/progress", owner, {
          itemId: 8001,
          position: 25,
          duration: 100,
          played: false,
        })
      ).status,
    ).toBe(200);
    const rows = q<Row>(
      "SELECT user_id,position_seconds FROM watch_state WHERE item_id=8001",
    ).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.user_id === userId)?.position_seconds).toBe(
      50,
    );
    const ownerDevice = peekToken(owner)!;
    expect(
      (await request(`/auth/devices/${ownerDevice.id}/revoke`, userToken, {}))
        .status,
    ).toBe(200);
    expect(peekToken(owner)).not.toBeNull();
    const own = await (await request("/auth/devices", userToken)).json();
    expect(own.devices.every((device: any) => device.userId === userId)).toBe(
      true,
    );
  });
  test("folder grants honor path boundaries and exclusions, including direct artwork", async () => {
    const folderUser = await createUser("folder-user", password);
    run(
      "UPDATE media_files SET path='/media/test/private/adult.mp4' WHERE id=8002",
    );
    run(
      "UPDATE media_files SET path='/media/testing/sibling.mp4' WHERE id=8003",
    );
    run(
      "INSERT INTO access_rules(user_id,scope,target,allowed) VALUES(?,'folder','/media/test',1)",
      folderUser.id,
    );
    run(
      "INSERT INTO access_rules(user_id,scope,target,allowed) VALUES(?,'folder','/media/test/private',0)",
      folderUser.id,
    );
    run(
      "INSERT INTO access_rules(user_id,scope,target,allowed) VALUES(?,'item','8002',1)",
      folderUser.id,
    );
    expect(canAccessItem(folderUser, 8001)).toBe(true);
    expect(canAccessItem(folderUser, 8002)).toBe(false);
    expect(canAccessItem(folderUser, 8003)).toBe(false);
    run(
      "INSERT INTO artwork(id,item_id,kind,source,url) VALUES(8002,8002,'poster','tmdb','/hidden.jpg')",
    );
    const credential = createDevice("Folder user", null, null, folderUser.id);
    expect((await request("/images/8002", credential.token)).status).toBe(404);
    const cookie = await app.handle(
      new Request("http://localhost:8765/api/items/8002", {
        headers: { cookie: `plexy_session=${credential.token}` },
      }),
    );
    expect(cookie.status).toBe(404);
    run(
      "INSERT INTO media_files(id,library_id,item_id,path,folder_key,size,mtime) VALUES(8021,8001,8001,'/unshared/copy.mp4','other',100,1)",
    );
    expect((await request("/stream/8021", credential.token)).status).toBe(404);
    const detail = await (
      await request("/items/8001", credential.token)
    ).json();
    expect(detail.file.fileId).toBe(8001);
  });
  test("password changes revoke other sessions and pending pairing keys only for that user", async () => {
    const otherSession = createDevice(
      "Other viewer session",
      null,
      null,
      userId,
    );
    const code = (
      await (
        await request("/auth/pairing-code", userToken, { password })
      ).json()
    ).code;
    const response = await request("/auth/password", userToken, {
      password,
      newPassword: "new-test-password-9384",
    });
    expect(response.status).toBe(200);
    const replacement = (await response.json()).token;
    expect(peekToken(userToken)).toBeNull();
    expect(peekToken(otherSession.token)).toBeNull();
    expect(peekToken(replacement)?.userId).toBe(userId);
    expect(redeemPairingCode(code, "No longer valid")).toBeNull();
    expect(peekToken(owner)).not.toBeNull();
  });
  test("disabled accounts, legacy tokens, and revoked sessions cannot authenticate", async () => {
    const extra = await createUser("disabled-test", password);
    const credential = createDevice("disabled", null, null, extra.id);
    run("UPDATE users SET disabled=1 WHERE id=?", extra.id);
    expect(peekToken(credential.token)).toBeNull();
    expect((await request("/home", credential.token)).status).toBe(401);
    expect((await request("/home?token=" + owner)).status).toBe(401);
  });
});
