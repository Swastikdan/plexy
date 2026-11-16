import type { Chapter } from "@plexy/api-client/types";

export const MAX_CHAPTERS = 500;

interface RawChapter {
  start: number;
  end: number;
  label: string;
}

/**
 * A SeekHead entry stores the Chapters id as a 4-byte SeekID payload. Only a
 * real element is followed by an EBML size, so skip those references.
 */
export function isMkvSeekReference(
  bytes: Uint8Array,
  offset: number,
): boolean {
  return (
    offset >= 3 &&
    bytes[offset - 3] === 0x53 &&
    bytes[offset - 2] === 0xab &&
    bytes[offset - 1] === 0x84
  );
}

/** Find every occurrence of a byte sequence inside a chunk. */
export function findSequence(
  haystack: Uint8Array,
  needle: readonly number[],
  from = 0,
): number[] {
  const hits: number[] = [];
  const start = Math.max(0, from);
  for (let i = start; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) hits.push(i);
  }
  return hits;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i++]!;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      continue;
    }
    let codePoint: number;
    let extra: number;
    if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      extra = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      extra = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      extra = 3;
    } else {
      out += "\uFFFD";
      continue;
    }
    if (i + extra > bytes.length) {
      out += "\uFFFD";
      break;
    }
    let valid = true;
    for (let j = 0; j < extra; j += 1) {
      const next = bytes[i + j]!;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (!valid) {
      out += "\uFFFD";
      continue;
    }
    i += extra;
    if (codePoint <= 0x10ffff) out += String.fromCodePoint(codePoint);
    else out += "\uFFFD";
  }
  return out;
}

function readUint(bytes: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i += 1) value = value * 256 + bytes[i]!;
  return value;
}

function finishChapters(
  raw: RawChapter[],
  duration?: number | null,
): Chapter[] {
  const sorted = raw
    .filter(
      (chapter) =>
        Number.isFinite(chapter.start) && chapter.start >= 0,
    )
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CHAPTERS);
  const unique: RawChapter[] = [];
  for (const chapter of sorted) {
    const previous = unique.at(-1);
    if (previous && chapter.start - previous.start < 0.05) {
      if (
        previous.label.startsWith("Chapter ") &&
        !chapter.label.startsWith("Chapter ")
      )
        previous.label = chapter.label;
      continue;
    }
    unique.push({ ...chapter });
  }
  return unique.map((chapter, index) => {
    const next = unique[index + 1]?.start;
    const fallback =
      chapter.end > chapter.start
        ? chapter.end
        : next != null
          ? next
          : duration != null && duration > chapter.start
            ? duration
            : chapter.start + 1;
    const start = Math.round(chapter.start * 1000) / 1000;
    const end = Math.round(Math.max(chapter.start, fallback) * 1000) / 1000;
    return {
      start,
      end,
      label: chapter.label || `Chapter ${index + 1}`,
    };
  });
}

function parseChplAt(
  payload: Uint8Array,
  countOffset: number,
  duration?: number | null,
): Chapter[] {
  if (payload.length <= countOffset) return [];
  const count = payload[countOffset]!;
  if (count === 0 || count > MAX_CHAPTERS) return [];
  const raw: RawChapter[] = [];
  let offset = countOffset + 1;
  for (let index = 0; index < count; index += 1) {
    if (offset + 9 > payload.length) return [];
    // chpl times use 100-nanosecond units.
    const start = readUint(payload, offset, offset + 8) / 10_000_000;
    offset += 8;
    const length = payload[offset++]!;
    if (offset + length > payload.length) return [];
    const label = decodeUtf8(payload.subarray(offset, offset + length)).trim();
    offset += length;
    raw.push({ start, end: Number.NaN, label });
  }
  return finishChapters(raw, duration);
}

/**
 * Apple's `chpl` box stores a chapter count followed by entries of an
 * 8-byte start time (100 ns units), a 1-byte title length and a UTF-8 title.
 * Some muxers include a 4-byte reserved field after version/flags; try both.
 */
export function parseChpl(
  payload: Uint8Array,
  duration?: number | null,
): Chapter[] {
  for (const countOffset of [8, 4]) {
    const chapters = parseChplAt(payload, countOffset, duration);
    if (chapters.length) return chapters;
  }
  return [];
}

interface EbmlElement {
  id: number;
  size: number;
  unknown: boolean;
  header: number;
}

function readEbmlId(
  bytes: Uint8Array,
  offset: number,
): { value: number; length: number } | null {
  const first = bytes[offset];
  if (first == null) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 4 || offset + length > bytes.length) return null;
  let value = 0;
  for (let i = 0; i < length; i += 1)
    value = value * 256 + bytes[offset + i]!;
  return { value, length };
}

