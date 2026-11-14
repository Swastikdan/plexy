import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPreparedArtifact,
  moveToLocalTrash,
  removeOriginal,
  replacementTargetFor,
} from "../src/trash";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "plexy-trash-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("original media deletion policy", () => {
  test("the permanent policy unlinks the source", async () => {
    const dir = await tempDir();
    const file = join(dir, "Movie.mkv");
    await writeFile(file, "data");
    expect(await removeOriginal(file, "permanent")).toEqual({
      trashPath: null,
      method: "permanent",
    });
    expect(await Bun.file(file).exists()).toBe(false);
  });

  test("the local fallback preserves the source in .plexy/trash", async () => {
    const dir = await tempDir();
    const file = join(dir, "Movie.mkv");
    await writeFile(file, "data");
    const trashed = await moveToLocalTrash(file);
    expect(trashed.startsWith(join(dir, ".plexy", "trash"))).toBe(true);
    expect(await readFile(trashed, "utf8")).toBe("data");
    expect(await Bun.file(file).exists()).toBe(false);
  });

  test("replacement targets use MP4 and never overwrite another file", async () => {
    const dir = await tempDir();
    const source = join(dir, "Movie.mkv");
    expect(await replacementTargetFor(source)).toBe(join(dir, "Movie.mp4"));
    await writeFile(join(dir, "Movie.mp4"), "existing");
    expect(await replacementTargetFor(source)).toBe(join(dir, "Movie (1).mp4"));
    // An in-place MP4 replacement keeps its own name.
    expect(await replacementTargetFor(join(dir, "Movie.mp4"))).toBe(join(dir, "Movie.mp4"));
  });

  test("only managed prepared artifacts count as removable cache files", () => {
    expect(isPreparedArtifact("/media/Movies/.plexy/optimized/1-2.mp4")).toBe(true);
    expect(isPreparedArtifact("/media/Movies/.plexy/optimized/1-2.mp4.part")).toBe(true);
    expect(isPreparedArtifact("/media/Movies/Movie.mkv")).toBe(false);
    expect(isPreparedArtifact("/media/Movies/.plexy/other/1-2.mp4")).toBe(false);
    expect(isPreparedArtifact("/media/Movies/.plexy/trash/old-Movie.mkv")).toBe(false);
  });
});
