/// Parent-side handle for the playback-preparation worker.
///
/// Runs `optimize-worker.ts` in a child process for the same reason probes do:
/// a native codec crash must not take the HTTP server down. Jobs are sent as
/// JSON lines on stdin; progress/done/error come back on stdout. The worker
/// executes one job at a time, so the queue in `optimize.ts` is the back
/// pressure that keeps the CPU from being saturated by several conversions.
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { log } from "./logger";

export interface OptimizeRequest {
  path: string;
  output: string;
  mode: "remux" | "transcode";
  videoCopy: boolean;
  audioCopy: boolean;
  videoBitrate?: number;
  audioBitrate?: number;
  duration?: number | null;
}

interface Pending {
  resolve: (size: number) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

let child: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<string, Pending>();

function rejectAll(message: string) {
  for (const [id, wait] of pending) {
    wait.reject(new Error(message));
    pending.delete(id);
  }
}

function spawnWorker(): ChildProcess {
  const entry = join(import.meta.dir, "optimize-worker.ts");
  // Same runtime binary as the server so the packaged build needs nothing else.
  const proc = spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...Bun.env } as NodeJS.ProcessEnv,
  });
  log.debug("optimizer", `worker spawned pid=${proc.pid}`);

  const decoder = new TextDecoder();
  let buffer = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk);
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as {
          id: string;
          type: "progress" | "done" | "error";
          progress?: number;
          size?: number;
          error?: string;
        };
        const wait = pending.get(msg.id);
        if (!wait) continue;
        if (msg.type === "progress") {
          wait.onProgress?.(Number(msg.progress ?? 0));
        } else if (msg.type === "done") {
          pending.delete(msg.id);
          wait.resolve(Number(msg.size ?? 0));
        } else {
          pending.delete(msg.id);
          wait.reject(new Error(msg.error ?? "optimization failed"));
        }
      } catch { /* ignore malformed worker output */ }
    }
  });
  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) log.debug("optimizer", "worker stderr", { text: text.slice(0, 400) });
  });
  // A dead worker makes `stdin.write` emit asynchronously; without a listener
  // that becomes an uncaught exception and takes the HTTP server down too.
  proc.stdin!.on("error", (err: Error) => {
    log.warn("optimizer", "worker stdin failed", { message: err.message });
    if (child === proc) child = null;
    rejectAll(`optimizer worker is not accepting jobs: ${err.message}`);
  });
  proc.on("error", (err: Error) => {
    log.warn("optimizer", "worker process error", { message: err.message });
    if (child === proc) child = null;
    rejectAll(`optimizer worker failed: ${err.message}`);
  });
  proc.on("exit", (code, signal) => {
    log.warn("optimizer", `worker exited code=${code} signal=${signal}`);
    if (child === proc) child = null;
    rejectAll(`optimizer worker exited before finishing (code=${code})`);
  });
  return proc;
}

function ensureWorker(): ChildProcess {
  if (!child || child.exitCode !== null || child.killed) child = spawnWorker();
  return child;
}

/**
 * Run one preparation job. Progress is reported as a 0…1 fraction. There is no
 * wall-clock timeout: a full-length transcode can legitimately take minutes,
 * and a native crash is surfaced by the child's `exit` handler instead.
 */
export function runOptimize(
  request: OptimizeRequest,
  onProgress?: (progress: number) => void,
): Promise<number> {
  const proc = ensureWorker();
  const id = `o${nextId++}`;
  return new Promise<number>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try {
      proc.stdin!.write(JSON.stringify({ id, op: "optimize", ...request }) + "\n");
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Terminate the worker (shutdown or a wedged job). Rejects in-flight jobs. */
export async function shutdownOptimizeWorker(): Promise<void> {
  const proc = child;
  child = null;
  rejectAll("optimizer worker stopped");
  if (!proc) return;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(resolve, 2000);
  });
}