function readEbmlVint(
  bytes: Uint8Array,
  offset: number,
): { value: number; length: number; unknown: boolean } | null {
  const first = bytes[offset];
  if (first == null) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const next = bytes[offset + i]!;
    value = value * 256 + next;
    if (next !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

function readEbmlElement(
  bytes: Uint8Array,
  offset: number,
): EbmlElement | null {
  const id = readEbmlId(bytes, offset);
  if (!id) return null;
  const size = readEbmlVint(bytes, offset + id.length);
  if (!size) return null;
  return {
    id: id.value,
    size: size.value,
    unknown: size.unknown,
    header: id.length + size.length,
  };
}

const CHAPTERS_ID = 0x1043a770;
const EDITION_ENTRY_ID = 0x45b9;
const CHAPTER_ATOM_ID = 0xb6;
const CHAPTER_TIME_START_ID = 0x91;
const CHAPTER_TIME_END_ID = 0x92;
const CHAPTER_DISPLAY_ID = 0x80;
const CHAPTER_STRING_ID = 0x85;
const CHAPTER_LANGUAGE_ID = 0x437c;
const MAX_EBML_DEPTH = 8;

interface DisplayText {
  text: string;
  language: string;
}

function parseChapterDisplay(
  bytes: Uint8Array,
  start: number,
  end: number,
): DisplayText | null {
  let text = "";
  let language = "";
  let offset = start;
  while (offset < end) {
    const element = readEbmlElement(bytes, offset);
    if (!element) break;
    const contentStart = offset + element.header;
    if (contentStart > end) break;
    const contentEnd = element.unknown
      ? end
      : Math.min(end, contentStart + element.size);
    if (element.id === CHAPTER_STRING_ID)
      text = decodeUtf8(bytes.subarray(contentStart, contentEnd)).trim();
    else if (element.id === CHAPTER_LANGUAGE_ID)
      language = decodeUtf8(
        bytes.subarray(contentStart, contentEnd),
      ).trim();
    if (contentEnd <= offset) break;
    offset = contentEnd;
  }
  return text ? { text, language } : null;
}

function parseChapterAtom(
  bytes: Uint8Array,
  start: number,
  end: number,
  out: RawChapter[],
  depth: number,
) {
  if (depth > MAX_EBML_DEPTH) return;
  let chapterStart: number | null = null;
  let chapterEnd: number | null = null;
  let label = "";
  let language = "";
  let offset = start;
  while (offset < end) {
    const element = readEbmlElement(bytes, offset);
    if (!element) break;
    const contentStart = offset + element.header;
    if (contentStart > end) break;
    const contentEnd = element.unknown
      ? end
      : Math.min(end, contentStart + element.size);
    if (element.id === CHAPTER_TIME_START_ID)
      chapterStart = readUint(bytes, contentStart, contentEnd) / 1_000_000_000;
    else if (element.id === CHAPTER_TIME_END_ID)
      chapterEnd = readUint(bytes, contentStart, contentEnd) / 1_000_000_000;
    else if (element.id === CHAPTER_DISPLAY_ID) {
      const display = parseChapterDisplay(bytes, contentStart, contentEnd);
      if (
        display &&
        (!label ||
          (/^en/i.test(display.language) && !/^en/i.test(language)))
      ) {
        label = display.text;
        language = display.language;
      }
    } else if (element.id === CHAPTER_ATOM_ID)
      parseChapterAtom(bytes, contentStart, contentEnd, out, depth + 1);
    if (contentEnd <= offset) break;
    offset = contentEnd;
  }
  if (chapterStart != null)
    out.push({
      start: chapterStart,
      end: chapterEnd ?? Number.NaN,
      label,
    });
}

function parseEbmlChapters(
  bytes: Uint8Array,
  start: number,
  end: number,
  out: RawChapter[],
  depth: number,
) {
  if (depth > MAX_EBML_DEPTH) return;
  let offset = start;
  while (offset < end) {
    const element = readEbmlElement(bytes, offset);
    if (!element) break;
    const contentStart = offset + element.header;
    if (contentStart > end) break;
    const contentEnd = element.unknown
      ? end
      : Math.min(end, contentStart + element.size);
    if (element.id === CHAPTERS_ID || element.id === EDITION_ENTRY_ID)
      parseEbmlChapters(bytes, contentStart, contentEnd, out, depth + 1);
    else if (element.id === CHAPTER_ATOM_ID)
      parseChapterAtom(bytes, contentStart, contentEnd, out, depth + 1);
    if (contentEnd <= offset) break;
    offset = contentEnd;
  }
}

/** Parse the payload of a Matroska/WebM `Chapters` element. */
export function parseMkvChapters(
  payload: Uint8Array,
  duration?: number | null,
): Chapter[] {
  const raw: RawChapter[] = [];
  parseEbmlChapters(payload, 0, payload.length, raw, 0);
  return finishChapters(raw, duration);
}

/** Read the size field that follows an EBML element id at `offset`. */
export function readEbmlSizeAt(
  bytes: Uint8Array,
  offset: number,
): { size: number; length: number; unknown: boolean } | null {
  const result = readEbmlVint(bytes, offset);
  return result
    ? { size: result.value, length: result.length, unknown: result.unknown }
    : null;
}
