import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeMatroskaSubtitles, readMatroskaSubtitles } from "../src/mkv-subtitles";
import { cuesToVtt, packetToCues } from "../src/subtitles";

/** Minimal EBML writer used to build a tiny, valid Matroska fixture. */
function vint(value: number): Buffer {
  for (let length = 1; length <= 8; length++) {
    if (value < 2 ** (7 * length) - 1) {
      const buffer = Buffer.alloc(length);
      let remaining = value;
      for (let i = length - 1; i >= 0; i--) {
        buffer[i] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      buffer[0]! |= 1 << (8 - length);
      return buffer;
    }
  }
  throw new Error("value too large");
}

function element(id: number[], payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id), vint(payload.length), payload]);
}

function uint(value: number, bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes);
  let remaining = value;
  for (let i = bytes - 1; i >= 0; i--) {
    buffer[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return buffer;
}

function simpleBlock(milliseconds: number, text: string): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0x81; // track number 1 (VINT)
  header.writeInt16BE(milliseconds, 1);
  header[3] = 0; // no lacing, keyframe
  return element([0xa3], Buffer.concat([header, Buffer.from(text)]));
}

function matroskaFixture(): Buffer {
  const info = element(
    [0x15, 0x49, 0xa9, 0x66],
    element([0x2a, 0xd7, 0xb1], uint(1_000_000, 3)),
  );
  const entry = Buffer.concat([
    element([0xd7], uint(1, 1)),          // TrackNumber
    element([0x83], uint(0x11, 1)),       // TrackType = subtitle
    element([0x86], Buffer.from("S_TEXT/UTF8")),
    element([0x22, 0xb5, 0x9c], Buffer.from("eng")),
    element([0x53, 0x6e], Buffer.from("English")),
    element([0x88], uint(1, 1)),          // FlagDefault
  ]);
  const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], entry));
  const cluster = element(
    [0x1f, 0x43, 0xb6, 0x75],
    Buffer.concat([
      element([0xe7], uint(0, 1)),        // cluster timestamp 0
      simpleBlock(1_000, "Hello"),
      simpleBlock(2_000, "Second line"),
    ]),
  );
  const segment = element(
    [0x18, 0x53, 0x80, 0x67],
    Buffer.concat([info, tracks, cluster]),
  );
  return Buffer.concat([element([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)), segment]);
}

let dir: string | null = null;

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("Matroska subtitle parsing", () => {
  test("reads track metadata and block timestamps", async () => {
    dir = await mkdtemp(join(tmpdir(), "plexy-mkv-"));
    const path = join(dir, "fixture.mkv");
    await writeFile(path, matroskaFixture());

    const tracks = await probeMatroskaSubtitles(path);
    expect(tracks).toHaveLength(1);
    expect(tracks![0]).toMatchObject({
      number: 1,
      codec: "srt",
      language: "eng",
      title: "English",
      isDefault: true,
    });

    const result = await readMatroskaSubtitles(path);
    expect(result).not.toBeNull();
    const packets = result!.packets.get(1) ?? [];
    expect(packets).toHaveLength(2);
    expect(packets[0]!.timestamp).toBeCloseTo(1, 3);
    expect(packets[0]!.duration).toBeCloseTo(1, 3); // inferred from the next cue
    expect(packets[1]!.timestamp).toBeCloseTo(2, 3);
    expect(new TextDecoder().decode(packets[0]!.data)).toBe("Hello");

    const cues = packets.flatMap((packet) =>
      packetToCues(packet.data, "srt", packet.timestamp, packet.duration));
    const vtt = cuesToVtt(cues);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000");
    expect(vtt).toContain("Second line");
  });

  test("returns null for files that are not Matroska", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "plexy-mkv-"));
    const path = join(dir, "not-a-video.bin");
    await writeFile(path, "not a video");
    expect(await probeMatroskaSubtitles(path)).toBeNull();
    expect(await readMatroskaSubtitles(path)).toBeNull();
  });
});
