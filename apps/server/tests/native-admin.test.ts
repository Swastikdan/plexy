import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations, run } from "../src/db";
import { initConfig } from "../src/config";
import { createUser } from "../src/accounts";
import { createDevice, peekToken } from "../src/auth";

describe("native remote administration", () => {
  let app: ReturnType<typeof buildApp>;
  let owner: string;
  let viewer: string;
  let viewerId: number;
  const password = "native-admin-test-password";
  function request(
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
  ) {
    return app.handle(
      new Request(`https://plexy.example/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "192.168.1.42",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    const admin = await createUser("native-admin", password, "admin");
    const user = await createUser("native-viewer", password, "user");
    viewerId = user.id;
    owner = createDevice("Administrator phone", null, null, admin.id).token;
    viewer = createDevice("Viewer phone", null, null, user.id).token;
    app = buildApp({ requireAuth: true });
  });
  test("ordinary users cannot reach administration reads or mutations", async () => {
    for (const path of [
      "/settings",
      "/local-folders",
      "/matches/review",
      "/logs",
      "/crashes",
      "/optimize/status",
      "/stream-preparation/status",
      "/admin/artwork/storage",
      "/diagnostics/playback",
      "/auth/users",
      "/auth/admin/devices",
    ])
      expect((await request(path, viewer)).status).toBe(403);
    for (const [path, method, body] of [
      ["/settings", "PUT", { note: "forbidden" }],
      [
        "/libraries",
        "POST",
        { name: "forbidden", type: "movies", paths: ["/tmp"] },
      ],
      [
        "/libraries/123",
        "PATCH",
        { name: "forbidden", type: "movies", paths: ["/tmp"] },
      ],
      ["/libraries/123", "DELETE", undefined],
      ["/database/reset", "POST", undefined],
      ["/stream-preparation/cancel", "POST", undefined],
      ["/auth/admin/devices/1/revoke", "POST", undefined],
      ["/auth/admin/devices/1", "DELETE", undefined],
    ] as const)
      expect((await request(path, viewer, method, body)).status).toBe(403);
    expect((await request("/auth/admin/devices")).status).toBe(403);
  });
  test("admins see all accounts' devices without changing personal-device scope", async () => {
    const all = await request("/auth/admin/devices", owner);
    expect(all.status).toBe(200);
    const { devices } = await all.json();
    expect(
      devices.map((device: { username: string }) => device.username).sort(),
    ).toEqual(["native-admin", "native-viewer"]);
    expect(
      devices.every(
        (device: Record<string, unknown>) =>
          !("token" in device) && !("token_hash" in device),
      ),
    ).toBe(true);
    const own = await (await request("/auth/devices", viewer)).json();
    expect(own.devices).toHaveLength(1);
    expect(own.devices[0].userId).toBe(viewerId);
  });
  test("only admins can revoke another account's device, then remove its record", async () => {
    const device = createDevice("Viewer TV", null, null, viewerId);
    const ownerId = peekToken(owner)!.id;
    expect(
      (await request(`/auth/admin/devices/${ownerId}/revoke`, viewer, "POST"))
        .status,
    ).toBe(403);
    expect(peekToken(owner)).not.toBeNull();
    expect(
      (
        await request(
          `/auth/admin/devices/${device.device.id}`,
          owner,
          "DELETE",
        )
      ).status,
    ).toBe(409);
    expect(peekToken(device.token)).not.toBeNull();
    expect(
      (
        await request(
          `/auth/admin/devices/${device.device.id}/revoke`,
          owner,
          "POST",
        )
      ).status,
    ).toBe(200);
    expect(peekToken(device.token)).toBeNull();
    const revoked = await (await request("/auth/admin/devices", owner)).json();
    expect(
      revoked.devices.find(
        (entry: { id: number }) => entry.id === device.device.id,
      ).revoked,
    ).toBe(true);
    expect(
      (
        await request(
          `/auth/admin/devices/${device.device.id}`,
          owner,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    const removed = await (await request("/auth/admin/devices", owner)).json();
    expect(
      removed.devices.some(
        (entry: { id: number }) => entry.id === device.device.id,
      ),
    ).toBe(false);
    expect(
      (
        await request(
          `/auth/admin/devices/${device.device.id}/revoke`,
          owner,
          "POST",
        )
      ).status,
    ).toBe(404);
    expect(peekToken(viewer)).not.toBeNull();
  });
  test("admins can retire expired devices and devices belonging to disabled users", async () => {
    const user = await createUser("retired-viewer", password, "user");
    const expired = createDevice("Expired tablet", null, null, user.id);
    const disabled = createDevice("Disabled account TV", null, null, user.id);
    run(
      "UPDATE auth_devices SET expires_at=datetime('now','-1 day') WHERE id=?",
      expired.device.id,
    );
    run("UPDATE users SET disabled=1 WHERE id=?", user.id);
    for (const device of [expired, disabled]) {
      expect(
        (
          await request(
            `/auth/admin/devices/${device.device.id}/revoke`,
            owner,
            "POST",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            `/auth/admin/devices/${device.device.id}`,
            owner,
            "DELETE",
          )
        ).status,
      ).toBe(200);
    }
  });
  test("role changes and disabled accounts immediately lose server-wide device access", async () => {
    const admin = await createUser("temporary-admin", password, "admin");
    const token = createDevice(
      "Temporary admin TV",
      null,
      null,
      admin.id,
    ).token;
    expect((await request("/auth/admin/devices", token)).status).toBe(200);
    run("UPDATE users SET role='user' WHERE id=?", admin.id);
    expect((await request("/auth/admin/devices", token)).status).toBe(403);
    run("UPDATE users SET role='admin',disabled=1 WHERE id=?", admin.id);
    expect((await request("/auth/admin/devices", token)).status).toBe(403);
  });
  test("remote admins can read every server section and edit account restrictions", async () => {
    for (const path of [
      "/settings",
      "/matches/review",
      "/logs",
      "/crashes",
      "/optimize/status",
      "/stream-preparation/status",
      "/admin/artwork/storage",
      "/diagnostics/playback",
      "/libraries",
    ])
      expect((await request(path, owner)).status).toBe(200);
    expect(
      (
        await request(`/auth/users/${viewerId}`, owner, "PUT", {
          role: "user",
          disabled: false,
          maxAge: 13,
          blockUnrated: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/auth/users/${viewerId}/rules`, owner, "PUT", {
          rules: [{ scope: "folder", target: "/media/family", allowed: true }],
        })
      ).status,
    ).toBe(200);
    const permissions = await (
      await request(`/auth/users/${viewerId}/rules`, owner)
    ).json();
    expect(permissions.rules).toEqual([
      { scope: "folder", target: "/media/family", allowed: 1 },
    ]);
  });
});
