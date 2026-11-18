import { requiredGradleJvmArgs } from "./gradle-jvmargs.cjs";
import { createHash } from "node:crypto";
import { prepareMobileRelease } from "./prepare-mobile-release";
import { readMobileDeliveryState } from "./mobile-delivery-state";
/** Build standalone internal-test APKs. These use a dedicated preview signing
 * identity (never the public Android debug key, which OEM installers reject)
 * and must never be submitted to a store. EAS production owns release signing.
 */
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateIcons } from "../generate-icon";
const root = resolve(import.meta.dir, "../..");
const tmdbToken = Bun.env.EXPO_PUBLIC_TMDB_TOKEN || Bun.env.TMDB_TOKEN || Bun.env.TMDB_ACCESS_TOKEN || Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN;
if (!tmdbToken?.trim()) throw new Error("Mobile release requires TMDB_TOKEN (or EXPO_PUBLIC_TMDB_TOKEN) for bundled metadata credentials.");
const release = await prepareMobileRelease();
const env: Record<string, string | undefined> = {
  ...Bun.env,
  NODE_ENV: "production",
  EXPO_PUBLIC_TMDB_TOKEN: tmdbToken,
  PLEXY_MOBILE_VERSION: release.version,
};

async function run(command: string[], cwd: string) {
  const process = Bun.spawn(command, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await process.exited) !== 0)
    throw new Error(`Native build failed: ${command[0]}`);
}
{
  const target = "mobile";
  const cwd = resolve(root, "apps/mobile");
  const targetVersion = release.version;
  const out = resolve(root, ".build/native");
  let ota;
  if (env.PLEXY_EXPO_PROJECT_ID) {
    env.EXPO_NO_DOTENV = "1";
    await run(["bun", "scripts/delivery.ts", "record-apk"], cwd);
    ota = readMobileDeliveryState(await Bun.file(resolve(out, "mobile-delivery.json")).json());
    if (!ota) throw Error("Missing OTA metadata for the new Android build.");
    env.PLEXY_ANDROID_RUNTIME = ota.runtimeVersion;
  }
  await run(["bun", "run", "prebuild"], cwd);
  const previewKeystore = resolve(root, "scripts/native/preview.keystore");
  // Not the public Android debug key: ColorOS/OnePlus "Super Guard" refuses to
  // sideload APKs signed with CN=Android Debug. Keep this identity stable so
  // local and CI previews update each other instead of conflicting.
  await copyFile(previewKeystore, resolve(cwd, "android/app/debug.keystore"));
  if (process.platform === "darwin") {
    await generateIcons();
  }
  await run(
    [
      Bun.env.PLEXY_GRADLE_BINARY || "./gradlew",
      ":app:assembleRelease",
      `-PreactNativeArchitectures=${Bun.env.PLEXY_ANDROID_ARCHITECTURES || "arm64-v8a"}`,
      `--max-workers=${Bun.env.PLEXY_GRADLE_WORKERS || "2"}`,
      ...(Bun.env.PLEXY_GRADLE_JVMARGS
        ? [`-Dorg.gradle.jvmargs=${requiredGradleJvmArgs(Bun.env.PLEXY_GRADLE_JVMARGS)}`]
        : []),
      "--build-cache",
      "--parallel",
    ],
    resolve(cwd, "android"),
  );
  await mkdir(out, { recursive: true });
  const releaseApk = resolve(
    cwd,
    "android/app/build/outputs/apk/release/app-release.apk",
  );
  const artifact = resolve(out, `Plexy-mobile-v${targetVersion}-Android.apk`);
  await copyFile(releaseApk, artifact);
  const apk = await readFile(artifact);
  const apkName = artifact.split("/").at(-1)!;
  const manifest = {
    schemaVersion: 1, platform: "android", channel: "stable",
    latestVersion: release.version, versionCode: release.versionCode,
    updateType: release.updateType, minimumSupportedVersion: release.minimumSupportedVersion,
    title: `Plexy ${release.version}`, message: release.message, releaseNotes: release.releaseNotes,
    publishedAt: new Date().toISOString(), apkName, apkSize: apk.length,
    apkUrl: `https://github.com/Swastikdan/plexy/releases/download/mobile-v${release.version}/${apkName}`,
    sha256: createHash("sha256").update(apk).digest("hex"),
    ...(ota ? { ota } : {}),
  };
  await writeFile(resolve(out, "mobile-update.json"), JSON.stringify(manifest, null, 2));
  console.log(`Internal preview APK: ${artifact} (Plexy ${targetVersion})`);
}
