/// Matroska (MKV) subtitle reading.
///
/// Mediabunny 1.62 can *write* subtitle tracks but cannot read them: its input
/// API only exposes video and audio tracks. That made every embedded-subtitle
/// feature silently report "no tracks". Matroska's subtitle layout is simple
/// enough to read directly, and MKV is the format that carries embedded subs in
/// this library.
///
/// This module only understands EBML structure: it returns track metadata and
/// the raw subtitle packets (timestamp + bytes). Text normalisation and WebVTT
/// serialisation stay in `subtitles.ts`, so there is no import cycle.
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

export interface MatroskaSubtitleTrack {
  /** Matroska track number, used to match blocks to tracks. */
  number: number;
  /** Normalised codec name (`srt`, `ass`, `ssa`, `webvtt`, `pgs`, ...). */
  codec: string;
  /** Raw Matroska codec id (`S_TEXT/UTF8`, ...). */
  codecId: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
}

export interface MatroskaSubtitlePacket {
  /** Seconds from the start of the file. */
  timestamp: number;
  /** Seconds; inferred from the next cue when the container omits it. */
  duration: number;
  data: Uint8Array;
}

export interface MatroskaSubtitles {
  tracks: MatroskaSubtitleTrack[];
  packets: Map<number, MatroskaSubtitlePacket[]>;
}

// --- EBML primitives ---------------------------------------------------------

interface Element {
  id: number;
  /** Absolute start of the element payload in the buffer. */
  dataStart: number;
  /** Absolute end of the element payload in the buffer. */
  end: number;
  headerSize: number;
  unknownSize: boolean;
}

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

/** Length of a variable-length integer from its first byte. */
function vintLength(first: number): number {
  if (first === 0) return 0;
  let length = 1;
  for (let mask = 0x80; mask > 0 && !(first & mask); mask >>= 1) length++;
  return length;
}

