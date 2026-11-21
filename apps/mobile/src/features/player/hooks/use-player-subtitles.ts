import { updateNativePlayer } from "@/features/player/lib/native-player";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { useEffect, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";
import { useClient } from "@/core/client/client-provider";
import type { Playability } from "@/core/library/catalog-api";
import {
  parseVtt,
  preferredSubtitleTrack,
  subtitleText,
  type Cue,
} from "@/features/player/lib/subtitles";
export function usePlayerSubtitles({
  manifest,
  player,
  position,
  onError,
  showLanguage,
}: {
  manifest: Playability;
  player: VideoPlayer;
  position: number;
  onError: (message: string) => void;
  showLanguage?: string | null;
}) {
  const { api, preferences } = useClient();
  const fileId = manifest.fileId;
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const sessionChoice = useRef<string | null | undefined>(undefined);
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
          onError("Subtitle track could not be loaded.");
      });
    return () => controller.abort();
  }, [api, fileId, subtitle, nativeSubtitles, player, cueKey, onError]);

  const subtitleOptions = (tracks: VideoPlayer["availableSubtitleTracks"]) => [
    ...(manifest.tracks ?? []).map((track) => ({ ...track, key: track.track })),
    ...tracks.map((track) => ({
      key: `native:${track.id}`,
      language: track.language,
      isDefault: track.isDefault,
    })),
  ];
  const loadSubtitleTracks = useEventCallback((tracks: VideoPlayer["availableSubtitleTracks"]) => {
    updateNativePlayer(player, "subtitleTrack", null);
    setNativeSubtitles(tracks);
    const options = subtitleOptions(tracks);
    const manual = sessionChoice.current;
    if (manual === null || options.some((track) => track.key === manual)) {
      setSubtitle(manual ?? null);
      return;
    }
    setSubtitle(preferredSubtitleTrack(
      options,
      showLanguage,
      preferences.autoSubtitles,
      preferences.subtitleLanguage,
    ));
  });
  return {
    subtitle,
    pickSubtitle(value: string | null) {
      sessionChoice.current = value;
      setSubtitle(value);
    },
    resetSubtitle() {
      sessionChoice.current = undefined;
      setSubtitle(preferredSubtitleTrack(
        subtitleOptions(nativeSubtitles),
        undefined,
        preferences.autoSubtitles,
        preferences.subtitleLanguage,
      ));
    },
    nativeSubtitles,
    subVertical,
    setSubVertical,
    loadSubtitleTracks,
    text: subtitleText(loadedCues?.key === cueKey ? loadedCues.cues : [], position, preferences.subtitleOffset),
  };
}
