import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFingerprintAsync, DEFAULT_SOURCE_SKIPS, SourceSkips } from "@expo/fingerprint";
import { isAndroidBundleCurrent, needsMobileApk, otaMessage, readMobileDeliveryState, type ExpoDelivery } from "../../../scripts/native/mobile-delivery-state";
import { MOBILE_POLICY_URL, parseMobileManifest } from "../src/features/settings/lib/mobile-update-manifest";

const project = resolve(import.meta.dir, "..");
const root = resolve(project, "../..");
const stateDir = join(root, ".build/native");
const channel = "production";
const eas = ["bunx", "--package", "eas-cli@27.10.0", "eas"];
const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production", EXPO_NO_DOTENV: "1" };

async function run(command: string[], variables: Record<string, string | undefined>, capture = false) {
  const child = Bun.spawn(command, { cwd: project, env: variables, stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  const stdout = capture && child.stdout ? await new Response(child.stdout).text() : "";
  if (await child.exited) throw Error(`${command[0]} failed while preparing the Android release.`);
  return stdout;
}

async function hashFiles(directory: string, paths: string[]) {
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const contentHash = createHash("sha256").update(await readFile(join(directory, path))).digest("hex");
    hash.update(`${path}\0${contentHash}\n`);
  }
  return hash.digest("hex");
}

async function getNativeFingerprint() {
  const fingerprint = await createFingerprintAsync(project, {
    platforms: ["android"],
    // The native version is allocated only when an APK is built.
    sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigRuntimeVersionIfString,
    // Android is generated from the tracked Expo config and plugins.
    ignorePaths: ["android", "android/**"],
  });
  // Include native inputs that live outside Expo's inferred dependency graph.
  const inputs = await hashFiles(root, [
    "build/icon.png",
    "apps/mobile/assets/adaptive-monochrome.png",
    "apps/mobile/assets/splash-icon.png",
    "scripts/native/build-preview.ts",
    "scripts/native/gradle-jvmargs.cjs",
    "scripts/native/preview.keystore",
    "scripts/native/with-gradle-jvmargs.cjs",
    "scripts/native/with-open-source-licenses.cjs",
    "scripts/native/with-shared-build-inputs.cjs",
  ]);
  return createHash("sha256")
    .update(JSON.stringify([fingerprint.hash, inputs, env.PLEXY_ANDROID_ARCHITECTURES ?? "arm64-v8a"]))
    .digest("hex");
}

async function exportBundle(directory: string, variables: Record<string, string | undefined>) {
  await run(["bun", join(root, "scripts/native/generate-licenses.ts")], variables);
  await run(["bun", "run", "expo", "export", "--platform", "android", "--dump-assetmap", "--output-dir", directory], variables);
  const { fileMetadata: { android } } = await Bun.file(join(directory, "metadata.json")).json() as {
    fileMetadata: { android: { bundle: string; assets: { path: string; ext: string }[] } };
  };
  const files = await hashFiles(directory, android.assets.map(asset => asset.path));
  // Metro's bundle name hashes the JS before Hermes embeds its temporary source path.
  const assets = android.assets.map(({ path, ext }) => `${path}.${ext}`).sort();
  return createHash("sha256").update(JSON.stringify([android.bundle, assets, files])).digest("hex");
}

async function publishedApk() {
  const response = await fetch(MOBILE_POLICY_URL, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Cannot read the published Android APK policy (HTTP ${response.status}).`);
  const data = await response.json() as { ota?: unknown };
  return { version: parseMobileManifest(data).latestVersion, state: readMobileDeliveryState(data.ota) };
}

async function deliver(mode: string | undefined) {
  if (mode !== "publish" && mode !== "record-apk") throw Error("Expected publish or record-apk.");
  if (!env.PLEXY_EXPO_PROJECT_ID) throw Error("Set PLEXY_EXPO_PROJECT_ID to the linked Expo project UUID.");
  if (mode === "publish" && !env.EXPO_TOKEN) throw Error("Set EXPO_TOKEN in the Android delivery job.");
  const baseline = mode === "publish" ? await publishedApk() : undefined;
  if (mode === "publish" && (!baseline?.state || env.PLEXY_FORCE_APK === "true")) return "apk";

  const nativeFingerprint = await getNativeFingerprint();
  const policyHash = await hashFiles(project, ["mobile-release.json"]);
  if (mode === "publish" && needsMobileApk(baseline?.state, { nativeFingerprint, policyHash })) return "apk";
  const version = baseline?.version ?? env.PLEXY_MOBILE_VERSION;
  if (!version) throw Error("The Android build has no allocated version.");
  const runtimeVersion = baseline?.state?.runtimeVersion ?? `android-${createHash("sha256").update(`${nativeFingerprint}:${version}`).digest("hex")}`;

  await mkdir(stateDir, { recursive: true });
  const bundle = await mkdtemp(join(stateDir, "ota-export-"));
  try {
    const variables = { ...env, PLEXY_MOBILE_VERSION: version, PLEXY_ANDROID_RUNTIME: runtimeVersion };
    const bundleHash = await exportBundle(bundle, variables);
    if (mode === "record-apk") {
      await writeFile(join(stateDir, "mobile-delivery.json"), JSON.stringify({ nativeFingerprint, runtimeVersion, bundleHash, policyHash }));
      return "apk";
    }
    if (!baseline?.state) throw Error("The current APK has no OTA baseline.");
    const history = await run([...eas, "update:list", "--branch", channel, "--platform", "android", "--runtime-version", runtimeVersion, "--limit", "2", "--json", "--non-interactive"], variables, true);
    const { currentPage } = JSON.parse(history) as { currentPage: ExpoDelivery[] };
    if (isAndroidBundleCurrent(bundleHash, baseline.state.bundleHash, currentPage)) return "skip";

    await run([...eas, "update", "--channel", channel, "--platform", "android", "--environment", "production",
      "--input-dir", bundle, "--skip-bundler", "--message", otaMessage(bundleHash), "--non-interactive"], variables);
    return "ota";
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
}

const result = await deliver(process.argv[2]);
console.log(`Android delivery: ${result}`);
if (process.argv[2] === "publish" && env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `delivery=${result}\n`);
