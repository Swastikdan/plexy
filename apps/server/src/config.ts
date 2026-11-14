/// Server configuration (PRD 4, 5.1, 5.10).
///
/// JSON file in the data directory, read and rewritten atomically. Secrets
/// (the TMDB token) never leave this module except to the TMDB client; every
/// view handed to the browser comes from `safeView()`.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveDataDir } from "./paths";
import { defaultLogLevel, log } from "./logger";
import { setCrashConfigSnapshot, APP_VERSION } from "./crash";

/** Environment-input shape (`.env`, process env, CLI) — not the browser shape. */
const ConfigSchema = z.object({
  version: z.string().default(APP_VERSION),
  port: z.number().int().min(1024).max(65535).default(8765),
  /** `127.0.0.1` unless the owner explicitly enabled LAN viewing (PRD 5.10). */
  bindAddress: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default(defaultLogLevel()),
  metadataLanguage: z.string().default("en-US"),
  preferredAudioLanguage: z.string().default("en"),
  metadataRegion: z.string().default("US"),
  imageQuality: z.enum(["w342", "w500", "w780", "original"]).default("w780"),
  // Keep new installs quiet until the owner opts into library-wide background
  // preparation. Manual "Prepare Now" remains available.
  /** Prepare files that cannot play directly as soon as they are probed. */
  autoOptimize: z.boolean().default(true),
  /** Fetch community intro, recap, and credit markers during playback. */
  skipSegmentsEnabled: z.boolean().default(false),
  /** 0 = use all available space. Otherwise prune the oldest prepared copies. */
  optimizeMaxCacheGb: z.number().int().min(0).default(0),
  /** `data` keeps prepared copies in the Plexy data folder; `media` puts them beside each original. */
  optimizeStorage: z.enum(["data", "media"]).default("data"),
  /** Replace the source file with the prepared MP4 after a successful preparation. */
  replaceOriginal: z.boolean().default(false),
  /** Send removed originals to the system Trash instead of deleting them permanently. */
  moveOriginalsToTrash: z.boolean().default(true),
  /** Files probed in parallel during a scan. Higher is faster on fast disks. */
  probeConcurrency: z.number().int().min(1).max(16).default(4),
  tmdbToken: z.string().default(""),
  /** Free-form admin notes to self. */
  note: z.string().default(""),

  // --- Offline library cache ---------------------------------------------
  /** Maximum concurrent image downloads while filling the offline cache. */
  prefetchMaxConcurrent: z.number().int().min(1).max(10).default(3),
  /** Ceiling for this device's offline image cache, in megabytes. */
  prefetchMaxCacheMb: z.number().int().min(10).max(500).default(100),
});

export type Config = z.infer<typeof ConfigSchema>;
type Patch = Partial<{ [K in keyof Config]: Config[K] }>;

let cache: Config | null = null;

function configPath(): string {
  return join(resolveDataDir(), "config.json");
}

/** Development convenience token from the environment, never persisted by itself. */
function envTmdbToken(): string | undefined {
  return Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN || Bun.env.TMDB_TOKEN || undefined;
}

export async function initConfig(): Promise<Config> {
  await mkdir(resolveDataDir(), { recursive: true });
  let raw: Partial<Config> = {};
  try { raw = JSON.parse(await readFile(configPath(), "utf8")); } catch { /* first run */ }
  const parsed = ConfigSchema.safeParse(raw);
  cache = parsed.success ? parsed.data : ConfigSchema.parse({});
  // Env token during development per PRD 14; packaged config wins if present.
  const envToken = envTmdbToken();
  if (!cache.tmdbToken && envToken) {
    cache.tmdbToken = envToken;
    await save({});
  }
  setCrashConfigSnapshot(redactedView(await getConfig()));
  log.debug("server", "config loaded", { port: cache.port, bind: cache.bindAddress });
  return cache;
}

export async function getConfig(): Promise<Config> {
  if (cache) return process.env.PLEXY_LOCAL_ONLY ? { ...cache, bindAddress: "127.0.0.1" } : cache;
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

/** Safe-to-send projection: the token itself is replaced by its presence/source. */
export function redactedView(cfg: Config) {
  const { tmdbToken, ...settings } = cfg;
  const envToken = envTmdbToken();
  return {
    ...settings,
    localOnly: process.env.PLEXY_LOCAL_ONLY === "1",
    // Conversion is always available now; kept false for older clients.
    directPlayOnly: false,
    version: cfg.version ?? APP_VERSION,
    hasTmdbToken: tmdbToken.length > 0,
    tokenSource: envToken && tmdbToken === envToken ? "env" : "settings",
  };
}

/** Setup-complete check for the first-run wizard (PRD 10.1). */
export function isSetupComplete(cfg: Config, hasLibrary: boolean): boolean {
  return cfg.tmdbToken.length > 0 && hasLibrary;
}

export { APP_VERSION };
