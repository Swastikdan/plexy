import { describe, expect, test } from "bun:test";
import { LocalLibrary, parseLocalName, localSegments, localFileKey, type LocalFile, type LocalIO, type LocalState } from "../src/library";
import { LocalApi } from "../../../apps/mobile/src/lib/client/local-api";
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
    expect(parseLocalName("2001.A.Space.Odyssey.1968.mkv", "movies")).toMatchObject({ title: "2001 A Space Odyssey", year: 1968 });
    expect(parseLocalName("1917.mkv", "movies")).toMatchObject({ title: "1917", year: null });
    expect(parseLocalName("Spider-Man (2002)/Spider-Man.mkv", "movies")).toMatchObject({ title: "Spider-Man", year: 2002 });
    expect(parseLocalName("ER/Season 02/03.mkv", "tv")).toMatchObject({ title: "ER", season: 2, episode: 3 });
  });
});

test("cached skip markers keep seconds and reject implausible windows for this cut", () => {
  expect(localSegments({ intro: { start_ms: 1000, end_ms: 20000 } }, 600).intro).toEqual({ start: 1, end: 20 });
  expect(localSegments({ intro: { start: 1, end: 20 } }, 600).intro).toEqual({ start: 1, end: 20 });
  expect(localSegments({ outro: { start: 100, end: 300 } }, 1200).outro).toBeNull();
  expect(localSegments({ intro: { start: 1, end: 1000 } }, 600).intro).toBeNull();
});

test("imported subtitles persist across restart and metadata publishes without manual refresh", async () => {
  const f = fixture(); await f.library.addRoot(root);
  const id = f.library.state.records[0]!.id;
  await f.library.addSubtitle(id, { track: "file:///private/subtitle.srt", title: "Custom", kind: "sidecar", language: null });
  const restored = new LocalLibrary(f.io); await restored.restore();
  expect(restored.record(id).externalSubtitles?.[0]?.title).toBe("Custom");
  const changes: string[] = [];
  f.library.subscribe(() => changes.push(f.library.record(id).card.name));
  f.io.metadata = async record => ({ card: { ...record.card, name: "Metadata title" }, metadataAt: Date.now() });
  await f.library.scan();
  expect(changes).toContain("Metadata title");
});

test("manually removed titles stay excluded on subsequent scans and restarts", async () => {
  const f=fixture();await f.library.addRoot(root);
  await f.library.removeTitle(f.library.cards()[0]!.id);await f.library.scan();
  expect(f.library.cards()).toHaveLength(0);
  const restored=new LocalLibrary(f.io);await restored.restore();await restored.scan();expect(restored.cards()).toHaveLength(0);
});
test("manual identification preserves progress and season numbering across a series", async () => {
  const f=fixture();f.files([file("Show/Season 01/Show.S01E01.mkv"),file("Show/Season 02/Show.S02E03.mkv")]);
  await f.library.addRoot({...root,kind:"tv"});
  const series=f.library.cards()[0]!;const first=f.library.state.records[0]!;
  await f.library.progress(first.id,100,600);
  await f.library.identify(series.id,{kind:"tv",title:"Correct Show",tmdbId:42,season:1,episode:1});
  expect(f.library.state.records.map(r=>r.tmdbId)).toEqual([42,42]);
  expect(f.library.state.records.map(r=>r.card.seasonNumber)).toEqual([1,2]);
  expect(f.library.state.records[1]!.card.episodeNumber).toBe(3);
  expect(first.card.watch?.position).toBe(100);expect(f.library.cards()[0]!.name).toBe("Correct Show");
});
test("a movie can be manually reclassified as a TV episode", async () => {
  const f=fixture();await f.library.addRoot(root);const id=f.library.cards()[0]!.id;
  await f.library.identify(id,{kind:"tv",title:"My Show",season:0,episode:2});
  expect(f.library.cards()[0]!.kind).toBe("series");expect(f.library.record(id).card.seasonNumber).toBe(0);
  expect(f.library.detail(f.library.cards()[0]!.id).seasons?.[0]?.number).toBe(0);
});
test("correcting one episode number does not alter its siblings",async()=>{
 const f=fixture();f.files([file("Show/Show.S01E01.mkv"),file("Show/Show.S01E02.mkv")]);
 await f.library.addRoot({...root,kind:"tv"});const [first,second]=f.library.state.records;
 await f.library.identify(first!.id,{kind:"tv",title:"Show",season:0,episode:3});
 expect(first!.card.seasonNumber).toBe(0);expect(first!.card.episodeNumber).toBe(3);
 expect(second!.card.seasonNumber).toBe(1);expect(second!.card.episodeNumber).toBe(2);
});