function readVint(buffer: Buffer, offset: number, keepMarker: boolean): Vint | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset]!;
  const length = vintLength(first);
  if (!length || offset + length > buffer.length) return null;

  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = !keepMarker && (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = buffer[offset + i]!;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

interface Header {
  id: number;
  /** Payload length in bytes, or null for an unknown-size element. */
  size: number | null;
  headerSize: number;
  unknownSize: boolean;
}

function readHeader(buffer: Buffer, offset: number): Header | null {
  const id = readVint(buffer, offset, true);
  if (!id) return null;
  const size = readVint(buffer, offset + id.length, false);
  if (!size) return null;
  return {
    id: id.value,
    size: size.unknown ? null : size.value,
    headerSize: id.length + size.length,
    unknownSize: size.unknown,
  };
}

function readElement(buffer: Buffer, offset: number, limit = buffer.length): Element | null {
  const header = readHeader(buffer, offset);
  if (!header) return null;
  const dataStart = offset + header.headerSize;
  const end = header.size == null ? limit : dataStart + header.size;
  if (end > limit || end < dataStart) return null;
  return {
    id: header.id,
    dataStart,
    end,
    headerSize: header.headerSize,
    unknownSize: header.unknownSize,
  };
}

function eachElement(
  buffer: Buffer,
  start: number,
  end: number,
  visit: (element: Element) => void,
): void {
  let offset = start;
  while (offset < end) {
    const element = readElement(buffer, offset, end);
    if (!element || element.end <= offset) return;
    visit(element);
    offset = element.end;
  }
}

function readUint(buffer: Buffer, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + buffer[i]!;
  return value;
}

function readString(buffer: Buffer, start: number, end: number): string {
  return buffer.toString("utf8", start, end).replace(/\0+$/, "").trim();
}

const ID = {
  segment: 0x18538067,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  language: 0x22b59c,
  name: 0x536e,
  flagDefault: 0x88,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
} as const;

const TRACK_TYPE_SUBTITLE = 0x11;
const EBML_MAGIC = 0x1a45dfa3;

/** Map Matroska codec ids to the names used by the rest of Plexy. */
export function normalizeMatroskaCodec(codecId: string): string {
  const codec = codecId.toUpperCase();
  if (codec === "S_TEXT/UTF8" || codec === "S_TEXT/SRT") return "srt";
  if (codec === "S_TEXT/ASS" || codec === "S_ASS") return "ass";
  if (codec === "S_TEXT/SSA" || codec === "S_SSA") return "ssa";
  if (codec === "S_TEXT/WEBVTT" || codec === "S_WEBVTT") return "webvtt";
  if (codec === "S_TEXT/USF") return "usf";
  if (codec.includes("PGS")) return "pgs";
  if (codec.includes("VOBSUB")) return "vobsub";
  if (codec.includes("DVBSUB")) return "dvbsub";
  return codec.toLowerCase();
}

function parseTracks(buffer: Buffer): MatroskaSubtitleTrack[] {
  const tracks: MatroskaSubtitleTrack[] = [];
  eachElement(buffer, 0, buffer.length, (entry) => {
    if (entry.id !== ID.trackEntry) return;
    let number = 0;
    let type = 0;
    let codecId = "";
    let language = "eng";
    let title: string | null = null;
    let isDefault = true;
    eachElement(buffer, entry.dataStart, entry.end, (field) => {
      switch (field.id) {
        case ID.trackNumber:
          number = readUint(buffer, field.dataStart, field.end);
          break;
        case ID.trackType:
          type = readUint(buffer, field.dataStart, field.end);
          break;
        case ID.codecId:
          codecId = readString(buffer, field.dataStart, field.end);
          break;
        case ID.language:
          language = readString(buffer, field.dataStart, field.end) || "eng";
          break;
        case ID.name:
          title = readString(buffer, field.dataStart, field.end) || null;
          break;
        case ID.flagDefault:
          isDefault = readUint(buffer, field.dataStart, field.end) !== 0;
          break;
      }
    });
    if (type !== TRACK_TYPE_SUBTITLE || number <= 0 || !codecId) return;
    tracks.push({
      number,
      codec: normalizeMatroskaCodec(codecId),
      codecId,
      language: language || null,
      title,
      isDefault,
    });
  });
  return tracks;
}

function parseTimestampScale(buffer: Buffer): number | null {
  let scale: number | null = null;
  eachElement(buffer, 0, buffer.length, (element) => {
    if (element.id === ID.timestampScale) {
      scale = readUint(buffer, element.dataStart, element.end);
    }
  });
  return scale && scale > 0 ? scale : null;
}

// --- block reading -----------------------------------------------------------

function splitLacedFrames(payload: Buffer, start: number, lacing: number): Buffer[] {
  if (lacing === 0) return [payload.subarray(start)];
  if (start >= payload.length) return [];

  const count = payload[start]! + 1;
  let offset = start + 1;
  const sizes: number[] = [];

  if (lacing === 3) {
    // Fixed-size lacing: all frames but the last have the same length.
    const remaining = payload.length - offset;
    const each = Math.floor(remaining / count);
    for (let i = 0; i < count - 1; i++) sizes.push(each);
    sizes.push(remaining - each * (count - 1));
  } else if (lacing === 1) {
    // Xiph lacing: sizes are sums of 255s plus a final byte.
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      for (;;) {
        if (offset >= payload.length) return [payload.subarray(start)];
        const byte = payload[offset++]!;
        size += byte;
        if (byte !== 255) break;
      }
      sizes.push(size);
    }
    const used = sizes.reduce((sum, size) => sum + size, 0);
    sizes.push(Math.max(0, payload.length - offset - used));
  } else {
    // EBML lacing: sizes are variable-length integers.
    for (let i = 0; i < count - 1; i++) {
      const size = readVint(payload, offset, false);
      if (!size) return [payload.subarray(start)];
      sizes.push(size.value);
      offset += size.length;
    }
    const used = sizes.reduce((sum, size) => sum + size, 0);
    sizes.push(Math.max(0, payload.length - offset - used));
  }

  const frames: Buffer[] = [];
  let frameOffset = offset;
  for (const size of sizes) {
    const frameEnd = Math.min(payload.length, frameOffset + size);
    frames.push(payload.subarray(frameOffset, frameEnd));
    frameOffset = frameEnd;
  }
  return frames;
}

function parseBlock(
  payload: Buffer,
  clusterTime: number,
  blockDuration: number | null,
  secondsPerTick: number,
  subtitleTracks: Set<number>,
  packets: Map<number, MatroskaSubtitlePacket[]>,
): void {
  const track = readVint(payload, 0, false);
  if (!track) return;
  if (!subtitleTracks.has(track.value)) return;
  if (payload.length < track.length + 3) return;

  const relativeTime = payload.readInt16BE(track.length);
  const flags = payload[track.length + 2]!;
  const lacing = (flags >> 1) & 0x03;
  const start = (clusterTime + relativeTime) * secondsPerTick;
  const duration = blockDuration == null ? Number.NaN : blockDuration * secondsPerTick;
  const frames = splitLacedFrames(payload, track.length + 3, lacing);

  const list = packets.get(track.value) ?? [];
  for (const frame of frames) {
    if (!frame.length) continue;
    list.push({ timestamp: Math.max(0, start), duration, data: new Uint8Array(frame) });
  }
  packets.set(track.value, list);
}

