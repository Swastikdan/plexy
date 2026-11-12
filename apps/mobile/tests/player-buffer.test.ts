import { expect,test } from "bun:test";
import { bufferOptionsForDuration } from "../src/features/player/lib/player-buffer";

test("read-ahead aims for 30 percent on short clips but bounds time and memory for movies", () => {
  expect(bufferOptionsForDuration(200).preferredForwardBufferDuration).toBe(60);
  expect(bufferOptionsForDuration(7200).preferredForwardBufferDuration).toBe(
    120,
  );
  expect(bufferOptionsForDuration(0).preferredForwardBufferDuration).toBe(30);
  expect(bufferOptionsForDuration(NaN).preferredForwardBufferDuration).toBe(30);
  const options = bufferOptionsForDuration(7200);
  expect(options.maxBufferBytes).toBe(64 * 1024 * 1024);
  expect(options.prioritizeTimeOverSizeThreshold).toBe(false);
  expect(options.minBufferForPlayback).toBe(1);
});
