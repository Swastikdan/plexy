import { expect, test } from "bun:test";
import { isUpdateRequired, manifestUpdate, mergeMobilePolicy, parseMobileManifest, type MobileUpdateManifest } from "../src/features/settings/lib/mobile-update-manifest";
import { nextMobileVersion, mobileVersionCode } from "../../../scripts/native/mobile-version";
import { selectUpdate } from "../src/features/settings/lib/update-policy";

function policy(version = "1.0.9", minimum = "1.0.0", updateType: MobileUpdateManifest["updateType"] = "optional"): MobileUpdateManifest {
  return { schemaVersion: 1, platform: "android", channel: "stable", latestVersion: version,
    versionCode: mobileVersionCode(version), minimumSupportedVersion: minimum, updateType,
    title: "Plexy", message: "Update", releaseNotes: "New features", publishedAt: "2026-11-15T00:00:00Z",
    apkName: `Plexy-mobile-v${version}-Android.apk`, apkSize: 100,
    apkUrl: `https://github.com/Swastikdan/plexy/releases/download/mobile-v${version}/Plexy-mobile-v${version}-Android.apk`, sha256: "a".repeat(64) };
}

test("optional and feature releases inform without imposing a new requirement", () => {
  for (const type of ["optional", "feature"] as const) {
    const manifest = parseMobileManifest(policy("1.0.9", "1.0.0", type));
    expect(manifestUpdate(manifest, "1.0.8", mobileVersionCode("1.0.8"))?.updateType).toBe(type);
    expect(isUpdateRequired(manifest, "1.0.8")).toBe(false);
  }
});
test("necessary updates remain mandatory below minimum, including after cached-policy restart or cancellation", () => {
  const cached = parseMobileManifest(JSON.parse(JSON.stringify(policy("1.0.9", "1.0.9", "necessary"))));
  expect(isUpdateRequired(cached, "1.0.8")).toBe(true);
  // Neither a cancelled installer nor merely downloading changes the installed version.
  expect(isUpdateRequired(cached, "1.0.8")).toBe(true);
  expect(isUpdateRequired(cached, "1.0.9")).toBe(false);
  expect(isUpdateRequired(cached, "1.1.0")).toBe(false);
  expect(manifestUpdate(cached, "1.0.9", mobileVersionCode("1.0.9"))).toBeNull();
});
test("later optional releases and stale responses cannot erase an enforced minimum", () => {
  const required = policy("1.0.9", "1.0.9", "necessary");
  const merged = mergeMobilePolicy(required, policy("1.0.10"));
  expect(merged.latestVersion).toBe("1.0.10");
  expect(isUpdateRequired(merged, "1.0.8")).toBe(true);
  expect(isUpdateRequired(merged, "1.0.9")).toBe(false);
  expect(mergeMobilePolicy(merged, required)).toEqual(merged);
});
test("malformed policies, untrusted assets, incompatible channels, and impossible cutoffs are rejected", () => {
  for (const patch of [
    { apkUrl: "https://evil.example/app.apk" }, { sha256: "bad" }, { channel: "beta" },
    { platform: "ios" }, { minimumSupportedVersion: "2.0.0" }, { apkSize: -1 },
    { versionCode: 1 }, { latestVersion: "1.0.9-beta.1" }, { publishedAt: "invalid" },
    { apkUrl: policy().apkUrl + "?redirect=evil" },
  ]) expect(() => parseMobileManifest({ ...policy(), ...patch })).toThrow();
});
test("version increments support patch, minor, and major; Android code stays above old builds", () => {
  expect(nextMobileVersion("1.0.8")).toBe("1.0.9");
  expect(nextMobileVersion("1.0.8", "")).toBe("1.0.9");
  expect(() => nextMobileVersion("1.0.8", "invalid")).toThrow();
  expect(nextMobileVersion("1.0.8", "minor")).toBe("1.1.0");
  expect(nextMobileVersion("1.0.8", "major")).toBe("2.0.0");
  expect(mobileVersionCode("1.0.9")).toBeGreaterThan(100_089_999);
  expect(() => nextMobileVersion("1.0.8", "patch", "1.0.8")).toThrow();
  expect(() => nextMobileVersion("1.0.99")).toThrow();
  expect(nextMobileVersion("1.0.99", "minor")).toBe("1.1.0");
  expect(() => mobileVersionCode("22.0.0")).toThrow();
});
test("new mobile semantic tags work without build suffixes, ignoring drafts and beta channels", () => {
  const release = { id: 1, tag_name: "mobile-v1.0.9", name: "Mobile", body: "", published_at: "", prerelease: false,
    assets: [{ name: policy().apkName, size: 100, browser_download_url: policy().apkUrl }] };
  expect(selectUpdate([release], "mobile", 9999, "1.0.8")?.version).toBe("1.0.9");
  expect(selectUpdate([{ ...release, draft: true }], "mobile", 1, "1.0.8")).toBeNull();
  expect(selectUpdate([{ ...release, prerelease: true }], "mobile", 1, "1.0.8")).toBeNull();
});

test("allocator reserves Git tags without drafts and preserves the mandatory cutoff", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { prepareMobileRelease } = await import("../../../scripts/native/prepare-mobile-release");
  const root = await mkdtemp(join(tmpdir(), "plexy-mobile-version-"));
  try {
    await mkdir(join(root, "apps/mobile"), { recursive: true });
    await writeFile(join(root, "apps/mobile/package.json"), JSON.stringify({ version: "1.0.8" }));
    await writeFile(join(root, "apps/mobile/mobile-release.json"), JSON.stringify({ updateType: "optional", minimumSupportedVersion: "1.0.0" }));
    const releases = [{ tag_name: "mobile-v1.0.9", draft: true }];
    const request = (async (url) => String(url).includes("api.github.com") ? Response.json(releases) : Response.json(policy("1.0.9", "1.0.9", "necessary"))) as typeof fetch;
    const refs = new Set<string>();
    let collision = true;
    const reserve = async (args: string[]) => {
      if (args.includes("-X")) {
        const ref = args.find((arg) => arg.startsWith("ref="))!.slice(4);
        if (collision) {
          collision = false;
          refs.add(ref);
          throw Error("Reference already exists");
        }
        refs.add(ref);
        return "";
      }
      expect(args.at(-1)).toContain("/git/matching-refs/tags/mobile-build/");
      return [...refs].join("\n");
    };
    const first = await prepareMobileRelease({ root, request, reserve, env: { GITHUB_SHA: "abc", PLEXY_VERSION_BUMP: "", PLEXY_UPDATE_TYPE: "" } });
    expect(first.version).toBe("1.0.11");
    expect(first.minimumSupportedVersion).toBe("1.0.9");
    const next = await prepareMobileRelease({ root, request, reserve, env: { GITHUB_SHA: "abc", PLEXY_UPDATE_TYPE: "necessary" } });
    expect(next.version).toBe("1.0.12");
    expect(next.minimumSupportedVersion).toBe("1.0.12");
    expect([...refs]).toEqual(["refs/tags/mobile-build/1.0.10", "refs/tags/mobile-build/1.0.11", "refs/tags/mobile-build/1.0.12"]);
    // An interrupted simultaneous allocation must fail rather than reusing a version.
    await mkdir(join(root, ".build/native/version.lock"));
    await expect(prepareMobileRelease({ root, request, reserve, env: {} })).rejects.toThrow("Another mobile build");
  } finally { await rm(root, { recursive: true, force: true }); }
});
