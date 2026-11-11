/** Build standalone internal-test APKs. These use the template debug signing
 * identity and must never be submitted to a store. EAS production owns release signing.
 */
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateIcons } from "../generate-icon";
const root = resolve(import.meta.dir, "../..");
const requested = process.argv[2] || "all";
if (!["all", "mobile", "tv"].includes(requested))
  throw new Error("Use mobile, tv, or all.");

const repoPackage = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as { version: string };
const version = repoPackage.version;

/**
 * CI uses the workflow run number so version codes match the release tag.
 * Local builds reserve 1000+ and increment, which keeps them installable on
 * top of older CI previews instead of being rejected as a downgrade.
 */
async function resolveBuildNumber() {
  const fromEnv = Number(
    Bun.env.PLEXY_BUILD_NUMBER || Bun.env.GITHUB_RUN_NUMBER || 0,
  );
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) return fromEnv;

  const stateDir = resolve(root, ".build/native");
  const stateFile = resolve(stateDir, "build-number");
  let previous = 0;
  try {
    previous = Number((await readFile(stateFile, "utf8")).trim()) || 0;
  } catch {
    // First local build.
  }
  const next = Math.max(previous + 1, 1000);
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

function artifactName(target: string, targetVersion: string) {
  const platform = target === "tv" ? "TV" : "mobile";
  return `Plexy-${platform}-v${targetVersion}-Android.apk`;
}

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
for (const target of requested === "all" ? ["mobile", "tv"] : [requested]) {
  const cwd = resolve(root, "apps", target);
  const targetVersion = target === "mobile"
    ? JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")).version as string
    : version;
  await run(["bun", "run", "prebuild"], cwd);
  await generateIcons();
  await run(
    [
      Bun.env.PLEXY_GRADLE_BINARY || "./gradlew",
      ":app:assembleRelease",
      `-PreactNativeArchitectures=${Bun.env.PLEXY_ANDROID_ARCHITECTURES || "armeabi-v7a,arm64-v8a"}`,
      "--max-workers=2",
      "--no-daemon",
    ],
    resolve(cwd, "android"),
  );
  const out = resolve(root, ".build/native");
  await mkdir(out, { recursive: true });
  const artifact = resolve(out, artifactName(target, targetVersion));
  await copyFile(
    resolve(cwd, "android/app/build/outputs/apk/release/app-release.apk"),
    artifact,
  );
  console.log(
    `Internal preview APK: ${artifact} (Plexy ${targetVersion}, internal build ${buildNumber})`,
  );
}
