import { expect, test } from "bun:test";
import { canFinishOnboarding, modePreferences, normalizeSource, restoredMode } from "@/core/client/watching-mode";
import { catalogForMode } from "@/core/client/mode-catalog";
import type { LocalCatalog } from "@/core/library/catalog-api";

test("fresh installs start onboarding and existing configured installs retain Hybrid", () => {
  expect(restoredMode({}, false)).toEqual({ mode: "hybrid", onboardingCompleted: false });
  expect(restoredMode({ source: "remote" }, false).onboardingCompleted).toBe(true);
  expect(restoredMode({ source: "local" }, true).onboardingCompleted).toBe(true);
  expect(restoredMode({ mode: "online", onboardingCompleted: true }, false)).toEqual({ mode: "online", onboardingCompleted: true });
  expect(restoredMode({ mode: "invalid" }, false).mode).toBe("hybrid");
});

test("only Local only requires a folder and each selection chooses a usable source", () => {
  expect(canFinishOnboarding("local", 0)).toBe(false);
  expect(canFinishOnboarding("local", 1)).toBe(true);
  expect(canFinishOnboarding("hybrid", 0)).toBe(true);
  expect(canFinishOnboarding("online", 0)).toBe(true);
  expect(modePreferences("local").source).toBe("device");
  expect(modePreferences("hybrid").source).toBe("all");
  expect(modePreferences("online").source).toBe("online");
});

test("online-only catalog hides existing media and preserves bound utility methods", async () => {
  const catalog = {
    value: { uri: "poster" },
    home() { throw Error("Local home should not run"); },
    items() { throw Error("Local items should not run"); },
    search() { throw Error("Local search should not run"); },
    image() { return this.value; },
  };
  const api = catalogForMode(catalog as unknown as LocalCatalog, "online");
  expect((await api.home()).rows).toEqual([]);
  expect((await api.items("all")).items).toEqual([]);
  expect((await api.search("movie")).titles).toEqual([]);
  expect(api.titlesByTmdb().size).toBe(0);
  expect(api.collections()).toEqual([]);
  expect(api.counts()).toEqual({ movie: 0, series: 0 });
  expect(api.image("test")).toEqual({ uri: "poster" });
  expect(catalogForMode(catalog as unknown as LocalCatalog, "hybrid")).toBe(catalog as unknown as LocalCatalog);
  expect(catalogForMode(catalog as unknown as LocalCatalog, "local")).toBe(catalog as unknown as LocalCatalog);
});


test("legacy sources migrate and mode rules stay explicit", () => {
  expect(normalizeSource("local", "hybrid")).toBe("device");
  expect(normalizeSource("remote", "hybrid")).toBe("online");
  expect(normalizeSource("remote", "local")).toBe("device");
  expect(normalizeSource("server", "local")).toBe("server");
  expect(normalizeSource("online", "local")).toBe("device");
  expect(normalizeSource(undefined, "hybrid")).toBe("all");
  expect(normalizeSource("nonsense", "online")).toBe("online");
});
