/** The three release artifacts, including each artifact's embedded dependencies. */
export function buildTargets(files: string[], target = "", fullBuild = false) {
  const flags = { desktop: false, server: false, mobile: false };
  const all = () => {
    flags.desktop = flags.server = flags.mobile = true;
  };
  if (target && target !== "all") {
    const key = target === "backend" ? "server" : target;
    if (!(key in flags)) throw new Error(`Unknown build target: ${target}`);
    flags[key as keyof typeof flags] = true;
  } else if (target === "all" || fullBuild) all();
  else
    for (const file of files) {
      if (
        /^(package\.json|bun\.lock|tsconfig[^/]*\.json|packages\/tsconfig\/|\.github\/workflows\/build\.yml|scripts\/build-targets)/.test(
          file,
        )
      )
        all();
      else if (
        /^(apps\/mobile\/|packages\/(local-library)\/|scripts\/native\/)/.test(
          file,
        )
      )
        flags.mobile = true;
      else if (
        /^(apps\/web\/|apps\/server\/|packages\/(api-client|server|sqlite|protocol)\/|scripts\/(build-server|test-server|generate-pwa-icons|build-minimal-ffmpeg)\.)/.test(
          file,
        )
      )
        flags.server = true;
      else if (
        /^(apps\/desktop\/|build\/|scripts\/(build-desktop|generate-icon|generate-dmg-background)\.)/.test(
          file,
        )
      )
        flags.desktop = true;
      if (file.startsWith("packages/api-client/")) flags.mobile = true;
      if (file === "scripts/generate-icon.ts" || file.startsWith("build/"))
        flags.mobile = true;
      if (/^scripts\/install-(macos-)?ffmpeg\.mjs$/.test(file)) flags.server = true;
    }
  // Both desktop and standalone server ship the browser UI and backend.
  // A manual target builds only that artifact; automatic builds follow dependencies.
  if (!target && flags.server) flags.desktop = true;
  return flags;
}

if (import.meta.main) {
  const { execFileSync } = await import("node:child_process");
  const before = process.env.BEFORE ?? "";
  const head = process.env.HEAD_SHA ?? "HEAD";
  const target = process.env.BUILD_TARGET ?? "";
  let files: string[] = [];
  let full = false;
  if (!target) {
    if (!before || /^0+$/.test(before)) full = true;
    else
      files = execFileSync("git", ["diff", "--name-only", "-z", before, head], {
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean);
  }
  const flags = buildTargets(files, target, full);
  const outputs = Object.entries(flags).map(
    ([key, value]) => `build_${key}=${value}`,
  );
  outputs.push(`any_build=${Object.values(flags).some(Boolean)}`);
  console.log(outputs.join("\n"));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
  }
}
