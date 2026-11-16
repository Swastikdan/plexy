import { File, FileMode, type FileHandle } from "expo-file-system";
import type { Chapter } from "@plexy/api-client/types";
import {
  findSequence,
  isMkvSeekReference,
  parseChpl,
  parseMkvChapters,
  readEbmlSizeAt,
} from "./chapter-parser";

const CHUNK_BYTES = 256 * 1024;
const SCAN_BYTES = 4 * 1024 * 1024;
const MAX_CHAPTER_PAYLOAD = 1024 * 1024;
const CHPL = [0x63, 0x68, 0x70, 0x6c];
const MKV_CHAPTERS = [0x10, 0x43, 0xa7, 0x70];

interface ChapterFile {
  uri: string;
  size: number;
  modified: number;
}

/**
 * Read embedded chapters without loading whole files. MP4 `chpl` boxes and
 * Matroska/WebM `Chapters` elements are searched in the file head and tail,
 * then only the matching payload is parsed. Files without embedded chapters
 * resolve to an empty list and are cached like parsed ones.
 */

const cache = new Map<string, Promise<Chapter[]>>();

/** Read embedded chapters once per file version; failures are cached as empty. */
export function readChapters(
  file: ChapterFile,
  duration?: number | null,
): Promise<Chapter[]> {
  const key = `${file.uri}:${file.size}:${file.modified}:${duration ?? 0}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = loadChapters(file, duration).catch(() => []);
    cache.set(key, pending);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return pending;
}

async function loadChapters(
  file: ChapterFile,
  duration?: number | null,
): Promise<Chapter[]> {
  if (file.size <= 0) return [];
  const handle = new File(file.uri).open(FileMode.ReadOnly);
  try {
    const mp4 = await scanMp4(handle, file.size, duration);
    if (mp4.length) return mp4;
    return await scanMkv(handle, file.size, duration);
  } finally {
    handle.close();
  }
}

function readRange(
  handle: FileHandle,
  offset: number,
  length: number,
): Uint8Array {
  if (length <= 0) return new Uint8Array(0);
  handle.offset = offset;
  return handle.readBytes(length);
}

interface ScannedChunk {
  offset: number;
  bytes: Uint8Array;
}

async function* scanChunks(
  handle: FileHandle,
  size: number,
): AsyncGenerator<ScannedChunk> {
  const ranges: [number, number][] = [];
  if (size <= SCAN_BYTES * 2) {
    ranges.push([0, size]);
  } else {
    ranges.push([0, SCAN_BYTES], [size - SCAN_BYTES, SCAN_BYTES]);
  }
  for (const [rangeStart, rangeLength] of ranges) {
    let offset = rangeStart;
    const end = rangeStart + rangeLength;
    while (offset < end) {
      const length = Math.min(CHUNK_BYTES, end - offset);
      yield { offset, bytes: readRange(handle, offset, length) };
      if (offset + length >= end) break;
      // Overlap by one element id so an id split across chunks is still seen.
      offset += Math.max(1, length - 4);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function scanMp4(
  handle: FileHandle,
  size: number,
  duration?: number | null,
): Promise<Chapter[]> {
  for await (const chunk of scanChunks(handle, size)) {
    for (const hit of findSequence(chunk.bytes, CHPL)) {
      const typeOffset = chunk.offset + hit;
      const boxStart = typeOffset - 4;
      if (boxStart < 0) continue;
      const sizeBytes = readRange(handle, boxStart, 4);
      if (sizeBytes.length < 4) continue;
      const boxSize =
        ((sizeBytes[0]! << 24) >>> 0) +
        (sizeBytes[1]! << 16) +
        (sizeBytes[2]! << 8) +
        sizeBytes[3]!;
      if (boxSize < 12 || boxStart + boxSize > size) continue;
      const payloadLength = Math.min(
        boxSize - 8,
        MAX_CHAPTER_PAYLOAD,
      );
      const payload = readRange(handle, typeOffset + 4, payloadLength);
      const chapters = parseChpl(payload, duration);
      if (chapters.length) return chapters;
      await Promise.resolve();
    }
  }
  return [];
}

async function scanMkv(
  handle: FileHandle,
  size: number,
  duration?: number | null,
): Promise<Chapter[]> {
  for await (const chunk of scanChunks(handle, size)) {
    for (const hit of findSequence(chunk.bytes, MKV_CHAPTERS)) {
      // A SeekHead entry contains the same id as a SeekID payload; only the
      // real Chapters element follows the id with a size field.
      if (isMkvSeekReference(chunk.bytes, hit)) continue;
      const elementOffset = chunk.offset + hit;
      const header = readRange(
        handle,
        elementOffset,
        Math.min(12, size - elementOffset),
      );
      if (header.length < 5) continue;
      const elementSize = readEbmlSizeAt(header, 4);
      if (!elementSize) continue;
      const payloadStart = elementOffset + 4 + elementSize.length;
      const available = Math.max(0, size - payloadStart);
      const payloadLength = Math.min(
        elementSize.unknown ? MAX_CHAPTER_PAYLOAD : elementSize.size,
        MAX_CHAPTER_PAYLOAD,
        available,
      );
      if (payloadLength <= 0) continue;
      const payload = readRange(handle, payloadStart, payloadLength);
      const chapters = parseMkvChapters(payload, duration);
      if (chapters.length) return chapters;
      await Promise.resolve();
    }
  }
  return [];
}
