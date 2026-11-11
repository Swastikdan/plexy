/** Build standalone internal-test APKs. These use the template debug signing
 * identity and must never be submitted to a store. EAS production owns release signing.
 */
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateIcons } from "../generate-icon";
const root = resolve(import.meta.dir, "../..");
/**
 * CI uses the workflow run number so version codes match the release tag.
 * Local builds reserve 1000+ and increment, which keeps them installable on
 * top of older CI previews instead of being rejected as a downgrade.
 */
async function resolveBuildNumber() {
  const fromEnv = Number(
    Bun.env.PLEXY_BUILD_NUMBER || Bun.env.GITHUB_RUN_NUMBER || 0,
  );
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) {
    return fromEnv < 2000 ? 2000 + fromEnv : fromEnv;
  }

  const stateDir = resolve(root, ".build/native");
  const stateFile = resolve(stateDir, "build-number");
  let previous = 0;
  try {
    previous = Number((await readFile(stateFile, "utf8")).trim()) || 0;
  } catch {
    // First local build.
  }
  const next = Math.max(previous + 1, 2000);
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, `${next}\n`);
  return next;
}

const buildNumber = await resolveBuildNumber();
const env = {
  ...Bun.env,
  NODE_ENV: "production",
  PLEXY_BUILD_NUMBER: String(buildNumber),
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
  const targetVersion = JSON.parse(
    await readFile(resolve(cwd, "package.json"), "utf8"),
  ).version as string;
  await run(["bun", "run", "prebuild"], cwd);
  const fixedKeystore = resolve(root, "scripts/native/debug.keystore");
  try {
    await copyFile(fixedKeystore, resolve(cwd, "android/app/debug.keystore"));
  } catch (err) {
    console.warn("Could not copy fixed debug.keystore", err);
  }
  if (process.platform === "darwin") {
    await generateIcons();
  }
  await run(
    [
      Bun.env.PLEXY_GRADLE_BINARY || "./gradlew",
      ":app:assembleRelease",
      `-PreactNativeArchitectures=${Bun.env.PLEXY_ANDROID_ARCHITECTURES || "arm64-v8a"}`,
      `--max-workers=${Bun.env.PLEXY_GRADLE_WORKERS || "2"}`,
      "--build-cache",
      "--parallel",
    ],
    resolve(cwd, "android"),
  );
  const out = resolve(root, ".build/native");
  await mkdir(out, { recursive: true });
  const releaseApk = resolve(
    cwd,
    "android/app/build/outputs/apk/release/app-release.apk",
  );
  const artifact = resolve(out, `Plexy-mobile-v${targetVersion}-Android.apk`);
  await copyFile(releaseApk, artifact);
  console.log(
    `Internal preview APK: ${artifact} (Plexy ${targetVersion}, internal build ${buildNumber})`,
  );
}
