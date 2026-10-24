/// Structured logging (PRD 6).
///
/// - Every line is one JSON object appended to `plexy.log` (dev and prod).
/// - In dev, lines are also pretty-printed to stderr at the current level.
/// - Log files rotate at 10 MB; five rotated files are kept. Reports in the
///   sibling `crash/` directory are written by `crash.ts` and never rotated.
/// - A 200-entry in-memory ring buffer is embedded in every crash report.
/// - Secrets (bearer tokens, JWTs, key-shaped assignments) are redacted before
///   anything reaches the file.
/// - The level is runtime-changeable from the admin UI without a restart.
/// - `subscribe()` lets the SSE log endpoint tail lines from memory.
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readdirSync, renameSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { resolveLogDir } from "./paths";

export type Level = "debug" | "info" | "warn" | "error";
export type Component =
  | "scanner" | "matcher" | "tmdb" | "media" | "http" | "player" | "server" | "artwork"
  | "optimizer";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_ROTATED = 5; // keep plexy-1 … plexy-5
const MAX_BYTES = 10 * 1024 * 1024;

/** Dev runs from `src/server/main.ts`; packaged binaries run a compiled path. */
function isDevRuntime(): boolean {
  return (Bun.main ?? import.meta.path).includes("/src/server/main");
}

/** Patterns that must never reach the log file or a crash report. */
const REDACT: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /eyJhbGciOi[A-Za-z0-9._~+/=-]{20,}/g, // TMDB v4 read-access tokens are JWTs
  /("(?:api[_.-]?key|token|authorization)"\s*:\s*)"[^"]*"/gi,
];

let minLevel: Level = isDevRuntime() ? "debug" : "info";
const ringBuffer: string[] = [];
const subscribers = new Set<(line: string) => void>();
let fileHandle: number | null = null;
let currentFile: string | null = null;

export function setLogLevel(level: Level): void { minLevel = level; }
export function getLogLevel(): Level { return minLevel; }

/** Register a live tail subscriber; returns its unsubscribe handle. */
export function subscribe(fn: (line: string) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Snapshot of the in-memory ring buffer, oldest first (for crash reports). */
export function recentLogLines(): string[] {
  return [...ringBuffer];
}

function redact(text: string): string {
  return REDACT.reduce((acc, re) => acc.replace(re, "[redacted]"), text);
}

/**
 * Shift plexy-4 → plexy-5 … then plexy.log → plexy-1 once the file exceeds the
 * size cap. Synchronous on purpose: rotation happens once per reopen, so the
 * cost is irrelevant and the sequencing stays simple.
 */
function rotateIfNeeded(dir: string, path: string): void {
  // First run: no file yet, nothing to rotate. statSync would otherwise throw
  // and (via the swallowed write) silently kill logging for the whole run.
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.size < MAX_BYTES) return;
  const names = readdirSync(dir).filter((n) => /^plexy-\d+\.log$/.test(n));
  for (const name of names) {
    const n = Number(name.match(/\d+/)![0]);
    if (n >= MAX_ROTATED) {
      unlinkSync(join(dir, name));
    } else {
      renameSync(join(dir, name), join(dir, `plexy-${n + 1}.log`));
    }
  }
  renameSync(path, join(dir, "plexy-1.log"));
}

/** Open the active log file once (mkdir first so the very first write works). */
function openCurrentFile(): number {
  if (fileHandle !== null) return fileHandle;
  const dir = resolveLogDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plexy.log");
  rotateIfNeeded(dir, path);
  currentFile = path;
  fileHandle = openSync(path, "a");
  return fileHandle;
}

function writeLine(level: Level, component: Component, message: string, context?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const line = redact(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(context === undefined ? {} : { context }),
  })) + "\n";

  ringBuffer.push(line.trim());
  if (ringBuffer.length > 200) ringBuffer.shift();

  for (const fn of subscribers) {
    try { fn(line.trim()); } catch { /* a dead SSE subscriber must not break logging */ }
  }

  if (isDevRuntime()) {
    const pretty = `[${component}] ${message}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(
      pretty,
      context === undefined ? "" : context,
    );
  }

  // Disk writes are synchronous but tiny; they are appended and may fail
  // silently when the disk is unavailable — stderr still shows the line in dev.
  try {
    writeSync(openCurrentFile(), line);
  } catch { /* swallow */ }
}

export const log = {
  debug: (component: Component, message: string, context?: unknown) => writeLine("debug", component, message, context),
  info: (component: Component, message: string, context?: unknown) => writeLine("info", component, message, context),
  warn: (component: Component, message: string, context?: unknown) => writeLine("warn", component, message, context),
  error: (component: Component, message: string, context?: unknown) => writeLine("error", component, message, context),
  /** Active log file path, used by the admin UI to open the folder. */
  get currentFile() {
    return currentFile ?? join(resolveLogDir(), "plexy.log");
  },
};

/** Best-effort flush before exit, called by crash handlers and shutdown. */
export function flushLogs(): void {
  if (fileHandle === null) return;
  try { fsyncSync(fileHandle); } catch { /* already flushed or lifted away */ }
}

export function closeLog(): void {
  if (fileHandle !== null) {
    try { closeSync(fileHandle); } catch { /* double close is harmless */ }
    fileHandle = null;
  }
}

/** Ensure the log directory exists so the first write never races mkdir. */
export function prepareLogDir(): void {
  mkdirSync(resolveLogDir(), { recursive: true });
}