test("file and folder pickers resolve the same Android document identity",()=>{
 expect(localFileKey("content://provider/tree/primary%3AMovies/document/primary%3AMovies%2FArrival.mkv")).toBe(localFileKey("content://provider/document/primary%3AMovies%2FArrival.mkv"));
});
test("episode filenames are detected even inside a movie folder",async()=>{
 const f=fixture();f.files([file("Show.S01E02.mkv")]);await f.library.addRoot(root);
 expect(f.library.cards()[0]!.kind).toBe("series");expect(f.library.state.records[0]!.card.episodeNumber).toBe(2);
});
test("series cards do not leak an episode label or season number into home and search",async()=>{
 const f=fixture();f.files([file("Show/Show.S01E02.mkv")]);await f.library.addRoot({...root,kind:"tv"});
 const series=f.library.cards()[0]!;expect(series.parentTitle).toBeNull();expect(series.parentPublicId).toBeNull();expect(series.seasonNumber).toBeNull();expect(series.episodeNumber).toBeNull();
});

test("metadata preferences persist and disabled markers suppress cached and network timings", async () => {
  const f = fixture(); await f.library.addRoot(root);
  const r = f.library.state.records[0]!; r.tmdbId = 1;
  let calls = 0;
  f.io.markers = async () => { calls++; return {intro:{start:10,end:40},recap:null,outro:null}; };
  await f.library.updateMetadataSettings({ language:"hi-IN", region:"IN", posterSize:"w500", markersEnabled:false });
  expect((await f.library.getMarkers(r.id)).intro).toBeNull(); expect(calls).toBe(0);
  const restored = new LocalLibrary(f.io); await restored.restore();
  expect(restored.metadataSettings.language).toBe("hi-IN"); expect(restored.metadataSettings.markersEnabled).toBe(false);
  await restored.updateMetadataSettings({markersEnabled:true});
  expect((await restored.getMarkers(r.id)).intro?.end).toBe(40); expect(calls).toBe(1);
  await restored.getMarkers(r.id); expect(calls).toBe(1);
  const again = new LocalLibrary(f.io); await again.restore();
  expect((await again.getMarkers(r.id)).intro?.end).toBe(40); expect(calls).toBe(1);
  expect(await again.refreshMarkers()).toEqual({checked:1,found:1}); expect(calls).toBe(2);
});

test("empty marker responses cache; temporary failures keep previous timings and retry", async () => {
  const f = fixture(); await f.library.addRoot(root);
  const r = f.library.state.records[0]!; r.tmdbId = 1;
  let calls = 0;
  f.io.markers = async () => { calls++; return {intro:null,recap:null,outro:null}; };
  await f.library.getMarkers(r.id); await f.library.getMarkers(r.id); expect(calls).toBe(1);
  r.skips = {intro:null,recap:{start:0,end:30},outro:{start:650,end:700}}; r.skipsAt = 0;
  f.io.markers = async () => { calls++; throw Error("offline"); };
  expect((await f.library.getMarkers(r.id)).recap?.end).toBe(30);
  expect((await f.library.getMarkers(r.id)).outro?.start).toBe(650); expect(calls).toBe(3);
});

test("playback marker requests share one lookup and discard results for a changed identity", async () => {
  const f = fixture(); await f.library.addRoot(root);
  const r = f.library.state.records[0]!; r.tmdbId = 1;
  let resolve!: (value:any) => void; let calls = 0;
  f.io.markers = () => {calls++; return new Promise(done => {resolve = done;});};
  const a = f.library.getMarkers(r.id), b = f.library.getMarkers(r.id);
  expect(calls).toBe(1);
  await f.library.identify(r.id,{kind:"movies",title:"Another",tmdbId:2});
  resolve({intro:{start:0,end:30},recap:null,outro:null});
  expect((await a).intro).toBeNull(); expect((await b).intro).toBeNull(); expect(r.skips).toBeUndefined();
});

test("local playback API fetches missing markers without requiring a scan", async () => {
  const f = fixture(); await f.library.addRoot(root);
  const r = f.library.state.records[0]!; r.tmdbId = 1;
  f.io.markers = async () => ({intro:{start:5,end:35},recap:null,outro:null});
  const api = new LocalApi(f.library, async () => "", async () => []);
  expect((await api.skips(r.id)).intro?.end).toBe(35);
});
