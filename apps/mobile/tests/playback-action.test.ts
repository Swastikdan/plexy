import { expect,test } from "bun:test";
import { playbackAction } from "../src/features/catalog/lib/playback-action";

test("movie actions distinguish starting, resuming and replaying", () => {
  expect(playbackAction({}).label).toBe("Start watching");
  expect(playbackAction({ watch: { position: 30 } }).label).toBe(
    "Continue watching",
  );
  expect(playbackAction({ watch: { position: 30, played: true } }).label).toBe(
    "Watch again",
  );
});
test("series action describes the same next playable episode it selects", () => {
  const result = playbackAction({ kind: "series" }, [
    { fileId: 3, seasonNumber: 2, episodeNumber: 1 },
    { fileId: 2, seasonNumber: 1, episodeNumber: 3, watch: { position: 120 } },
    { fileId: 1, seasonNumber: 1, episodeNumber: 2, watch: { played: true } },
  ]);
  expect(result.fileId).toBe(2);
  expect(result.label).toBe("Continue watching");
  expect(result.context).toBe("Season 1 · Episode 3");
});
test("fresh episodes and specials retain their episode context", () => {
  expect(playbackAction({ episodeNumber: 1 }).context).toBe("Episode 1");
  expect(playbackAction({ seasonNumber: 0, episodeNumber: 2 }).context).toBe(
    "Specials · Episode 2",
  );
  expect(
    playbackAction({}, [{ fileId: 1, seasonNumber: 1, episodeNumber: 1 }])
      .label,
  ).toBe("Start watching");
});

test("a continue-watching card retains its explicit playback target", () => {
  const result = playbackAction({ kind: "series", fileId: 3 }, [
    { fileId: 1, seasonNumber: 1, episodeNumber: 1 },
    { fileId: 3, seasonNumber: 1, episodeNumber: 3, watch: { position: 60 } },
  ]);
  expect(result.fileId).toBe(3);
  expect(result.context).toBe("Season 1 · Episode 3");
  expect(result.label).toBe("Continue watching");
});
