/** Release dependency graph, shared by CI and its regression tests. */
export function buildTargets(files: string[], target = "", fullBuild = false) {
  const flags = { web: false, desktop: false, mobile: false, tv: false, server: false };
  const all = () => Object.keys(flags).forEach(key => flags[key as keyof typeof flags] = true);
  if (target && target !== "all") {
    const key = target === "backend" ? "server" : target;
    if (!(key in flags)) throw new Error(`Unknown build target: ${target}`);
    flags[key as keyof typeof flags] = true;
  } else if (target === "all" || fullBuild) all();
  else for (const file of files) {
    if (/^(package\.json|bun\.lock|tsconfig[^/]*\.json|\.github\/workflows\/build\.yml|scripts\/build-targets)/.test(file)) all();
    else if (/^(apps\/web\/|packages\/api-client\/|scripts\/build-client\.ts|scripts\/generate-pwa-icons\.ts)/.test(file)) flags.web = true;
    else if (/^(apps\/desktop\/|build\/|scripts\/(build-desktop|build-executable|generate-icon|generate-dmg-background|install-macos-ffmpeg)\.)/.test(file)) flags.desktop = true;
    else if (file.startsWith("packages/local-library/")) flags.mobile = true;
    else if (file.startsWith("apps/mobile/")) flags.mobile = true;
    else if (file.startsWith("apps/tv/")) flags.tv = true;
    else if (/^(packages\/native-client\/|scripts\/native\/)/.test(file)) flags.mobile = flags.tv = true;
    else if (/^(apps\/server\/|packages\/(server|sqlite|protocol)\/|scripts\/(build-server|test-server|build-minimal-ffmpeg)\.)/.test(file)) flags.server = true;
  }
  if (!target && files.some(file => file.startsWith("packages/api-client/"))) flags.mobile = flags.tv = true;
  // Desktop embeds both the backend and website.
  if (flags.server || flags.web) flags.desktop = true;
  // The runtime installer is shared by standalone server and desktop builds.
  if (files.includes("scripts/install-macos-ffmpeg.mjs") && !target) flags.server = true;
  return flags;
}

if (import.meta.main) {
  const { execFileSync } = await import("node:child_process");
  const before = process.env.BEFORE ?? "";
  const head = process.env.HEAD_SHA ?? "HEAD";
  let files: string[] = [];
  let full = false;
  const target = process.env.BUILD_TARGET ?? "";
  if (!target) {
    if (!before || /^0+$/.test(before)) full = true;
    else {
      // Full checkout history is required: never silently ignore a multi-commit push.
      files = execFileSync("git", ["diff", "--name-only", "-z", before, head], { encoding: "utf8" }).split("\0").filter(Boolean);
    }
  }
  const flags = buildTargets(files, target, full);
  const android = ["mobile", "tv"].filter(key => flags[key as "mobile" | "tv"]);
  const outputs = Object.entries(flags).map(([key, value]) => `build_${key}=${value}`);
  outputs.push(`any_build=${Object.values(flags).some(Boolean)}`, `android_targets=${JSON.stringify(android)}`);
  console.log(outputs.join("\n"));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
  }
}
