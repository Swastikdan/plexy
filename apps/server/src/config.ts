/// Server configuration (PRD 4, 5.1, 5.10).
///
/// JSON file in the data directory, read and rewritten atomically. Secrets
/// (the TMDB token) never leave this module except to the TMDB client; every
/// view handed to the browser comes from `safeView()`.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveDataDir } from "./paths";
import { log } from "./logger";
import { setCrashConfigSnapshot, APP_VERSION } from "./crash";

/** Environment-input shape (`.env`, process env, CLI) — not the browser shape. */
const ConfigSchema = z.object({
  version: z.string().default(APP_VERSION),
  port: z.number().int().min(1024).max(65535).default(8765),
  /** `127.0.0.1` unless the owner explicitly enabled LAN viewing (PRD 5.10). */
  bindAddress: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  metadataLanguage: z.string().default("en-US"),
  preferredAudioLanguage: z.string().default("en"),
  metadataRegion: z.string().default("US"),
  imageQuality: z.enum(["w342", "w500", "w780", "original"]).default("w780"),
  // Keep new installs quiet until the owner opts into library-wide background
  // preparation. Manual "Prepare Now" remains available.
  autoOptimize: z.boolean().default(false),
  /** 0 = use all available space. Otherwise prune the oldest prepared copies. */
  optimizeMaxCacheGb: z.number().int().min(0).default(0),
  /** Files probed in parallel during a scan. Higher is faster on fast disks. */
  probeConcurrency: z.number().int().min(1).max(16).default(4),
  tmdbToken: z.string().default(""),
  /** Free-form admin notes to self. */
  note: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;
type Patch = Partial<{ [K in keyof Config]: Config[K] }>;

let cache: Config | null = null;

function configPath(): string {
  return join(resolveDataDir(), "config.json");
}

export async function initConfig(): Promise<Config> {
  await mkdir(resolveDataDir(), { recursive: true });
  let raw: Partial<Config> = {};
  try { raw = JSON.parse(await readFile(configPath(), "utf8")); } catch { /* first run */ }
  const parsed = ConfigSchema.safeParse(raw);
  cache = parsed.success ? parsed.data : ConfigSchema.parse({});
  // Env token during development per PRD 14; packaged config wins if present.
  const envToken = Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN || Bun.env.TMDB_TOKEN;
  if (!cache.tmdbToken && envToken) {
    cache.tmdbToken = envToken;
    await save({});
  }
  setCrashConfigSnapshot(redactedView(await getConfig()));
  log.info("server", "config loaded", { port: cache.port, bind: cache.bindAddress });
  return cache;
}

export async function getConfig(): Promise<Config> {
  if (cache) return cache;
  return initConfig();
}

/** Merge a patch, persist synchronously enough to survive crash-by-exit. */
export async function save(patch: Patch): Promise<Config> {
  const next = ConfigSchema.parse({ ...(await getConfig()), ...patch });
  cache = next;
  const file = configPath();
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, file);
  setCrashConfigSnapshot(redactedView(next));
  return next;
}

/** Safe-to-send projection: token presence only, never the token itself. */
export function redactedView(cfg: Config) {
  return {
    version: cfg.version ?? APP_VERSION,
    port: cfg.port,
    bindAddress: cfg.bindAddress,
    logLevel: cfg.logLevel,
    metadataLanguage: cfg.metadataLanguage,
    preferredAudioLanguage: cfg.preferredAudioLanguage,
    metadataRegion: cfg.metadataRegion,
    imageQuality: cfg.imageQuality,
    autoOptimize: cfg.autoOptimize,
    optimizeMaxCacheGb: cfg.optimizeMaxCacheGb,
    probeConcurrency: cfg.probeConcurrency,
    hasTmdbToken: cfg.tmdbToken.length > 0,
    tokenSource:
      (Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN || Bun.env.TMDB_TOKEN) &&
      cfg.tmdbToken === (Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN || Bun.env.TMDB_TOKEN)
        ? "env"
        : "settings",
    note: cfg.note,
  };
}

/** Setup-complete check for the first-run wizard (PRD 10.1). */
export function isSetupComplete(cfg: Config, hasLibrary: boolean): boolean {
  return cfg.tmdbToken.length > 0 && hasLibrary;
}

export { APP_VERSION };
