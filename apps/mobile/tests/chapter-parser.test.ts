import { expect, test } from "bun:test";
import {
  findSequence,
  isMkvSeekReference,
  parseChpl,
  parseMkvChapters,
  readEbmlSizeAt,
} from "@/core/library/chapter-parser";

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u32 = (value: number) =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const u64 = (value: number) =>
  new Uint8Array([
    0,
    0,
    0,
    (value / 2 ** 32) & 0xff,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const ascii = (value: string) => new TextEncoder().encode(value);

function chplEntry(start: number, label: string) {
  return concat(u64(start), new Uint8Array([label.length]), ascii(label));
}

test("chpl chapters include both the reserved-header and compact layouts", () => {
  const standard = concat(
    new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 2]),
    chplEntry(0, "Intro"),
    chplEntry(10 * 10_000_000, "Main"),
  );
  expect(parseChpl(standard, 100)).toEqual([
    { start: 0, end: 10, label: "Intro" },
    { start: 10, end: 100, label: "Main" },
  ]);

  const compact = concat(
    new Uint8Array([1, 0, 0, 0, 2]),
    chplEntry(0, "Cold open"),
    chplEntry(30 * 10_000_000, "Feature"),
  );
  expect(parseChpl(compact, 60)).toEqual([
    { start: 0, end: 30, label: "Cold open" },
    { start: 30, end: 60, label: "Feature" },
  ]);
});

function vint(value: number) {
  for (let length = 1; length <= 4; length += 1) {
    const max = 2 ** (7 * length) - 1;
    if (value < max) {
      const out = new Uint8Array(length);
      let remaining = value;
      for (let i = length - 1; i >= 0; i -= 1) {
        out[i] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      out[0] = out[0]! | (0x80 >> (length - 1));
      return out;
    }
  }
  throw new Error("value too large");
}

function element(id: number[], payload: Uint8Array) {
  return concat(new Uint8Array(id), vint(payload.length), payload);
}

test("EBML size fields expose the payload size used by file scanning", () => {
  for (const size of [0, 42, 126, 127, 255, 16382, 16383]) {
    const encoded = vint(size);
    const header = concat(new Uint8Array([0x10, 0x43, 0xa7, 0x70]), encoded);
    expect(readEbmlSizeAt(header, 4)).toEqual({
      size, length: encoded.length, unknown: false,
    });
  }
  expect(readEbmlSizeAt(new Uint8Array([0xff]), 0)).toEqual({
    size: 127, length: 1, unknown: true,
  });
  expect(readEbmlSizeAt(new Uint8Array([0x40]), 0)).toBeNull();
  expect(readEbmlSizeAt(new Uint8Array([0]), 0)).toBeNull();
  expect(readEbmlSizeAt(new Uint8Array(0), 0)).toBeNull();
});

function uintElement(id: number[], value: number) {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return element(id, new Uint8Array(bytes));
}

const stringElement = (id: number[], value: string) =>
  element(id, ascii(value));

function chapterAtom(start: number, label: string) {
  return element(
    [0xb6],
    concat(
      uintElement([0x91], start),
      element(
        [0x80],
        concat(
          stringElement([0x85], label),
          stringElement([0x43, 0x7c], "eng"),
        ),
      ),
    ),
  );
}

test("Matroska chapter atoms and displays are flattened", () => {
  const edition = element(
    [0x45, 0xb9],
    concat(chapterAtom(0, "Intro"), chapterAtom(15_000_000_000, "Part 2")),
  );
  expect(parseMkvChapters(edition, 60)).toEqual([
    { start: 0, end: 15, label: "Intro" },
    { start: 15, end: 60, label: "Part 2" },
  ]);
});

test("byte scanning finds every marker", () => {
  expect(findSequence(new Uint8Array([1, 2, 3, 2, 3]), [2, 3])).toEqual([
    1, 3,
  ]);
});

test("EBML sizes accept non-canonical length encodings", () => {
  expect(
    readEbmlSizeAt(new Uint8Array([0x01, 0, 0, 0, 0, 0, 0, 0x45]), 0),
  ).toEqual({ size: 69, length: 8, unknown: false });
});

test("SeekHead chapter references are not treated as chapter elements", () => {
  expect(
    isMkvSeekReference(
      new Uint8Array([0x53, 0xab, 0x84, 0x10, 0x43, 0xa7, 0x70]),
      3,
    ),
  ).toBe(true);
  expect(
    isMkvSeekReference(
      new Uint8Array([0x00, 0x45, 0xb9, 0x10, 0x43, 0xa7, 0x70]),
      3,
    ),
  ).toBe(false);
});
