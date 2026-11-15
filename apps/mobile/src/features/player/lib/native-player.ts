import type { VideoPlayer } from "expo-video";

/** Expo's player is an imperative native handle, rather than React state. */
export function updateNativePlayer<K extends keyof VideoPlayer>(player: VideoPlayer, key: K, value: VideoPlayer[K]) {
  player[key] = value;
}
