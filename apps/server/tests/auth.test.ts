/// Authentication: the guard must block unauthenticated API access, while
/// status probing, local desktop login, pairing codes, and cookie sessions all
/// keep working.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations } from "../src/db";
import { initConfig } from "../src/config";
import { revokeDevice } from "../src/auth";

describe("device authentication", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    app = buildApp({ requireAuth: true, allowedOrigins: ["https://app.example.com"] });
  });

  test("unauthenticated API calls are rejected except the public status probe", async () => {
    const blocked = await app.handle(new Request("http://localhost:8765/api/home"));
    expect(blocked.status).toBe(401);
    expect((await blocked.json()).code).toBe("UNAUTHORIZED");
    expect(blocked.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);

    const stream = await app.handle(new Request("http://localhost:8765/api/stream/123"));
    expect(stream.status).toBe(401);

    const diagnostics = await app.handle(new Request("http://localhost:8765/api/diagnostics/playback"));
    expect(diagnostics.status).toBe(401);

    const queryToken = await app.handle(
      new Request("http://localhost:8765/api/home?token=not-a-credential"),
    );
    expect(queryToken.status).toBe(401);

    const status = await app.handle(
      new Request("http://localhost:8765/api/server/status"),
    );
    expect(status.status).toBe(200);
  });

  test("loopback local login returns a token and a session cookie", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/auth/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "test-desktop", name: "Test Desktop" }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.device.name).toBe("Test Desktop");

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("plexy_session=");
    expect(cookie).toContain("HttpOnly");

    // Bearer header.
    const withBearer = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Authorization: `Bearer ${body.token}` },
      }),
    );
    expect(withBearer.status).toBe(200);

    // Cookie session (used by <img>, <video>, and EventSource).
    const withCookie = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Cookie: `plexy_session=${encodeURIComponent(body.token)}` },
      }),
    );
    expect(withCookie.status).toBe(200);

    const me = await app.handle(
      new Request("http://localhost:8765/api/auth/me", {
        headers: { Authorization: `Bearer ${body.token}` },
      }),
    );
    expect(me.status).toBe(200);
    expect((await me.json()).device.name).toBe("Test Desktop");

    const queryCredential = await app.handle(
      new Request(`http://localhost:8765/api/home?token=${encodeURIComponent(body.token)}`),
    );
    expect(queryCredential.status).toBe(401);
  });

  test("a pairing code registers a device exactly once", async () => {
    const minted = await app.handle(
      new Request("http://localhost:8765/api/auth/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Living room TV" }),
      }),
    );
    expect(minted.status).toBe(200);
    const { code } = await minted.json();
    expect(code).toMatch(/^\d{6}$/);

    const paired = await app.handle(
      new Request("http://localhost:8765/api/auth/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "Living room TV" }),
      }),
    );
    expect(paired.status).toBe(200);
    const body = await paired.json();
    expect(body.device.name).toBe("Living room TV");
    expect(typeof body.serverId).toBe("string");

    const replay = await app.handle(
      new Request("http://localhost:8765/api/auth/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "Replay" }),
      }),
    );
    expect(replay.status).toBe(401);
  });

  test("revoking a device invalidates its token", async () => {
    const login = await app.handle(
      new Request("http://localhost:8765/api/auth/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "revoked-device", name: "Old Phone" }),
      }),
    );
    const body = await login.json();
    expect(body.device.id).toBeGreaterThan(0);

    revokeDevice(body.device.id);

    const denied = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Authorization: `Bearer ${body.token}` },
      }),
    );
    expect(denied.status).toBe(401);
  });

  test("wrong pairing codes are rejected", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/auth/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "000000", name: "Nope" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("401 responses keep CORS headers so a hosted client can read them", async () => {    const res = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Origin: "https://app.example.com" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("loopback auto-login is refused when a reverse proxy forwards the request", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/auth/local", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.9",
        },
        body: JSON.stringify({ name: "Tunneled" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("owner-only pairing management is refused through a local reverse proxy", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/auth/pairing-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.9",
        },
        body: JSON.stringify({ label: "Remote visitor" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("credentialed CORS is limited to configured origins", async () => {
    const allowed = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Origin: "https://app.example.com" },
      }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

    const denied = await app.handle(
      new Request("http://localhost:8765/api/home", {
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
