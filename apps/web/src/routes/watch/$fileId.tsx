/// Fullscreen Cinema Player using Video.js 10 and Plexy playback engine.
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, SkipForward } from "lucide-react";

import { VideoPlayer, Video, usePlayer } from "@videojs/react/video";
import { selectControls } from "@videojs/core/dom";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { VideoSkin } from "@/components/videojs/video/skin";
import { api, type Playability, type SubtitleTrack } from "../../client";
import { probeBrowserCaps } from "@plexy/api-client";
import { queries } from "../../queries";
import { useIsFullscreen } from "../../lib/use-fullscreen";

const NEXT_SKIP_KEY = "plexy:next-episode-skips:v1";
const SEGMENT_SKIP_KEY = "plexy:segment-skips:v1";

function readNextSkips(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(NEXT_SKIP_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function getNextSkipCount(series: string): number {
  if (typeof localStorage === "undefined") return 0;
  return readNextSkips()[series] ?? 0;
}

function rememberNextSkip(series: string): void {
  if (typeof localStorage === "undefined") return;
  const skips = readNextSkips();
  skips[series] = (skips[series] ?? 0) + 1;
  localStorage.setItem(NEXT_SKIP_KEY, JSON.stringify(skips));
}

function readSegmentSkips(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEGMENT_SKIP_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function segmentSkipCount(series: string, kind: "intro" | "recap"): number {
  if (typeof localStorage === "undefined") return 0;
  return readSegmentSkips()[`${series}:${kind}`] ?? 0;
}

function rememberSegmentSkip(series: string, kind: "intro" | "recap"): void {
  if (typeof localStorage === "undefined") return;
  const skips = readSegmentSkips();
  const key = `${series}:${kind}`;
  skips[key] = (skips[key] ?? 0) + 1;
  localStorage.setItem(SEGMENT_SKIP_KEY, JSON.stringify(skips));
}

/** Mirrors the skin's own controls visibility so the custom chrome fades in sync. */
function ControlsVisibility({ onChange }: { onChange: (visible: boolean) => void }) {
  const controls = usePlayer(selectControls);
  const visible = controls?.controlsVisible ?? true;
  useEffect(() => {
    onChange(visible);
  }, [visible, onChange]);
  return null;
}

function WatchRoute() {
  const { fileId } = useParams({ from: Route.id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously probe browser capabilities so query is enabled immediately on mount (prevents deadlock)
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const [restartAt, setRestartAt] = useState<{ fileId: number; seconds: number } | null>(null);
  const seekDragRef = useRef(false);
  const deferredSeekRef = useRef<number | null>(null);
  const restartPlaybackRef = useRef(true);
  const commitSeekNowRef = useRef(false);
  const pendingRestartRef = useRef<{ fileId: number; seconds: number } | null>(null);
  const restartDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedButtonSeekRef = useRef<number | null>(null);
  const buttonSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceRef = useRef(false);
  const autoAdvanceTriggeredRef = useRef(false);

  // Audio track and subtitle sync state
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number>(0);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const appliedSubtitleOffsetRef = useRef<number>(0);
  // Vertical placement of the caption track, in pixels (positive lifts it up).
  const [subtitlePosition, setSubtitlePosition] = useState<number>(0);
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [activeSkipSegment, setActiveSkipSegment] = useState<"intro" | "recap" | null>(null);
  const nextPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBufferingAfterDelay = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = setTimeout(() => setIsBuffering(true), 180);
  }, []);

  const hideBuffering = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = null;
    setIsBuffering(false);
  }, []);

  // Fetch complete player manifest
  const hasInitializedAudioRef = useRef(false);
  useEffect(() => {
    hasInitializedAudioRef.current = false;
    seekDragRef.current = false;
    deferredSeekRef.current = null;
    restartPlaybackRef.current = true;
    pendingRestartRef.current = null;
    if (restartDebounceRef.current) clearTimeout(restartDebounceRef.current);
    queuedButtonSeekRef.current = null;
    if (buttonSeekTimerRef.current) clearTimeout(buttonSeekTimerRef.current);
    setSelectedAudioIndex(0);
    setSubtitleOffset(0);
    appliedSubtitleOffsetRef.current = 0;
    setRestartAt(null);
    setKnownDuration(null);
    setShowNextPrompt(false);
    setActiveSkipSegment(null);
    autoAdvanceTriggeredRef.current = false;
    if (nextPromptTimerRef.current) clearTimeout(nextPromptTimerRef.current);
  }, [fileId]);

  const play = useQuery({
    queryKey: ["play", fileId, caps],
    queryFn: async () => {
      const manifest = await api.play(Number(fileId), JSON.parse(caps));
      if (manifest.duration) {
        setKnownDuration(manifest.duration);
      }
      return manifest;
    },
    enabled: !!caps,
  });

  // Set default audio track from manifest once on initial load
  useEffect(() => {
    if (!hasInitializedAudioRef.current && play.data?.audioTracks && play.data.audioTracks.length > 0) {
      hasInitializedAudioRef.current = true;
      const preferredIdx = play.data.selectedAudioIndex ?? -1;
      const defaultIdx = play.data.audioTracks.findIndex((t: any) => t.isDefault);
      setSelectedAudioIndex(Number.isInteger(preferredIdx) && preferredIdx >= 0
        ? preferredIdx
        : defaultIdx >= 0 ? defaultIdx : 0);
    }
  }, [play.data?.audioTracks, play.data?.selectedAudioIndex]);

  // Subtitle tracks
  const tracksQuery = useQuery({ ...queries.subtitles(Number(fileId)), enabled: !!caps });
  const tracks = (tracksQuery.data?.tracks ?? []) as (SubtitleTrack & { isDefault?: boolean })[];
  const skipSegmentsQuery = useQuery({
    queryKey: ["skip-segments", fileId],
    queryFn: () => api.skipSegments(Number(fileId)),
    enabled: !!fileId,
    staleTime: 24 * 60 * 60_000,
  });

  const resumeAt =
    play.data?.watch && !play.data.watch.played && play.data.watch.position > 15
      ? play.data.watch.position
      : 0;

  const streamStart =
    (play.data?.path === "hls" && selectedAudioIndex === (play.data.selectedAudioIndex ?? 0))
      || (play.data?.path === "direct" && selectedAudioIndex === 0)
      ? 0
      : restartAt?.fileId === Number(fileId)
        ? restartAt.seconds
        : resumeAt;

  const effectivePath = useMemo(() => {
    if (!play.data || play.data.path === "unsupported") return null;
    // If original direct play, but user selected an alternate audio track, remux to preserve choice
    if (play.data.path === "direct" && selectedAudioIndex > 0) return "remux";
    // Prepared HLS bundles contain the preferred language selected at prepare
    // time. Use the normal conversion path if the viewer chooses another track.
    if (play.data.path === "hls" && selectedAudioIndex !== (play.data.selectedAudioIndex ?? 0)) return "transcode";
    return play.data.path;
  }, [play.data, selectedAudioIndex]);

  const streamUrl = useMemo(() => {
    if (!effectivePath) return null;
    return api.streamUrl(Number(fileId), effectivePath, streamStart || undefined, selectedAudioIndex);
  }, [fileId, effectivePath, streamStart, selectedAudioIndex]);

  const handleSeekDragStart = useCallback(() => {
    seekDragRef.current = true;
    deferredSeekRef.current = null;
  }, []);

  const handleSeekDragEnd = useCallback(() => {
    seekDragRef.current = false;
    const target = deferredSeekRef.current;
    deferredSeekRef.current = null;
    if (target != null && videoRef.current) {
      commitSeekNowRef.current = true;
      videoRef.current.currentTime = target;
      commitSeekNowRef.current = false;
    }
  }, []);

  const handleSeekCommitStart = useCallback(() => {
    // The slider calls its media seek synchronously after pointerup capture.
    // Force that final value to commit now, then allow other inputs to debounce.
    seekDragRef.current = false;
    deferredSeekRef.current = null;
    commitSeekNowRef.current = true;
    queueMicrotask(() => { commitSeekNowRef.current = false; });
  }, []);

  const handleSeekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const total = knownDuration ?? (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    const current = queuedButtonSeekRef.current ?? video.currentTime;
    const target = total == null
      ? Math.max(0, current + delta)
      : Math.min(total, Math.max(0, current + delta));
    if (queuedButtonSeekRef.current == null) restartPlaybackRef.current = !video.paused;
    queuedButtonSeekRef.current = target;
    video.dispatchEvent(new Event("timeupdate"));
    if (buttonSeekTimerRef.current) clearTimeout(buttonSeekTimerRef.current);
    buttonSeekTimerRef.current = setTimeout(() => {
      const latestTarget = queuedButtonSeekRef.current;
      queuedButtonSeekRef.current = null;
      buttonSeekTimerRef.current = null;
      if (latestTarget == null || !videoRef.current) return;
      commitSeekNowRef.current = true;
      videoRef.current.currentTime = latestTarget;
      queueMicrotask(() => { commitSeekNowRef.current = false; });
    }, 220);
  }, [knownDuration]);

  // Fast trickplay track URL for scrub previews
  const trickplayTrackUrl = useMemo(() => {
    if (!play.data || play.data.path === "unsupported") return null;
    return api.trickplayTrackUrl(Number(fileId));
  }, [fileId, play.data]);

  // Preload all trickplay sprite sheets into browser cache immediately on player load
  useEffect(() => {
    const sprites = play.data?.trickplay?.sprites;
    if (sprites && sprites.length > 0) {
      for (const url of sprites) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [play.data?.trickplay?.sprites]);

  // Immediate loading state feedback on stream changes
  useEffect(() => {
    if (!streamUrl) return;
    setIsBuffering(true);
    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    };
  }, [streamUrl]);

  const isHls = Boolean(streamUrl && streamUrl.includes(".m3u8"));
  const duration = knownDuration ?? play.data?.watch?.duration ?? undefined;

  const isFullscreen = useIsFullscreen();
  const isElectronMac =
    typeof window !== "undefined" &&
    (Boolean(window.electronAPI?.isElectron) || /Electron/i.test(navigator.userAgent)) &&
    (window.electronAPI?.platform === "darwin" || /Mac/i.test(navigator.userAgent));
  const needsMacOffset = isElectronMac && !isFullscreen;

  // Converted fragmented MP4 streams report duration as data arrives.
  // Define source-timeline properties so seeking and duration stay in sync.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || effectivePath === "direct") return;

    const durationDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "duration");
    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    const seekableDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "seekable");
    if (!durationDescriptor?.get || !currentTimeDescriptor?.get || !currentTimeDescriptor.set || !seekableDescriptor?.get) return;

    Object.defineProperties(video, {
      duration: {
        configurable: true,
        get: () => duration ?? durationDescriptor.get!.call(video),
      },
      currentTime: {
        configurable: true,
        get: () => queuedButtonSeekRef.current != null
          ? queuedButtonSeekRef.current
          : seekDragRef.current && deferredSeekRef.current != null
            ? deferredSeekRef.current
          : pendingRestartRef.current?.fileId === Number(fileId)
            ? pendingRestartRef.current.seconds
            : streamStart + currentTimeDescriptor.get!.call(video),
        set: (sourceTime: number) => {
          if (seekDragRef.current) {
            deferredSeekRef.current = sourceTime;
            return;
          }
          // Prepared HLS and fragmented MP4 are genuinely seekable in the
          // browser. Only live conversions need a new source at distant times.
          if (effectivePath === "hls") {
            currentTimeDescriptor.set!.call(video, Math.max(0, sourceTime - streamStart));
            return;
          }
          const currentSourceTime = pendingRestartRef.current?.fileId === Number(fileId)
            ? pendingRestartRef.current.seconds
            : streamStart + currentTimeDescriptor.get!.call(video);
          if (Math.abs(sourceTime - currentSourceTime) > 2) {
            restartPlaybackRef.current = !video.paused;
            const next = { fileId: Number(fileId), seconds: sourceTime };
            pendingRestartRef.current = next;
            if (restartDebounceRef.current) clearTimeout(restartDebounceRef.current);
            if (commitSeekNowRef.current) {
              setRestartAt(next);
              restartDebounceRef.current = null;
            } else {
              restartDebounceRef.current = setTimeout(() => {
                if (pendingRestartRef.current === next) setRestartAt(next);
                restartDebounceRef.current = null;
              }, 140);
            }
          } else {
            currentTimeDescriptor.set!.call(video, Math.max(0, sourceTime - streamStart));
          }
        },
      },
      seekable: {
        configurable: true,
        get: () => {
          if (duration == null) return seekableDescriptor.get!.call(video);
          return {
            length: 1,
            start(index: number) {
              if (index !== 0) throw new DOMException("Time range index out of bounds", "IndexSizeError");
              return 0;
            },
            end(index: number) {
              if (index !== 0) throw new DOMException("Time range index out of bounds", "IndexSizeError");
              return duration;
            },
          } as TimeRanges;
        },
      },
    });

    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("timeupdate"));
    video.dispatchEvent(new Event("seekablechange"));

    return () => {
      Reflect.deleteProperty(video, "duration");
      Reflect.deleteProperty(video, "currentTime");
      Reflect.deleteProperty(video, "seekable");
    };
  }, [streamUrl, streamStart, duration, effectivePath, fileId]);

  useEffect(() => {
    if (pendingRestartRef.current?.fileId === Number(fileId) && restartAt === pendingRestartRef.current) {
      pendingRestartRef.current = null;
    }
  }, [restartAt, fileId]);

  // Subtitle Synchronization Adjustment Engine
  const handleAdjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffset((prev) => Number((prev + delta).toFixed(2)));
  }, []);

  const handleResetSubtitleOffset = useCallback(() => {
    setSubtitleOffset(0);
  }, []);

  const handleAdjustSubtitlePosition = useCallback((delta: number) => {
    setSubtitlePosition((prev) => Math.max(-120, Math.min(240, prev + delta)));
  }, []);

  const handleResetSubtitlePosition = useCallback(() => {
    setSubtitlePosition(0);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const diff = subtitleOffset - appliedSubtitleOffsetRef.current;
    if (Math.abs(diff) < 0.001) return;
    appliedSubtitleOffsetRef.current = subtitleOffset;

    if (video.textTracks) {
      for (let t = 0; t < video.textTracks.length; t++) {
        const track = video.textTracks[t];
        // Shift cues for subtitle/captions tracks only (preserve metadata tracks like trickplay)
        if (track.kind === "subtitles" || track.kind === "captions") {
          if (track.cues) {
            for (let c = 0; c < track.cues.length; c++) {
              const cue = track.cues[c];
              cue.startTime += diff;
              cue.endTime += diff;
            }
          }
        }
      }
    }
  }, [subtitleOffset]);

  // Ensure freshly loaded subtitle tracks receive current offset
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTrackLoad = () => {
      if (appliedSubtitleOffsetRef.current === 0 || !video.textTracks) return;
      const currentOffset = appliedSubtitleOffsetRef.current;
      for (let t = 0; t < video.textTracks.length; t++) {
        const track = video.textTracks[t];
        if (track.kind === "subtitles" || track.kind === "captions") {
          const trackExt = track as any;
          if (track.cues && track.cues.length > 0 && !trackExt.__plexy_offset_applied) {
            trackExt.__plexy_offset_applied = true;
            for (let c = 0; c < track.cues.length; c++) {
              const cue = track.cues[c];
              cue.startTime += currentOffset;
              cue.endTime += currentOffset;
            }
          }
        }
      }
    };

    const trackElements = video.querySelectorAll("track");
    trackElements.forEach((el) => el.addEventListener("load", onTrackLoad));
    return () => {
      trackElements.forEach((el) => el.removeEventListener("load", onTrackLoad));
    };
  }, [tracks, fileId]);

  // Audio track switching handler
  const handleSelectAudioTrack = useCallback((index: number) => {
    if (index === selectedAudioIndex) return;
    const video = videoRef.current;
    const currentPos = video?.currentTime ?? streamStart;
    restartPlaybackRef.current = !video?.paused;
    setSelectedAudioIndex(index);
    setRestartAt({ fileId: Number(fileId), seconds: currentPos });
  }, [fileId, selectedAudioIndex, streamStart]);

  // Resume position callback
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLMediaElement>) => {
    const v = e.currentTarget;
    if (restartAt?.fileId === Number(fileId) && !restartPlaybackRef.current) v.pause();
    if (autoAdvanceRef.current) {
      void v.play().then(() => {
        autoAdvanceRef.current = false;
      }).catch(() => {});
    }
    const resumePos = play.data?.watch?.position ?? 0;
    if (resumePos > 15 && !play.data?.watch?.played) {
      if ((effectivePath === "direct" || effectivePath === "hls") && Math.abs(v.currentTime - resumePos) > 3) {
        v.currentTime = resumePos;
      }
    }
  }, [effectivePath, fileId, play.data?.watch, restartAt]);

  const handleEnded = useCallback(() => {
    const next = play.data?.nextFileId;
    if (!next) return;
    const series = play.data?.next?.title;
    if (series && getNextSkipCount(series) < 3) return;
    autoAdvanceRef.current = true;
    void navigate({ to: "/watch/$fileId", params: { fileId: String(next) } });
  }, [navigate, play.data?.nextFileId, play.data?.next?.title]);

  const playNextEpisode = useCallback(() => {
    const next = play.data?.nextFileId;
    if (!next) return;
    const series = play.data?.next?.title;
    if (series) rememberNextSkip(series);
    setShowNextPrompt(false);
    void navigate({ to: "/watch/$fileId", params: { fileId: String(next) } });
  }, [navigate, play.data?.nextFileId, play.data?.next?.title]);

  const handleTimeUpdate = useCallback(() => {
    hideBuffering();
    const video = videoRef.current;
    const total = duration ?? (video && Number.isFinite(video.duration) ? video.duration : null);
    if (!video || !total || !play.data?.nextFileId) return;
    const markers = skipSegmentsQuery.data;
    const series = play.data?.next?.title ?? play.data?.title ?? "";
    const skipKind: "intro" | "recap" | null =
      markers?.intro && video.currentTime >= markers.intro.start && video.currentTime < markers.intro.end ? "intro"
        : markers?.recap && video.currentTime >= markers.recap.start && video.currentTime < markers.recap.end ? "recap"
          : null;
    setActiveSkipSegment(skipKind);
    if (skipKind && series && segmentSkipCount(series, skipKind) >= 3) {
      const marker = markers?.[skipKind];
      if (marker) {
        video.currentTime = marker.end;
        setActiveSkipSegment(null);
      }
    }
    const shouldShow = markers?.outro
      ? video.currentTime >= markers.outro.start
      : video.currentTime >= total - 90;
    if (
      markers?.outro && video.currentTime >= markers.outro.start
      && play.data?.nextFileId && series
      && getNextSkipCount(series) >= 3
      && !autoAdvanceTriggeredRef.current
    ) {
      autoAdvanceTriggeredRef.current = true;
      autoAdvanceRef.current = true;
      void navigate({ to: "/watch/$fileId", params: { fileId: String(play.data.nextFileId) } });
      return;
    }
    setShowNextPrompt((visible) => {
      if (shouldShow && !visible) {
        if (nextPromptTimerRef.current) clearTimeout(nextPromptTimerRef.current);
        nextPromptTimerRef.current = setTimeout(() => setShowNextPrompt(false), 15_000);
        return true;
      }
      if (!shouldShow && visible) {
        if (nextPromptTimerRef.current) clearTimeout(nextPromptTimerRef.current);
        return false;
      }
      return visible;
    });
  }, [duration, hideBuffering, navigate, play.data?.nextFileId, play.data?.next?.title, play.data?.title, skipSegmentsQuery.data]);

  const skipCurrentSegment = useCallback(() => {
    if (!activeSkipSegment) return;
    const marker = skipSegmentsQuery.data?.[activeSkipSegment];
    if (!marker || !videoRef.current) return;
    const series = play.data?.next?.title ?? play.data?.title ?? "";
    if (series) rememberSegmentSkip(series, activeSkipSegment);
    videoRef.current.currentTime = marker.end;
    setActiveSkipSegment(null);
  }, [activeSkipSegment, play.data?.next?.title, play.data?.title, skipSegmentsQuery.data]);

  // Focusing the player on open makes Space/K/M/F work immediately. The skin
  // only exists once the manifest resolves, so retry briefly and never steal
  // focus away from something already inside the player.
  useEffect(() => {
    const focusPlayer = () => {
      const skin = containerRef.current?.querySelector<HTMLElement>(".media-skin");
      if (!skin) return;
      const active = document.activeElement;
      if (active && active !== document.body && skin.contains(active)) return;
      skin.focus({ preventScroll: true });
    };
    focusPlayer();
    const first = setTimeout(focusPlayer, 120);
    const second = setTimeout(focusPlayer, 450);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [fileId, streamUrl]);

  // Arrow/J/L scrubbing with hold acceleration. Holding a key seeks in small,
  // smooth increments that grow the longer the key is held instead of firing
  // one huge jump per OS key-repeat.
  useEffect(() => {
    let direction: 1 | -1 | null = null;
    let startedAt = 0;
    let ticker: ReturnType<typeof setInterval> | null = null;

    const seekBy = (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const total = knownDuration ?? (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      const target = video.currentTime + delta;
      video.currentTime = total == null ? Math.max(0, target) : Math.min(total, Math.max(0, target));
    };

    const tick = () => {
      if (!direction) return;
      const heldFor = performance.now() - startedAt;
      // Converted streams restart when the jump is large, so keep those ticks
      // small and let direct/HLS playback move faster.
      const maxStep = effectivePath === "direct" || effectivePath === "hls" ? 6 : 2;
      const step = Math.min(maxStep, 1 + Math.floor(heldFor / 900));
      seekBy(direction * step);
    };

    const stop = () => {
      const wasSeeking = direction != null;
      direction = null;
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
      if (wasSeeking) handleSeekDragEnd();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='slider'], [role='listbox']")) return;
      const key = event.key.toLowerCase();
      const nextDirection: 1 | -1 | null =
        event.key === "ArrowRight" || key === "l" ? 1
          : event.key === "ArrowLeft" || key === "j" ? -1
            : null;
      if (!nextDirection) return;
      event.preventDefault();
      if (event.repeat) return;
      stop();
      handleSeekDragStart();
      direction = nextDirection;
      startedAt = performance.now();
      seekBy(nextDirection * 10);
      ticker = setInterval(tick, 90);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || key === "j" || key === "l") {
        stop();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
    };
  }, [knownDuration, effectivePath, handleSeekDragEnd, handleSeekDragStart]);

  const nextEpisode = play.data?.next ?? null;

  return (
    <div
      ref={containerRef}
      style={{ "--plexy-caption-offset": `${subtitlePosition}px` } as CSSProperties}
      className="fixed inset-0 z-50 flex flex-col bg-black select-none overflow-hidden"
    >
      {/* Main Video View / Video.js 10 */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full p-0">
        {play.data?.path === "unsupported" ? (
          <div className="max-w-md p-6 text-center rounded-2xl bg-[#181818] border border-white/10 text-white z-20">
            <p className="font-display text-lg font-bold">Unsupported Format</p>
            <p className="mt-2 text-sm text-ink-muted">{play.data.reason}</p>
            <button
              onClick={() => void navigate({ to: "/" })}
              className="mt-6 rounded-lg bg-[#E50914] px-5 py-2 text-sm font-semibold hover:bg-[#b80710] transition-colors"
            >
              Return Home
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <VideoPlayer>
              <VideoSkin
                className="w-full h-full max-w-full max-h-full aspect-video shadow-2xl"
                serverAudioTracks={play.data?.audioTracks}
                selectedAudioIndex={selectedAudioIndex}
                onSelectAudioTrack={handleSelectAudioTrack}
                onSeekDragStart={handleSeekDragStart}
                onSeekDragEnd={handleSeekDragEnd}
                onSeekCommitStart={handleSeekCommitStart}
                onSeekBy={handleSeekBy}
                subtitleOffset={subtitleOffset}
                onAdjustSubtitleOffset={handleAdjustSubtitleOffset}
                onResetSubtitleOffset={handleResetSubtitleOffset}
                subtitlePosition={subtitlePosition}
                onAdjustSubtitlePosition={handleAdjustSubtitlePosition}
                onResetSubtitlePosition={handleResetSubtitlePosition}
              >
                <ControlsVisibility onChange={setControlsVisible} />

                {/* Top bar lives inside the skin: the skin element is what goes
                    fullscreen, so overlays outside it disappear in fullscreen. */}
                <div
                  style={{ paddingLeft: needsMacOffset ? "88px" : undefined }}
                  className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 bg-gradient-to-b from-black/85 via-black/25 to-transparent px-5 pb-10 pt-4 transition-opacity duration-300 ${
                    controlsVisible ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <button
                    onClick={() => void navigate({ to: "/" })}
                    aria-label="Back"
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      controlsVisible ? "pointer-events-auto" : "pointer-events-none"
                    }`}
                  >
                    <ArrowLeft size={20} />
                  </button>

                </div>

                {/* Bottom title: season/episode + name, then the series name. */}
                {(play.data?.title || play.data?.subtitle) && (
                  <div
                    className={`pointer-events-none absolute inset-x-5 bottom-28 z-20 origin-bottom-left transition-opacity duration-300 media-2xl:bottom-20 ${
                      controlsVisible ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {play.data?.subtitle && (
                      <p className="text-sm font-medium text-white/70 drop-shadow">
                        {play.data.subtitle}
                      </p>
                    )}
                    {play.data?.title && (
                      <p className="mt-0.5 font-display text-xl font-bold text-white drop-shadow sm:text-2xl">
                        {play.data.title}
                      </p>
                    )}
                  </div>
                )}

                {play.data?.nextFileId && showNextPrompt && (
                  <div className="pointer-events-none absolute bottom-24 right-6 z-40 flex flex-col items-end gap-2 sm:bottom-20 sm:right-8">
                    {nextEpisode && (
                      <div className="flex max-w-64 items-center gap-2 rounded-lg border border-white/15 bg-black/75 p-2 text-white shadow-xl backdrop-blur-md">
                        {nextEpisode.poster && <img src={nextEpisode.poster} alt="" className="h-10 w-16 rounded object-cover" />}
                        <span className="min-w-0">
                          <span className="block text-[10px] uppercase tracking-wider text-white/55">Up next</span>
                          <span className="block truncate text-xs font-semibold">{nextEpisode.subtitle}</span>
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); playNextEpisode(); }}
                      aria-label="Play next episode"
                      className={`pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black shadow-xl transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${controlsVisible ? "" : "opacity-80"}`}
                    >
                      <SkipForward size={17} /> Next episode
                    </button>
                  </div>
                )}

                {activeSkipSegment && (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); skipCurrentSegment(); }}
                    className="pointer-events-auto absolute bottom-24 right-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black shadow-xl transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-20 sm:right-8"
                    aria-label={`Skip ${activeSkipSegment}`}
                  >
                    <SkipForward size={17} /> Skip {activeSkipSegment}
                  </button>
                )}

                {streamUrl && (
                  isHls ? (
                    <HlsJsVideo
                      key={streamUrl}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay={restartAt?.fileId !== Number(fileId) || restartPlaybackRef.current}
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={hideBuffering}
                      onEnded={handleEnded}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={hideBuffering}
                      className="h-full w-full object-contain"
                    >
                      {trickplayTrackUrl && (
                        <track
                          kind="metadata"
                          label="thumbnails"
                          src={trickplayTrackUrl}
                          default
                        />
                      )}
                      {tracks.map((t) => (
                        <track
                          key={t.track}
                          label={t.title || t.language || `Track ${t.track}`}
                          kind="subtitles"
                          src={`/api/subtitles/${fileId}/${t.track.endsWith(".vtt") ? t.track : `${t.track}.vtt`}`}
                          srcLang={t.language ?? undefined}
                          default={t.isDefault}
                        />
                      ))}
                    </HlsJsVideo>
                  ) : (
                    <Video
                      key={streamUrl}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay={restartAt?.fileId !== Number(fileId) || restartPlaybackRef.current}
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={hideBuffering}
                      onEnded={handleEnded}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={hideBuffering}
                      className="h-full w-full object-contain"
                    >
                      {trickplayTrackUrl && (
                        <track
                          kind="metadata"
                          label="thumbnails"
                          src={trickplayTrackUrl}
                          default
                        />
                      )}
                      {tracks.map((t) => (
                        <track
                          key={t.track}
                          label={t.title || t.language || `Track ${t.track}`}
                          kind="subtitles"
                          src={`/api/subtitles/${fileId}/${t.track.endsWith(".vtt") ? t.track : `${t.track}.vtt`}`}
                          srcLang={t.language ?? undefined}
                          default={t.isDefault}
                        />
                      ))}
                    </Video>
                  )
                )}
              </VideoSkin>
            </VideoPlayer>

            {isBuffering && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25 text-white"
              >
                <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
              </div>
            )}
          </div>
        )}
      </div>

      <ProgressReporter
        bridge={{
          play: play.data,
          fileId: Number(fileId),
          queryClient,
          streamStart,
          duration,
          videoRef,
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/watch/$fileId")({ component: WatchRoute });

/**
 * Periodically reports watch position to server every 10s and on pause/close (PRD 5.8).
 */
function ProgressReporter({
  bridge,
}: {
  bridge: {
    play: Playability | undefined;
    fileId: number;
    queryClient: ReturnType<typeof useQueryClient>;
    streamStart: number;
    duration: number | null | undefined;
    videoRef: React.RefObject<HTMLVideoElement | null>;
  };
}) {
  const itemId = bridge.play?.itemId ?? null;

  useEffect(() => {
    if (!itemId) return;
    const mediaEl = bridge.videoRef.current ?? (document.querySelector("video") as HTMLMediaElement | null);
    if (!mediaEl) return;

    const report = (played: boolean) => {
      void api
        .progress(
          itemId,
          mediaEl.currentTime,
          bridge.duration ?? (mediaEl.duration || null),
          played,
        )
        .then(() => bridge.queryClient.invalidateQueries({ queryKey: ["home"] }));
    };

    const interval = setInterval(() => {
      if (!mediaEl.paused && mediaEl.currentTime > 5) report(false);
    }, 10_000);

    const onPause = () => {
      if (bridge.duration || mediaEl.duration) {
        const duration = bridge.duration ?? mediaEl.duration;
        report(mediaEl.currentTime > duration * 0.9);
      }
    };

    const onLeave = () => {
      if ((bridge.duration || mediaEl.duration) && mediaEl.currentTime > 5) {
        const duration = bridge.duration ?? mediaEl.duration;
        const played = mediaEl.currentTime > duration * 0.9;
        report(played);
      }
    };

    mediaEl.addEventListener("pause", onPause);
    window.addEventListener("pagehide", onLeave);

    return () => {
      clearInterval(interval);
      mediaEl.removeEventListener("pause", onPause);
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, [itemId, bridge.streamStart, bridge.duration]);

  return null;
}
