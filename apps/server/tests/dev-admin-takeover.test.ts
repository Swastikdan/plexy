import { beforeAll, expect, test } from "bun:test";
import { initConfig } from "@/config";
import { runMigrations } from "@/db";
import { createUser, ensureDevAdmin, loginUser } from "@/accounts";

beforeAll(async () => {
  await runMigrations();
  await initConfig();
});

test("an existing account named admin is never taken over or promoted", async () => {
  await createUser("admin", "the-real-admin-password-9384", "user", true);

  const result = await ensureDevAdmin();
  expect(result.created).toBe(false);
  expect(result.alreadyApplied).toBe(false);
  expect(result.usernameTaken).toBe(true);

  expect(await loginUser("admin", "admin")).toBeNull();
  const real = await loginUser("admin", "the-real-admin-password-9384");
  expect(real?.role).toBe("user");
});
