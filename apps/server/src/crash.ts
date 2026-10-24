/// Crash reporting (PRD 6).
///
/// JS crashes are catchable: `uncaughtException` / `unhandledRejection` write
/// `crash/crash-<timestamp>.json`, then the process exits non-zero. Native
/// crashes in the media stack kill the process without warning — that is why
/// native media work runs in a child process (`worker-host.ts`), and the parent
/// records the exit code as an `analysis_failed` file instead.
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir, resolveLogDir } from "./paths";
import { log, recentLogLines, flushLogs, closeLog } from "./logger";

export const APP_VERSION = "0.1.0" as const;

export interface CrashReport {
  ts: string;
  kind: "uncaughtException" | "unhandledRejection";
  message: string;
  stack: string | null;
  version: string;
  bunVersion: string;
  os: string;
  arch: string;
  uptimeSeconds: number;
  memoryMB: number;
  activeScanJobId: number | null;
  lastLogs: string[];
  config: unknown; // config with secrets removed
}

/** Written by scan.ts so crash reports can name the job in flight. */
export let activeScanJobId: number | null = null;
export function setActiveScanJobId(id: number | null) { activeScanJobId = id; }

let configSnapshot: unknown = null;
/** Update the redacted config embedded in future crash reports. */
export function setCrashConfigSnapshot(safe: unknown) { configSnapshot = safe; }

const startedAt = Date.now();

function buildReport(kind: CrashReport["kind"], error: unknown): CrashReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    ts: new Date().toISOString(),
    kind,
    message: err.message,
    stack: err.stack ?? null,
    version: APP_VERSION,
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    os: process.platform,
    arch: process.arch,
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    memoryMB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
    activeScanJobId,
    lastLogs: recentLogLines(),
    config: configSnapshot,
  };
}

async function writeCrash(report: CrashReport): Promise<string> {
  const dir = join(resolveLogDir(), "crash");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `crash-${Date.now()}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  // Line-summarize into the main log so the tail after restart shows it too.
  await appendFile(join(resolveLogDir(), "plexy.log"),
    JSON.stringify({ ts: report.ts, level: "error", component: "server", message: `crash: ${report.message}`, context: { report: file } }) + "\n")
    .catch(() => {});
  return file;
}

let crashing = false;

/** Install global handlers exactly once from `main.ts`. */
export function installCrashHandlers(): void {
  process.on("uncaughtException", async (error) => {
    if (crashing) return; // a second uncaught error during shutdown is noise
    crashing = true;
    const report = buildReport("uncaughtException", error);
    log.error("server", "uncaught exception", { message: report.message });
    try { await writeCrash(report); } finally {
      flushLogs();
      closeLog();
      process.exit(1);
    }
  });
  process.on("unhandledRejection", async (reason) => {
    if (crashing) return;
    crashing = true;
    const report = buildReport("unhandledRejection", reason);
    log.error("server", "unhandled rejection", { message: report.message });
    try { await writeCrash(report); } finally {
      flushLogs();
      closeLog();
      process.exit(1);
    }
  });
}

/** Crash dir listing helper for `GET /api/crashes`. */
export function crashDir(): string {
  return join(resolveLogDir(), "crash");
}

/** Crash dir is sibling to the data dir for pruning later (v1 keeps 30 days). */
export function dataReference(): string {
  return resolveDataDir();
}
