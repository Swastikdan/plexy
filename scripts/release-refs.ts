export function releaseRepository() {
  return process.env.GITHUB_REPOSITORY || "Swastikdan/plexy";
}

export async function github(args: string[]) {
  const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) throw new Error(stderr.trim() || "GitHub CLI request failed");
  return stdout;
}

export async function listTagRefs(prefix: string, run = github) {
  const output = await run(["api", "--paginate", "--jq", ".[].ref",
    `repos/${releaseRepository()}/git/matching-refs/tags/${prefix}?per_page=100`]);
  return output.split("\n").filter(Boolean).map((ref) => ref.replace(/^refs\/tags\//, ""));
}

export async function reserveTag(tag: string, sha: string, run = github) {
  const endpoint = `repos/${releaseRepository()}/git`;
  try {
    await run(["api", "-X", "POST", `${endpoint}/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Reference already exists")) throw error;
    return false;
  }
}

export async function releaseCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  // Local packaging can include unpushed changes. The reservation is only a counter.
  const sha = (await github(["api", `repos/${releaseRepository()}/git/ref/heads/main`, "--jq", ".object.sha"])).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Cannot resolve the remote main commit");
  return sha;
}

export async function reserveBuildNumber(sha: string, run = github) {
  const legacyTags = await listTagRefs("v", run);
  const legacy = legacyTags.map((tag) => Number(tag.match(/-build\.(\d+)$/)?.[1] ?? 0));
  for (let attempt = 0; attempt < 10; attempt++) {
    const tags = await listTagRefs("build-number/", run);
    const numbers = tags.map((tag) => Number(tag.match(/^build-number\/(\d+)$/)?.[1] ?? 0));
    const next = Math.max(2000, ...legacy, ...numbers) + 1;
    if (await reserveTag(`build-number/${next}`, sha, run)) return next;
  }
  throw new Error("Could not reserve a build number after 10 concurrent allocations");
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!;
}

export function releaseVersion(source: string, tags: string[], bump?: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(source)) {
    throw new Error("The release version must be a stable major.minor.patch version");
  }
  const latest = tags.flatMap((tag) => {
    const version = tag.match(/^v(\d+\.\d+\.\d+)(?:-build\.\d+)?$/)?.[1];
    return version ? [version] : [];
  }).sort(compareVersions).at(-1);
  if (!latest || compareVersions(source, latest) > 0) return source;
  if (!bump) return latest;
  const [major, minor, patch] = latest.split(".").map(Number) as [number, number, number];
  switch (bump) {
    case "patch": return `${major}.${minor}.${patch + 1}`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "major": return `${major + 1}.0.0`;
    default: throw new Error(`Unsupported release version increment: ${bump}`);
  }
}

if (import.meta.main) {
  const source = (await Bun.file(new URL("../package.json", import.meta.url)).json()).version;
  const version = releaseVersion(source, await listTagRefs("v"), process.env.PLEXY_VERSION_BUMP || "patch");
  const buildNumber = await reserveBuildNumber(await releaseCommit());
  console.log(JSON.stringify({ version, buildNumber }));
}
