/// Local artwork storage, deduplication, and Bun.Image derivative pipeline.
///
/// Stores largest original images at ~/Library/Application Support/Plexy/artwork/originals/
/// and generates fast display derivatives under artwork/derived/ using Bun.Image.
/// Keeps artwork available even when Plexy is completely offline. Never writes to media folders.
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveOriginalsDir, resolveDerivedDir } from "./paths";
import { log } from "./logger";
import { q, run, type Row } from "./db";

export interface ArtworkMeta {
  hash: string;
  originalPath: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

export interface ArtworkStorageStats {
  originalsCount: number;
  originalsBytes: number;
  derivedCount: number;
  derivedBytes: number;
  totalBytes: number;
}

const MAX_PIXEL_COUNT = 40_000_000; // 40 megapixels safety cap
const MAX_FILE_SIZE_BYTES = 35 * 1024 * 1024; // 35 MB

let dirsReady = false;
async function ensureDirs(): Promise<void> {
  if (dirsReady) return;
  await mkdir(resolveOriginalsDir(), { recursive: true });
  await mkdir(resolveDerivedDir(), { recursive: true });
  try {
    run(`CREATE TABLE IF NOT EXISTS local_artwork (
      url TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      original_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      format TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    )`);
    run(`CREATE INDEX IF NOT EXISTS local_artwork_hash ON local_artwork(hash)`);
  } catch {}
  dirsReady = true;
}

/** Normalize any TMDB image path/URL to its highest-resolution canonical origin. */
export function normalizeArtworkUrl(tmdbOrRemoteUrl: string): { canonicalUrl: string; originalUrl: string } {
  let url = tmdbOrRemoteUrl.trim();
  if (!url.startsWith("http")) {
    const cleanPath = url.startsWith("/") ? url : `/${url}`;
    url = `https://image.tmdb.org/t/p/original${cleanPath}`;
  }
  let canonicalUrl = url;
  if (url.includes("image.tmdb.org/t/p/")) {
    canonicalUrl = url.replace(/\/t\/p\/(w\d+|h\d+|original)\//, "/t/p/original/");
  }
  return { canonicalUrl, originalUrl: url };
}

const inFlightOriginals = new Map<string, Promise<ArtworkMeta | null>>();
const inFlightDerivatives = new Map<string, Promise<string>>();

/**
 * Fetch and retain the largest original artwork in Plexy's app data directory.
 * Deduplicates by SHA-256 hash, validates pixel bounds, and decodes with Bun.Image.
 * Returns metadata or null if offline / fetch failed.
 */
export async function cacheArtworkOriginal(tmdbOrRemoteUrl: string): Promise<ArtworkMeta | null> {
  await ensureDirs();

  const { canonicalUrl, originalUrl } = normalizeArtworkUrl(tmdbOrRemoteUrl);

  // Check if already cached in DB and file exists on disk (enables 100% offline access)
  try {
    const cached = q<Row>("SELECT * FROM local_artwork WHERE url = ? OR url = ? LIMIT 1").get(canonicalUrl, originalUrl);
    if (cached) {
      const exists = await Bun.file(String(cached.original_path)).exists();
      if (exists) {
        return {
          hash: String(cached.hash),
          originalPath: String(cached.original_path),
          width: Number(cached.width),
          height: Number(cached.height),
          format: String(cached.format),
          sizeBytes: Number(cached.size_bytes),
        };
      }
    }
  } catch {}

  // Deduplicate concurrent in-flight requests for the same image
  const existingFlight = inFlightOriginals.get(canonicalUrl);
  if (existingFlight) return existingFlight;

  const flight = (async (): Promise<ArtworkMeta | null> => {
    try {
      const res = await fetch(canonicalUrl, { headers: { "User-Agent": "Plexy/1.0" } })
        .catch(() => null);
      if (!res || !res.ok) {
        if (res) log.debug("artwork", "artwork fetch returned status", { status: res.status, url: canonicalUrl });
        return null;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType && !contentType.startsWith("image/")) {
        log.warn("artwork", "rejected non-image content type", { contentType, url: canonicalUrl });
        return null;
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_SIZE_BYTES) {
        log.warn("artwork", "rejected invalid file size", { size: buf.byteLength, url: canonicalUrl });
        return null;
      }

      // Validate with Bun.Image
      const img = new Bun.Image(buf);
      const meta = await img.metadata().catch(() => null);
      if (!meta || !meta.width || !meta.height) {
        log.warn("artwork", "Bun.Image could not decode image", { url: canonicalUrl });
        return null;
      }

      if (meta.width * meta.height > MAX_PIXEL_COUNT) {
        log.warn("artwork", "rejected image exceeding pixel cap", { width: meta.width, height: meta.height });
        return null;
      }

      // Deduplicate by content hash
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
      const ext = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpg";
      const originalPath = join(resolveOriginalsDir(), `${hash}.${ext}`);

      // Atomically write original if not already cached
      const exists = await Bun.file(originalPath).exists();
      if (!exists) {
        await Bun.write(originalPath, buf);
        log.debug("artwork", "cached original artwork", { hash, format: meta.format, width: meta.width, height: meta.height });
      }

      try {
        run(
          `INSERT OR REPLACE INTO local_artwork (url, hash, original_path, width, height, format, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          canonicalUrl, hash, originalPath, meta.width, meta.height, meta.format, buf.byteLength,
        );
        if (originalUrl !== canonicalUrl) {
          run(
            `INSERT OR REPLACE INTO local_artwork (url, hash, original_path, width, height, format, size_bytes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            originalUrl, hash, originalPath, meta.width, meta.height, meta.format, buf.byteLength,
          );
        }
      } catch {}

      return {
        hash,
        originalPath,
        width: meta.width,
        height: meta.height,
        format: meta.format,
        sizeBytes: buf.byteLength,
      };
    } catch (err) {
      log.debug("artwork", "failed caching artwork original", { message: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      inFlightOriginals.delete(canonicalUrl);
    }
  })();

  inFlightOriginals.set(canonicalUrl, flight);
  return flight;
}

/**
 * Get or create a resized display derivative WebP using Bun.Image.
 * Returns the path to the derived WebP file.
 */
export async function getOrCreateDerivative(originalPath: string, targetWidth: number): Promise<string> {
  await ensureDirs();

  const baseHash = originalPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "unknown";
  const derivedPath = join(resolveDerivedDir(), `${baseHash}_w${targetWidth}.webp`);

  if (await Bun.file(derivedPath).exists()) {
    return derivedPath;
  }

  const flightKey = `${baseHash}_${targetWidth}`;
  const existingFlight = inFlightDerivatives.get(flightKey);
  if (existingFlight) return existingFlight;

  const flight = (async (): Promise<string> => {
    try {
      const raw = await Bun.file(originalPath).arrayBuffer();
      const img = new Bun.Image(raw);
      img.resize(targetWidth);
      img.webp();
      const derivedBytes = await img.bytes();
      await Bun.write(derivedPath, derivedBytes);
      return derivedPath;
    } catch (err) {
      log.warn("artwork", "failed generating derivative, falling back to original", { message: err instanceof Error ? err.message : String(err) });
      return originalPath;
    } finally {
      inFlightDerivatives.delete(flightKey);
    }
  })();

  inFlightDerivatives.set(flightKey, flight);
  return flight;
}

/** Pre-cache all posters, backdrops, episode stills, and cast photos for an item and its children. */
export async function prefetchItemArtwork(itemId: number): Promise<void> {
  try {
    const rows = q<Row>(
      `SELECT id, kind, url FROM artwork
       WHERE (item_id = ? OR item_id IN (SELECT id FROM items WHERE parent_id = ?))
         AND source = 'tmdb'`,
    ).all(itemId, itemId);

    for (const r of rows) {
      const targetWidth = r.kind === "backdrop" ? 1600 : r.kind === "thumb" ? 300 : 500;
      const meta = await cacheArtworkOriginal(String(r.url));
      if (meta) {
        await getOrCreateDerivative(meta.originalPath, targetWidth);
      }
    }

    // Also prefetch cast profile photos for this item
    const cast = q<Row>(
      `SELECT p.profile_path
       FROM item_people ip JOIN people p ON p.id = ip.person_id
       WHERE ip.item_id = ? AND p.profile_path IS NOT NULL LIMIT 12`,
    ).all(itemId);

    for (const c of cast) {
      if (c.profile_path) {
        const meta = await cacheArtworkOriginal(String(c.profile_path));
        if (meta) {
          await getOrCreateDerivative(meta.originalPath, 300);
        }
      }
    }
  } catch (err) {
    log.debug("artwork", "prefetchItemArtwork failed for item", { itemId, error: String(err) });
  }
}

let cachingAllInProgress = false;

/**
 * Scan all library items and people in the database and ensure original artwork
 * and display derivatives are saved to disk. Bounded concurrency, safe to run in background.
 */
export async function cacheMissingArtwork(): Promise<{ cached: number; failed: number }> {
  if (cachingAllInProgress) return { cached: 0, failed: 0 };
  cachingAllInProgress = true;

  try {
    await ensureDirs();

    // 1. Gather all TMDB artwork from artwork table
    const artRows = q<Row>("SELECT id, kind, url FROM artwork WHERE source = 'tmdb'").all();

    // 2. Gather all people profile photos
    const personRows = q<Row>("SELECT id, profile_path FROM people WHERE profile_path IS NOT NULL").all();

    const tasks: Array<{ url: string; targetWidth: number }> = [];

    for (const a of artRows) {
      const url = String(a.url);
      const targetWidth = a.kind === "backdrop" ? 1600 : a.kind === "thumb" ? 300 : 500;
      tasks.push({ url, targetWidth });
    }

    for (const p of personRows) {
      if (p.profile_path) {
        tasks.push({ url: String(p.profile_path), targetWidth: 300 });
      }
    }

    let cached = 0;
    let failed = 0;
    const CONCURRENCY = 4;

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const chunk = tasks.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ url, targetWidth }) => {
          try {
            const meta = await cacheArtworkOriginal(url);
            if (meta) {
              await getOrCreateDerivative(meta.originalPath, targetWidth);
              cached++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }),
      );
    }

    log.debug("artwork", "completed background artwork pre-caching", { cached, failed, total: tasks.length });
    return { cached, failed };
  } catch (err) {
    log.warn("artwork", "background artwork caching failed", { error: String(err) });
    return { cached: 0, failed: 0 };
  } finally {
    cachingAllInProgress = false;
  }
}

/** Calculate total storage used by original and derived artwork. */
export async function getArtworkStorageStats(): Promise<ArtworkStorageStats> {
  await ensureDirs();

  const scanDir = async (dir: string) => {
    let count = 0;
    let bytes = 0;
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const p = join(dir, name);
      const s = await stat(p).catch(() => null);
      if (s?.isFile()) {
        count++;
        bytes += s.size;
      }
    }
    return { count, bytes };
  };

  const orig = await scanDir(resolveOriginalsDir());
  const der = await scanDir(resolveDerivedDir());

  return {
    originalsCount: orig.count,
    originalsBytes: orig.bytes,
    derivedCount: der.count,
    derivedBytes: der.bytes,
    totalBytes: orig.bytes + der.bytes,
  };
}
