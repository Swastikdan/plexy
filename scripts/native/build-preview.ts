/** Build standalone internal-test APKs. These use the template debug signing
 * identity and must never be submitted to a store. EAS production owns release signing.
 */
import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
const requested = process.argv[2] || "all";
if (!["all", "mobile", "tv"].includes(requested))
  throw new Error("Use mobile, tv, or all.");
async function run(command: string[], cwd: string) {
  const process = Bun.spawn(command, {
    cwd,
    env: { ...Bun.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await process.exited) !== 0)
    throw new Error(`Native build failed: ${command[0]}`);
}
for (const target of requested === "all" ? ["mobile", "tv"] : [requested]) {
  const cwd = resolve(root, "apps", target);
  await run(["bun", "run", "prebuild"], cwd);
  await run(
    [
      Bun.env.PLEXY_GRADLE_BINARY || "./gradlew",
      ":app:assembleRelease",
      `-PreactNativeArchitectures=${Bun.env.PLEXY_ANDROID_ARCHITECTURES || "arm64-v8a"}`,
      "--max-workers=2",
      "--no-daemon",
    ],
    resolve(cwd, "android"),
  );
  const out = resolve(root, ".build/native");
  await mkdir(out, { recursive: true });
  const artifact = resolve(out, `plexy-${target}-preview.apk`);
  await copyFile(
    resolve(cwd, "android/app/build/outputs/apk/release/app-release.apk"),
    artifact,
  );
  console.log(`Internal preview APK: ${artifact}`);
}
