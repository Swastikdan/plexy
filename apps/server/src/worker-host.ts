/// Parent-side handle for the media worker child process (PRD 6).
///
/// Spawns `media-worker.ts` with the current runtime binary, writes probe
/// requests as JSON lines to its stdin and correlates responses by id. Native
/// crashes surface here as a nonzero exit: the next request triggers a respawn,
/// and `onCrash` marks affected files `analysis_failed` so they are not retried
/// in a loop (PRD 6).
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { log } from "./logger";

export interface ProbeFacts {
  container: string | null;
  duration: number | null;
  bitrate: number | null;
  video: null | {
    codec: string | null; profile: string | null; width: number; height: number;
    fps: number | null; hdr: string | null;
  };
  audio: Array<{ codec: string; channels: number; language: string; isDefault: boolean }>;
  subtitles: Array<{ codec: string | null; language: string; title: string | null; isDefault: boolean }>;
}

type Pending = { resolve: (v: ProbeFacts) => void; reject: (e: Error) => void };

let child: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<string, Pending>();
let crashed = false;
let shuttingDown = false;

/** Called by scan.ts when the worker dies mid-request. */
export let onWorkerCrash: ((exitCode: number | null, signal: string | null) => void) | null = null;
export function setOnWorkerCrash(fn: (exitCode: number | null, signal: string | null) => void) {
  onWorkerCrash = fn;
}

function spawnWorker(): ChildProcess {
  const entry = join(import.meta.dir, "media-worker.ts");
  // Run the worker with the same binary that runs the server, so a packaged
  // build needs no additional runtime. `bun` on PATH covers dev.
  const proc = spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...Bun.env } as NodeJS.ProcessEnv,
  });
  log.debug("media", `worker spawned pid=${proc.pid}`);

  const decoder = new TextDecoder();
  let buffer = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk);
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id: string; ok: boolean; result?: ProbeFacts; error?: string };
        const wait = pending.get(msg.id);
        if (!wait) continue;
        pending.delete(msg.id);
        if (msg.ok) wait.resolve(msg.result!);
        else wait.reject(new Error(msg.error ?? "probe failed"));
      } catch { /* ignore malformed worker output */ }
    }
  });
  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) log.debug("media", "worker stderr", { text: text.slice(0, 400) });
  });
  proc.on("exit", (code, signal) => {
    const wasShuttingDown = shuttingDown;
    child = null;
    // A clean SIGTERM during shutdown is expected, not a crash. Reporting it as
    // one made every restart look like the media worker had failed.
    if (wasShuttingDown || (code === 0 && pending.size === 0)) {
      log.debug("media", `worker stopped code=${code} signal=${signal}`);
    } else {
      log.warn("media", `worker exited unexpectedly code=${code} signal=${signal}`, {
        pending: pending.size,
      });
      crashed = true;
      onWorkerCrash?.(code, signal);
    }
    for (const [id, wait] of pending) {
      wait.reject(new Error(`media worker exited before answering (code=${code})`));
      pending.delete(id);
    }
  });
  return proc;
}

interface ProbeOptions { timeoutMs?: number }

/** Probe a single file; concurrency is capped inside the worker (PRD 5.6). */
export function probe(path: string, options: ProbeOptions = {}): Promise<ProbeFacts> {
  if (!child || !child.stdin || crashed) {
    child = spawnWorker();
    crashed = false;
  }
  const id = `p${nextId++}`;
  return new Promise<ProbeFacts>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`probe timed out after ${options.timeoutMs ?? 60_000} ms`));
    }, options.timeoutMs ?? 60_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    child!.stdin!.write(JSON.stringify({ id, op: "probe", path, timeoutMs: options.timeoutMs ?? 60_000 }) + "\n");
  });
}

/** Simple concurrency limit for callers batching many probes (PRD 5.6: 2). */
export function createProbePool(limit = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((res) => waiting.push(res));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** Terminate the worker on shutdown. The exit handler tolerates no-op exits. */
export async function shutdownWorker(): Promise<void> {
  const proc = child;
  shuttingDown = true;
  child = null;
  if (!proc) return;
  await new Promise<void>((res) => {
    proc.once("exit", () => res());
    proc.kill("SIGTERM");
    setTimeout(res, 2000);
  });
}
