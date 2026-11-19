import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

const {
  CIRCLE_TOKEN,
  CIRCLECI_PROJECT_SLUG,
  CIRCLECI_PIPELINE_DEFINITION_ID,
  GITHUB_SHA,
  MACOS_TARGET,
} = process.env;
const api = "https://circleci.com/api/v2";

async function circle(path, body, { allowNotFound = false } = {}) {
  const headers = { "Circle-Token": CIRCLE_TOKEN };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(api + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) throw new Error(`CircleCI API returned HTTP ${response.status} for ${path}`);
  return response.json();
}

async function waitForWorkflow(id) {
  const started = Date.now();
  const deadline = started + 80 * 60_000;
  while (Date.now() < deadline) {
    // An accepted trigger may not be visible to the pipeline read API yet.
    const options = { allowNotFound: Date.now() - started < 2 * 60_000 };
    const workflows = await circle(`/pipeline/${id}/workflow`, undefined, options);
    const workflow = workflows?.items.find(({ name }) => name === "macos-release");
    if (workflow?.status === "success") return workflow.id;
    if (workflow && !["running", "created", "queued"].includes(workflow.status)) {
      throw new Error(`CircleCI macOS workflow ended with status ${workflow.status}`);
    }
    if (!workflow) {
      const run = await circle(`/pipeline/${id}`, undefined, options);
      if (run?.state === "errored" || run?.errors?.length) {
        throw new Error(`CircleCI rejected the pipeline: ${JSON.stringify(run.errors)}`);
      }
    }
    await delay(15_000);
  }
  throw new Error("Timed out waiting for the CircleCI macOS workflow");
}

async function download({ url }, destination) {
  const artifact = new URL(url);
  if (artifact.protocol !== "https:" ||
      !/^(?:[a-z0-9-]+\.)*(?:circleci\.com|circle-artifacts\.com)$/.test(artifact.hostname)) {
    throw new Error("Unexpected CircleCI artifact host");
  }

  // The artifact service may redirect to a signed storage URL.
  const signal = AbortSignal.timeout(10 * 60_000);
  let response = await fetch(artifact, {
    headers: { "Circle-Token": CIRCLE_TOKEN },
    redirect: "manual",
    signal,
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("CircleCI artifact redirect has no location");
    const redirect = new URL(location, artifact);
    if (redirect.protocol !== "https:") throw new Error("Expected an HTTPS artifact redirect");
    response = await fetch(redirect, { signal });
  }
  if (!response.ok) throw new Error(`CircleCI artifact download returned HTTP ${response.status}`);

  const partial = destination + ".part";
  try {
    await pipeline(response.body, createWriteStream(partial), { signal });
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true });
  }
}

if (!CIRCLE_TOKEN || !CIRCLECI_PROJECT_SLUG || !CIRCLECI_PIPELINE_DEFINITION_ID) {
  throw new Error("Set GitHub secret CIRCLECI_TOKEN and variables CIRCLECI_PROJECT_SLUG and CIRCLECI_PIPELINE_DEFINITION_ID");
}
if (!/^[0-9a-f]{40}$/.test(GITHUB_SHA ?? "") || !["desktop", "backend"].includes(MACOS_TARGET)) {
  throw new Error("A GitHub commit SHA and a macOS target are required");
}

const project = "/project/" + CIRCLECI_PROJECT_SLUG.split("/").map(encodeURIComponent).join("/");
const { id } = await circle(`${project}/pipeline/run`, {
  definition_id: CIRCLECI_PIPELINE_DEFINITION_ID,
  config: { branch: "main" },
  checkout: { branch: "main" },
  parameters: { "macos-target": MACOS_TARGET, "release-sha": GITHUB_SHA },
});
console.log(`Started CircleCI pipeline ${id} for ${MACOS_TARGET} at ${GITHUB_SHA}`);

const workflow = await waitForWorkflow(id);
const { items: jobs } = await circle(`/workflow/${workflow}/job`);
const job = jobs.find(({ name, status }) => name === "package-macos" && status === "success");
if (!job) throw new Error("CircleCI did not return a successful macOS packaging job");

const { items: artifacts } = await circle(`${project}/${job.job_number}/artifacts`);
const expected = MACOS_TARGET === "desktop" ? [/\.dmg$/, /\.zip$/] : [/^plexy-server-macos-arm64\.tar\.gz$/];
const output = "release-macos";
await mkdir(output, { recursive: true });
for (const pattern of expected) {
  const matches = artifacts.filter(({ path }) => path.startsWith("macos/") && pattern.test(basename(path)));
  if (matches.length !== 1) throw new Error(`Expected one macOS artifact matching ${pattern}`);
  await download(matches[0], join(output, basename(matches[0].path)));
}
