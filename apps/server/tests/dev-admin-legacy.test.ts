import { beforeAll, expect, test } from "bun:test";
import { initConfig } from "@/config";
import { runMigrations } from "@/db";
import {
  createUser,
  devAdminUsesDefaultPassword,
} from "@/accounts";

beforeAll(async () => {
  await runMigrations();
  await initConfig();
});

test("an admin/admin account without a marker is still detected", async () => {
  // Simulates a dev database created before the one-shot marker existed.
  await createUser("admin", "admin", "admin", true, true);
  expect(await devAdminUsesDefaultPassword()).toBe(true);
});
