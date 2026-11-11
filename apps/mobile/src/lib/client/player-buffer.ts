import type { BufferOptions } from "expo-video";

/** Local files are already on disk: bound read-ahead rather than holding gigabytes in RAM. */
export function bufferOptionsForDuration(duration: number): BufferOptions {
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return {
    preferredForwardBufferDuration: Math.min(120, Math.max(30, seconds * 0.3)),
    minBufferForPlayback: 1,
    maxBufferBytes: 64 * 1024 * 1024,
    prioritizeTimeOverSizeThreshold: false,
    waitsToMinimizeStalling: true,
  };
}
