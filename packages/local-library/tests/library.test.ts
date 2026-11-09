import { describe, expect, test } from "bun:test";
import { LocalLibrary, parseLocalName, localSegments, type LocalFile, type LocalIO, type LocalState } from "../src/library";
import { LocalApi } from "../../native-client/src/local-api";
const file = (name = "Arrival.2016.mp4", size = 100): LocalFile => ({
  uri: `content://videos/${name}`, name, relativePath: name, size, modified: size,
});
function fixture() {
  let files = [file()];
  let unavailable = false;
  let saved: LocalState | null = null;
  const io: LocalIO = {
    load: async () => saved,
    save: async state => { saved = structuredClone(state); },
    walk: async () => { if (unavailable) throw Error("permission denied"); return files; },
    metadata: async () => null,
  };
  const library = new LocalLibrary(io);
  return { library, io, files: (next: LocalFile[]) => files = next,
    unavailable: (next: boolean) => unavailable = next, saved: () => saved };
}
const root = { uri: "content://videos", name: "Movies", kind: "movies" as const };
describe("device library", () => {
  test("indexes offline, preserves identity and watch progress across changes and restart", async () => {
    const f = fixture();
    await f.library.addRoot(root);
    const record = f.library.state.records[0]!;
    expect(record.card.name).toBe("Arrival");
    expect(record.card.year).toBe(2016);
    await f.library.progress(record.id, 120, 600);
    f.files([file(undefined, 200)]);
    await f.library.scan();
    expect(f.library.record(record.id).file.size).toBe(200);
    const restored = new LocalLibrary(f.io);
    await restored.restore();
    expect(restored.record(record.id).card.watch?.position).toBe(120);
    expect(restored.record(record.id).card.watch?.percent).toBe(20);
  });
  test("an incomplete folder walk keeps cached files; a completed walk removes deleted files", async () => {
    const f = fixture(); await f.library.addRoot(root);
    f.unavailable(true); f.files([]); await f.library.scan();
    expect(f.library.state.records).toHaveLength(1);
    expect(f.library.issues).toHaveLength(1);
    f.unavailable(false); await f.library.scan();
    expect(f.library.state.records).toHaveLength(0);
  });
  test("metadata failure retains filename catalog and existing cached artwork", async () => {
    const f = fixture(); await f.library.addRoot(root);
    const record = f.library.state.records[0]!;
    record.card.poster = "file:///poster.jpg";
    f.io.metadata = async () => { throw Error("offline"); };
    await f.library.scan();
    expect(f.library.cards()[0]!.poster).toBe("file:///poster.jpg");
    expect(f.saved()!.records).toHaveLength(1);
  });
  test("groups and orders local series episodes, keeping series IDs stable", async () => {
    const f = fixture();
    f.files([file("Show/Season 01/Show.S01E02.mkv"), file("Show/Season 01/Show.S01E01.mkv")]);
    await f.library.addRoot({ ...root, kind: "tv" });
    const card = f.library.cards()[0]!;
    expect(card.kind).toBe("series"); expect(card.name).toBe("Show");
    expect(f.library.detail(card.id).episodes?.map(c => c.episodeNumber)).toEqual([1,2]);
    await f.library.scan(); expect(f.library.cards()[0]!.id).toBe(card.id);
    await f.library.progress(card.id, 0, null, true);
    expect(f.library.cards()[0]!.watch?.played).toBe(true);
    await f.library.clearWatch(card.id);
    expect(f.library.cards()[0]!.watch).toBeNull();
  });
  test("concurrent scans share one walk", async () => {
    const f = fixture(); await f.library.addRoot(root);
    let calls = 0;
    f.io.walk = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return [file()]; };
    await Promise.all([f.library.scan(), f.library.scan()]);
    expect(calls).toBe(1);
  });
  test("metadata refresh cannot overwrite newer progress", async () => {
    const f = fixture(); await f.library.addRoot(root);
    const record = f.library.state.records[0]!;
    f.io.metadata = async () => {
      const card = { ...record.card, name: "Arrival (matched)" };
      await f.library.progress(record.id, 77, 600);
      return { card, metadataAt: Date.now() };
    };
    await f.library.scan();
    expect(record.card.name).toBe("Arrival (matched)");
    expect(record.card.watch?.position).toBe(77);
  });
  test("local API lists, searches, resumes and directly plays content URIs without networking", async () => {
    const f = fixture(); await f.library.addRoot(root);
    const api = new LocalApi(f.library, async () => "", async () => []);
    expect((await api.home()).rows[0]!.items[0]!.name).toBe("Arrival");
    expect((await api.search("arrival")).titles).toHaveLength(1);
    const id = f.library.state.records[0]!.id;
    await api.progress(id, 90, 600);
    expect((await api.play(id)).watch?.position).toBe(90);
    expect(api.stream(id)).toBe(file().uri);
    expect((await api.play(id)).path).toBe("direct");
    expect((await api.detail(`local-${id}`)).file?.size).toBe(100);
    await api.clearWatch(id); expect((await api.play(id)).watch).toBeNull();
  });
  test("removing a root only removes its index and does not delete media", async () => {
    const f = fixture(); await f.library.addRoot(root);
    await f.library.removeRoot(root.uri);
    expect(f.library.cards()).toHaveLength(0);
    expect(f.saved()!.roots).toHaveLength(0);
  });
  test("parses episode numbers and explicit movie IDs", () => {
    expect(parseLocalName("Show/Season 2/Show.2x03.mkv", "tv")).toMatchObject({ title: "Show", season: 2, episode: 3 });
    expect(parseLocalName("Arrival (2016) [tmdb-329865].mkv", "movies")).toMatchObject({ title: "Arrival", year: 2016, explicitId: 329865 });
  });
});

test("cached skip markers keep seconds and reject implausible windows for this cut", () => {
  expect(localSegments({ intro: { start_ms: 1000, end_ms: 20000 } }, 600).intro).toEqual({ start: 1, end: 20 });
  expect(localSegments({ intro: { start: 1, end: 20 } }, 600).intro).toEqual({ start: 1, end: 20 });
  expect(localSegments({ outro: { start: 100, end: 300 } }, 1200).outro).toBeNull();
  expect(localSegments({ intro: { start: 1, end: 1000 } }, 600).intro).toBeNull();
});
