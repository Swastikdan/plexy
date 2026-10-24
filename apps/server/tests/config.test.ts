import { describe, expect, test } from "bun:test";
import { getConfig, redactedView, save, APP_VERSION } from "../src/config";

describe("Server Config & Versioning (PRD 5.1)", () => {
  test("config contains current version matching APP_VERSION", async () => {
    const cfg = await getConfig();
    expect(cfg.version).toBe(APP_VERSION);
    expect(cfg.version).toBe("0.1.0");
  });

  test("redactedView projects safe settings without leaking secrets", async () => {
    const cfg = await getConfig();
    const safe = redactedView(cfg);

    expect(safe.version).toBe(APP_VERSION);
    expect(safe.port).toBe(cfg.port);
    expect(safe.bindAddress).toBe(cfg.bindAddress);
    expect(typeof safe.hasTmdbToken).toBe("boolean");
    // Secrets should never be present in the projected view
    expect((safe as Record<string, unknown>).tmdbToken).toBeUndefined();
  });

  test("save merges patch and retains version", async () => {
    const updated = await save({ note: "Test note" });
    expect(updated.note).toBe("Test note");
    expect(updated.version).toBe(APP_VERSION);

    const reloaded = await getConfig();
    expect(reloaded.note).toBe("Test note");
  });
});