function parseCluster(
  cluster: Buffer,
  secondsPerTick: number,
  subtitleTracks: Set<number>,
  packets: Map<number, MatroskaSubtitlePacket[]>,
): void {
  let clusterTime = 0;
  eachElement(cluster, 0, cluster.length, (element) => {
    switch (element.id) {
      case ID.timestamp:
        clusterTime = readUint(cluster, element.dataStart, element.end);
        break;
      case ID.simpleBlock:
        parseBlock(
          cluster.subarray(element.dataStart, element.end),
          clusterTime, null, secondsPerTick, subtitleTracks, packets,
        );
        break;
      case ID.blockGroup: {
        let block: Buffer | null = null;
        let duration: number | null = null;
        eachElement(cluster, element.dataStart, element.end, (child) => {
          if (child.id === ID.block) {
            block = cluster.subarray(child.dataStart, child.end);
          } else if (child.id === ID.blockDuration) {
            duration = readUint(cluster, child.dataStart, child.end);
          }
        });
        if (block) {
          parseBlock(block, clusterTime, duration, secondsPerTick, subtitleTracks, packets);
        }
        break;
      }
    }
  });
}

// --- file access -------------------------------------------------------------

async function readAt(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
}

async function readHeaderAt(handle: FileHandle, offset: number, fileSize: number): Promise<Header | null> {
  const buffer = await readAt(handle, offset, 12);
  if (buffer.length < 2) return null;
  const header = readHeader(buffer, 0);
  if (!header) return null;
  if (header.size != null && offset + header.headerSize + header.size > fileSize) return null;
  return header;
}

/** True when the file starts with the EBML magic used by Matroska/WebM. */
export async function isMatroskaFile(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return false;
  try {
    const magic = await readAt(handle, 0, 4);
    return magic.length === 4 && magic.readUInt32BE(0) === EBML_MAGIC;
  } finally {
    await handle.close().catch(() => {});
  }
}

interface ScanOptions { probeOnly: boolean }

async function scan(path: string, options: ScanOptions): Promise<MatroskaSubtitles | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return null;

  try {
    const magic = await readAt(handle, 0, 4);
    if (magic.length < 4 || magic.readUInt32BE(0) !== EBML_MAGIC) return null;

    let timestampScale = 1_000_000; // Matroska default: 1 ms
    let tracks: MatroskaSubtitleTrack[] = [];
    const packets = new Map<number, MatroskaSubtitlePacket[]>();
    let subtitleTracks = new Set<number>();
    let offset = 0;

    while (offset + 2 <= info.size) {
      const header = await readHeaderAt(handle, offset, info.size);
      if (!header || (header.unknownSize && header.id !== ID.segment)) break;
      const dataStart = offset + header.headerSize;

      if (header.id === ID.segment) {
        // Descend into the segment; its children are the elements we need.
        offset = dataStart;
        continue;
      }

      const size = header.size;
      if (size == null) break;

      if (header.id === ID.tracks) {
        if (size > 4 * 1024 * 1024) break;
        const data = await readAt(handle, dataStart, size);
        tracks = parseTracks(data);
        subtitleTracks = new Set(tracks.map((track) => track.number));
        for (const track of tracks) {
          if (!packets.has(track.number)) packets.set(track.number, []);
        }
        if (options.probeOnly) break;
      } else if (header.id === ID.info && !options.probeOnly) {
        if (size <= 1024 * 1024) {
          const data = await readAt(handle, dataStart, size);
          timestampScale = parseTimestampScale(data) ?? timestampScale;
        }
      } else if (header.id === ID.cluster && !options.probeOnly) {
        // A cluster is normally a few MiB. Skip implausible sizes instead of
        // allocating gigabytes for a corrupt file.
        if (size <= 64 * 1024 * 1024 && subtitleTracks.size) {
          const data = await readAt(handle, dataStart, size);
          parseCluster(data, timestampScale / 1e9, subtitleTracks, packets);
        }
      }

      offset = dataStart + size;
    }

    // Many SRT/ASS blocks omit a duration; use the next cue's start as the end
    // so subtitles do not all linger for the 2 s fallback.
    for (const list of packets.values()) {
      list.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < list.length; i++) {
        const packet = list[i]!;
        if (Number.isFinite(packet.duration) && packet.duration > 0) continue;
        const next = list[i + 1];
        packet.duration = next
          ? Math.max(0.5, Math.min(10, next.timestamp - packet.timestamp))
          : 2;
      }
    }

    return { tracks, packets };
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Subtitle track metadata only; stops after the Tracks element is read. */
export async function probeMatroskaSubtitles(path: string): Promise<MatroskaSubtitleTrack[] | null> {
  const result = await scan(path, { probeOnly: true }).catch(() => null);
  return result ? result.tracks : null;
}

/** Every subtitle track and its raw packets, from one pass over the file. */
export async function readMatroskaSubtitles(path: string): Promise<MatroskaSubtitles | null> {
  return scan(path, { probeOnly: false }).catch(() => null);
}
