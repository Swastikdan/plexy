import { beforeAll, describe, expect, test } from "bun:test";
import { initConfig } from "../src/config";
import { q, run, runMigrations } from "../src/db";
import {
  createUser,
  devAdminUsesDefaultPassword,
  ensureDevAdmin,
  loginUser,
  setupState,
} from "../src/accounts";

beforeAll(async () => {
  await runMigrations();
  await initConfig();
});

describe("development owner bootstrap", () => {
  test("creates admin/admin once and completes setup", async () => {
    const result = await ensureDevAdmin();
    expect(result.created).toBe(true);
    expect(result.alreadyApplied).toBe(false);

    const state = setupState();
    expect(state.ownerCreated).toBe(true);
    expect(state.setupComplete).toBe(true);

    const admin = await loginUser("admin", "admin");
    expect(admin?.username).toBe("admin");
    expect(admin?.role).toBe("admin");
    expect(await devAdminUsesDefaultPassword()).toBe(true);
  });

  test("later runs are a no-op: they never reset the password", async () => {
    await run(
      "UPDATE users SET password_hash=? WHERE username='admin'",
      await Bun.password.hash("a-changed-dev-password-9384"),
    );

    const result = await ensureDevAdmin();
    expect(result.created).toBe(false);
    expect(result.alreadyApplied).toBe(true);
    expect(await loginUser("admin", "admin")).toBeNull();
    expect(await loginUser("admin", "a-changed-dev-password-9384")).not.toBeNull();
    expect(await devAdminUsesDefaultPassword()).toBe(false);
  });

  test("the marker prevents recreating a deleted admin", async () => {
    run("DELETE FROM users WHERE username='admin'");
    const result = await ensureDevAdmin();
    expect(result.created).toBe(false);
    expect(result.alreadyApplied).toBe(true);
    expect(q("SELECT id FROM users WHERE username='admin'").get()).toBeNull();
  });

  test("the bypass is opt-in: normal user creation still enforces the rule", async () => {
    await expect(createUser("weak-user", "short")).rejects.toThrow();
  });
});
