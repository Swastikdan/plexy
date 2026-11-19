import { appendFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function waitForMacOS(getRun, cancelRun, {
  allowFallback, queueMs = 5 * 60_000, now = Date.now, delay = sleep,
}) {
  const queuedAt = now();
  let started = false;
  let cancelRequested = false;
  let cancellationDeadline = Infinity;
  while (now() < cancellationDeadline) {
    const run = await getRun();
    if (run.status === "completed") {
      if (run.conclusion === "success") return "github";
      if (cancelRequested && run.conclusion === "cancelled") return "circleci";
      throw new Error(`GitHub macOS build ended with ${run.conclusion}`);
    }
    if (run.status === "in_progress") started = true;
    if (allowFallback && !started && !cancelRequested && now() - queuedAt >= queueMs) {
      await cancelRun();
      cancelRequested = true;
      cancellationDeadline = now() + 2 * 60_000;
    }
    await delay(10_000);
  }
  throw new Error("GitHub did not confirm cancellation. CircleCI was not started.");
}

async function main() {
  const env = process.env;
  const base = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions`;
  const initialLookupDeadline = Date.now() + 60_000;
  async function github(path, body) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (path.endsWith("/cancel") && response.status === 409) return null;
      if (body === undefined && response.status === 404 && Date.now() < initialLookupDeadline) {
        return { status: "queued" };
      }
      throw new Error(`GitHub returned HTTP ${response.status} for ${path}`);
    }
    return response.status === 200 ? response.json() : null;
  }
  const run = await github("/workflows/macos-package.yml/dispatches", {
    ref: "main",
    return_run_details: true,
    inputs: {
      sha: env.GITHUB_SHA, target: env.MACOS_TARGET, contents: env.BACKEND_CONTENTS,
      build_number: env.PLEXY_BUILD_NUMBER, version: env.PLEXY_RELEASE_VERSION,
    },
  });
  if (!Number.isSafeInteger(run?.workflow_run_id)) throw new Error("GitHub did not return a macOS worker run ID");
  const path = `/runs/${run.workflow_run_id}`;
  await appendFile(env.GITHUB_OUTPUT, `run_id=${run.workflow_run_id}\n`);
  console.log(`GitHub macOS worker: ${run.html_url}`);
  const provider = await waitForMacOS(
    async () => {
      const status = await github(path);
      if (status.status !== "in_progress") return status;
      const { jobs } = await github(path + "/jobs");
      return jobs?.some((job) => job.status === "in_progress" || job.status === "completed")
        ? status : { status: "queued" };
    },
    () => github(path + "/cancel", {}),
    { allowFallback: env.MACOS_RUNNER === "auto" },
  );
  await appendFile(env.GITHUB_OUTPUT, `provider=${provider}\n`);
  console.log(`Selected macOS provider: ${provider}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
