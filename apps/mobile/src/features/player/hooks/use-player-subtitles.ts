import { updateNativePlayer } from "../lib/native-player";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { useLayoutEffect , useEffect, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";
import { useClient } from "@/core/client/client-provider";
import type { Playability } from "@/core/library/catalog-api";
import { parseVtt, subtitleText, type Cue } from "../lib/subtitles";
export function usePlayerSubtitles({
  initial,
  fileId,
  player,
  position,
  onError,
}: {
  initial: Playability;
  fileId: number;
  player: VideoPlayer;
  position: number;
  onError: (message: string) => void;
}) {
  const { api, preferences } = useClient();
  const latest = useRef({ preferences, onError });
  useLayoutEffect(() => { latest.current = { preferences, onError }; }, [preferences, onError]);
  const [subtitle, setSubtitle] = useState<string | null>(() =>
    preferences.autoSubtitles
      ? initial.tracks?.find((t) => t.language === preferences.subtitleLanguage)
          ?.track ||
        initial.tracks?.find((t) => t.isDefault)?.track ||
        null
      : null,
  );
  const cueKey = `${fileId}:${subtitle}`;
  const [loadedCues, setLoadedCues] = useState<{ key: string; cues: Cue[] } | null>(null);
  const [nativeSubtitles, setNativeSubtitles] = useState<
    VideoPlayer["availableSubtitleTracks"]
  >([]);
  const [subVertical, setSubVertical] = useState<number>(
    preferences.subtitlePosition === "top" ? 12 : 88,
  );
  useEffect(() => {
    const controller = new AbortController();
    {
      updateNativePlayer(player, "subtitleTrack", subtitle?.startsWith("native:")
        ? nativeSubtitles.find((t) => `native:${t.id}` === subtitle) || null
        : null);
      if (subtitle?.startsWith("native:")) return;
    }
    if (!subtitle) return;
    api
      .subtitle(fileId, subtitle, controller.signal)
      .then((text) => {
        if (!controller.signal.aborted) setLoadedCues({ key: cueKey, cues: parseVtt(text) });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          latest.current.onError("Subtitle track could not be loaded.");
      });
    return () => controller.abort();
  }, [api, fileId, subtitle, nativeSubtitles, player, cueKey]);

  const loadSubtitleTracks = useEventCallback((
    tracks: VideoPlayer["availableSubtitleTracks"],
  ) => {
    updateNativePlayer(player, "subtitleTrack", null);
    setNativeSubtitles(tracks);
    const { preferences } = latest.current;
    if (preferences.autoSubtitles && !initial.tracks?.length) {
      const track = tracks.find(
        (t) => t.language === preferences.subtitleLanguage,
      );
      if (track) {
        updateNativePlayer(player, "subtitleTrack", track);
        setSubtitle(`native:${track.id}`);
      }
    }
  });
  return {
    subtitle,
    setSubtitle,
    nativeSubtitles,
    subVertical,
    setSubVertical,
    loadSubtitleTracks,
    text: subtitleText(loadedCues?.key === cueKey ? loadedCues.cues : [], position, preferences.subtitleOffset),
  };
}
