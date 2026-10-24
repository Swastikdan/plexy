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
  dirsReady = true;
}

/**
 * Fetch and retain the largest original artwork in Plexy's app data directory.
 * Deduplicates by SHA-256 hash, validates pixel bounds, and decodes with Bun.Image.
 */
export async function cacheArtworkOriginal(tmdbOrRemoteUrl: string): Promise<ArtworkMeta | null> {
  await ensureDirs();

  const url = tmdbOrRemoteUrl.startsWith("http")
    ? tmdbOrRemoteUrl
    : `https://image.tmdb.org/t/p/original${tmdbOrRemoteUrl.startsWith("/") ? "" : "/"}${tmdbOrRemoteUrl}`;

  // Check if already cached in DB and file exists on disk (enables 100% offline access)
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
    const cached = q<Row>("SELECT * FROM local_artwork WHERE url = ?").get(url);
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

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Plexy/1.0" } });
    if (!res.ok) {
      log.debug("artwork", "artwork fetch returned status", { status: res.status, url });
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) {
      log.warn("artwork", "rejected non-image content type", { contentType, url });
      return null;
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_SIZE_BYTES) {
      log.warn("artwork", "rejected invalid file size", { size: buf.byteLength, url });
      return null;
    }

    // Validate with Bun.Image
    const img = new Bun.Image(buf);
    const meta = await img.metadata().catch(() => null);
    if (!meta || !meta.width || !meta.height) {
      log.warn("artwork", "Bun.Image could not decode image", { url });
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
        url, hash, originalPath, meta.width, meta.height, meta.format, buf.byteLength,
      );
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
  }
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
