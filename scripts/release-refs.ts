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

if (import.meta.main) console.log(await reserveBuildNumber(await releaseCommit()));
