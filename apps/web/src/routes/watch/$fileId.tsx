/// Fullscreen Cinema Player using Video.js 10 and Plexy playback engine.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, SkipForward } from "lucide-react";

import { VideoPlayer, Video, usePlayer } from "@videojs/react/video";
import { selectControls } from "@videojs/core/dom";

import { VideoSkin } from "@/components/videojs/video/skin";
import { api, type Playability, type SubtitleTrack } from "../../client";
import { probeBrowserCaps, type PlayPath } from "@plexy/api-client";
import { queries } from "../../queries";
import { useIsFullscreen } from "../../lib/use-fullscreen";
import { getPlaybackPreferences } from "../../lib/playback-preferences";
import { isPrefetchActive, prefetchAssets, prefetchTrickplayTrack } from "../../lib/asset-prefetch";

/// hls.js is only needed when the server hands back a converted (`.m3u8`)
/// stream. Importing it statically put the whole library into the watch route
/// chunk, so direct-play viewers downloaded a parser they never used.
const HlsJsVideo = lazy(() =>
  import("@videojs/react/media/hlsjs-video").then((module) => ({ default: module.HlsJsVideo })),
);

const NEXT_SKIP_KEY = "plexy:next-episode-skips:v1";
const SEGMENT_SKIP_KEY = "plexy:segment-skips:v1";

function diagnosticPlaybackPath(path: PlayPath | null): Exclude<PlayPath, "unsupported"> | undefined {
  return path && path !== "unsupported" ? path : undefined;
}

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

function rememberSegmentSkip(series: string, kind: "intro" | "recap" | "outro"): void {
  if (typeof localStorage === "undefined") return;
  const skips = readSegmentSkips();
  const key = `${series}:${kind}`;
  skips[key] = (skips[key] ?? 0) + 1;
  localStorage.setItem(SEGMENT_SKIP_KEY, JSON.stringify(skips));
}

type SkipSegmentKind = "intro" | "recap" | "outro";

function segmentAt(
  markers: { intro?: { start: number; end: number } | null; recap?: { start: number; end: number } | null; outro?: { start: number; end: number } | null } | undefined,
  time: number,
): SkipSegmentKind | null {
  if (!markers) return null;
  for (const kind of ["intro", "recap", "outro"] as const) {
    const marker = markers[kind];
    if (marker && time >= marker.start && time < marker.end) return kind;
  }
  return null;
}

function skipLabel(kind: SkipSegmentKind): string {
  return kind === "outro" ? "Skip ending" : `Skip ${kind}`;
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
  const [showPlaybackStats, setShowPlaybackStats] = useState(false);
  const [playerMenu, setPlayerMenu] = useState<{ x: number; y: number } | null>(null);
  const [playbackStatsTick, setPlaybackStatsTick] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const recoveryTargetRef = useRef<number | null>(null);
  const recoverPlaybackRef = useRef<() => void>(() => {});

  // Synchronously probe browser capabilities so query is enabled immediately on mount (prevents deadlock)
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const [playbackPreferences] = useState(getPlaybackPreferences);
  useEffect(() => {
    if (!showPlaybackStats) return;
    const timer = window.setInterval(() => setPlaybackStatsTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [showPlaybackStats]);
  const [restartAt, setRestartAt] = useState<{ fileId: number; seconds: number } | null>(null);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const restartPlaybackRef = useRef(true);
  const pendingRestartRef = useRef<{ fileId: number; seconds: number } | null>(null);
  const restartDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only live conversions need the seek transaction below; direct and HLS
  // playback use Video.js' own scrubbing untouched.
  const scrubbingConversionRef = useRef(false);
  const playbackStartedAtRef = useRef(performance.now());
  const playbackStartedRef = useRef(false);
  const playbackPathRef = useRef<PlayPath | null>(null);
  const waitingSinceRef = useRef<number | null>(null);
  const autoAdvanceRef = useRef(false);
  const autoAdvanceTriggeredRef = useRef(false);

  // Audio track and subtitle sync state
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number>(0);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const appliedSubtitleOffsetRef = useRef<number>(0);
  // Vertical placement of the caption track, in pixels (positive lifts it up).
  const [subtitlePosition, setSubtitlePosition] = useState<number>(0);
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [activeSkipSegment, setActiveSkipSegment] = useState<SkipSegmentKind | null>(null);
  const nextPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBufferingAfterDelay = useCallback(() => {
    if (waitingSinceRef.current == null) waitingSinceRef.current = performance.now();
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = setTimeout(() => setIsBuffering(true), 180);
    if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
    stallRecoveryTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && (!video.paused || video.seeking) && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        recoverPlaybackRef.current();
      }
    }, 12_000);
  }, []);

  const hideBuffering = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
    bufferingTimerRef.current = null;
    stallRecoveryTimerRef.current = null;
    setIsBuffering(false);
    const waitingSince = waitingSinceRef.current;
    waitingSinceRef.current = null;
    if (waitingSince != null && playbackStartedRef.current) {
      const durationMs = Math.round(performance.now() - waitingSince);
      if (durationMs >= 180) {
        void api.reportPlaybackDiagnostic({
          kind: "rebuffer",
          path: diagnosticPlaybackPath(playbackPathRef.current),
          durationMs,
        }).catch(() => {});
      }
    }
  }, []);

  // Fetch complete player manifest
  const hasInitializedAudioRef = useRef(false);
  useEffect(() => {
    playbackStartedAtRef.current = performance.now();
    playbackStartedRef.current = false;
    playbackPathRef.current = null;
    waitingSinceRef.current = null;
    hasInitializedAudioRef.current = false;
    scrubbingConversionRef.current = false;
    restartPlaybackRef.current = true;
    pendingRestartRef.current = null;
    if (restartDebounceRef.current) {
      clearTimeout(restartDebounceRef.current);
      restartDebounceRef.current = null;
    }
    setSelectedAudioIndex(0);
    setSubtitleOffset(0);
    appliedSubtitleOffsetRef.current = 0;
    setRestartAt(null);
    recoveryAttemptsRef.current = 0;
    recoveryTargetRef.current = null;
    setMediaRetryKey(0);
    setKnownDuration(null);
    setShowNextPrompt(false);
    setActiveSkipSegment(null);
    autoAdvanceTriggeredRef.current = false;
    if (nextPromptTimerRef.current) clearTimeout(nextPromptTimerRef.current);
    return () => {
      if (restartDebounceRef.current) {
        clearTimeout(restartDebounceRef.current);
        restartDebounceRef.current = null;
      }
    };
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

  useEffect(() => {
    playbackPathRef.current = play.data?.path ?? null;
  }, [play.data?.path]);

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
    // The server keeps markers in SQLite, so re-reading is cheap. Keep this
    // short enough that enabling the feature is reflected without a reload.
    staleTime: 5 * 60_000,
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

  useEffect(() => {
    if (!playbackPreferences.autoSubtitles || !streamUrl) return;
    const video = videoRef.current;
    if (!video) return;
    const applyPreferredSubtitle = () => {
      const textTracks = video.textTracks;
      if (!textTracks?.length) return;
      const preferred = playbackPreferences.subtitleLanguage.toLowerCase().split(/[-_]/, 1)[0];
      let selected = -1;
      for (let i = 0; i < textTracks.length; i++) {
        const language = textTracks[i]?.language.toLowerCase().split(/[-_]/, 1)[0];
        if (selected < 0 && language === preferred) selected = i;
      }
      if (selected < 0) {
        const defaultElement = [...video.querySelectorAll<HTMLTrackElement>("track[kind='subtitles'], track[kind='captions']")]
          .find((element) => tracks.some((track) => track.isDefault && (track.title === element.label || track.language === element.srclang)));
        if (defaultElement) selected = Array.from(textTracks).indexOf(defaultElement.track);
      }
      if (selected < 0) return;
      for (let i = 0; i < textTracks.length; i++) {
        if (textTracks[i]?.kind === "subtitles" || textTracks[i]?.kind === "captions") {
          textTracks[i]!.mode = i === selected ? "showing" : "disabled";
        }
      }
    };
    video.addEventListener("loadedmetadata", applyPreferredSubtitle);
    video.addEventListener("loadeddata", applyPreferredSubtitle);
    applyPreferredSubtitle();
    return () => {
      video.removeEventListener("loadedmetadata", applyPreferredSubtitle);
      video.removeEventListener("loadeddata", applyPreferredSubtitle);
    };
  }, [playbackPreferences, streamUrl, tracks]);

  // Live conversions (remux/transcode) stream from a server-side FFmpeg
  // process that the browser cannot seek. While the viewer drags the slider we
  // only remember the target and restart the conversion once, on release.
  // The restart reloads the media element in place (`src` update); the element
  // is only remounted for file switches and retry recovery, which keeps
  // Video.js' stock scrubbing (and the presentation layer) stable mid-seek.
  // Direct and HLS playback are natively seekable, so this is a no-op there
  // and the slider keeps Video.js' stock scrubbing behaviour.
  const handleSeekDragStart = useCallback(() => {
    if (effectivePath !== "remux" && effectivePath !== "transcode") return;
    scrubbingConversionRef.current = true;
    // pauseOnDrag is off, so `paused` here reflects how the viewer reached the
    // slider. The reload after release must not end up playing when they were
    // paused (or staying paused when they were playing).
    if (videoRef.current) restartPlaybackRef.current = !videoRef.current.paused;
    // A click may already have queued a restart; hold it until release.
    if (restartDebounceRef.current) {
      clearTimeout(restartDebounceRef.current);
      restartDebounceRef.current = null;
    }
  }, [effectivePath]);

  const handleSeekDragEnd = useCallback(() => {
    if (!scrubbingConversionRef.current) return;
    scrubbingConversionRef.current = false;
    const next = pendingRestartRef.current;
    if (!next || next.fileId !== Number(fileId)) return;
    if (restartDebounceRef.current) {
      clearTimeout(restartDebounceRef.current);
      restartDebounceRef.current = null;
    }
    setRestartAt(next);
  }, [fileId]);

  // Fast trickplay track URL for scrub previews
  const trickplayTrackUrl = useMemo(() => {
    if (!play.data || play.data.path === "unsupported") return null;
    return api.trickplayTrackUrl(Number(fileId));
  }, [fileId, play.data]);

  // Warm this file's trickplay sheets. When managed prefetch is active the
  // service worker serves the scrubber from that cache, so the sheets are not
  // loaded twice; otherwise the browser's own image cache does the same job.
  useEffect(() => {
    const trickplay = play.data?.trickplay;
    const sprites = trickplay?.sprites;
    if (sprites && sprites.length > 0) {
      if (isPrefetchActive()) {
        prefetchAssets(sprites);
        return;
      }
      const images = sprites.map((url) => {
        const img = new Image();
        img.src = url;
        return img;
      });
      return () => {
        for (const img of images) img.src = "";
      };
    }
    // Only sprite URLs already enumerated in play data are known; otherwise a
    // ready track may still expose sheet URLs in its cues.
    if (trickplay?.ready && trickplay.trackUrl) prefetchTrickplayTrack(trickplay.trackUrl);
  }, [play.data?.trickplay?.sprites, play.data?.trickplay?.ready, play.data?.trickplay?.trackUrl]);

  // Immediate loading state feedback on stream changes
  useEffect(() => {
    if (!streamUrl) return;
    setIsBuffering(true);
    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
      if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
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

  // A live remux/transcode is a one-shot FFmpeg stream: the browser has no
  // seekable range and only knows the source-relative clock. Map that clock
  // onto the media timeline, and restart the conversion for long jumps. The
  // fake clock keeps reporting the scrubbed target from the moment the seek
  // is issued until the reloaded stream reports its first frame, so the
  // playhead never dips toward 0 or overshoots past the end mid-restart.
  // Direct and HLS playback are natively seekable and are deliberately left
  // untouched so Video.js drives scrubbing itself.
  const usesLiveConversion = effectivePath === "remux" || effectivePath === "transcode";

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !usesLiveConversion) return;

    const durationDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "duration");
    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    const seekableDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "seekable");
    if (!durationDescriptor?.get || !currentTimeDescriptor?.get || !currentTimeDescriptor.set || !seekableDescriptor?.get) return;

    const pendingTarget = () =>
      pendingRestartRef.current?.fileId === Number(fileId) ? pendingRestartRef.current.seconds : null;

    const restart = (target: number, delay: number) => {
      restartPlaybackRef.current = !video.paused;
      const next = { fileId: Number(fileId), seconds: target };
      pendingRestartRef.current = next;
      if (restartDebounceRef.current) clearTimeout(restartDebounceRef.current);
      restartDebounceRef.current = setTimeout(() => {
        restartDebounceRef.current = null;
        if (pendingRestartRef.current === next) setRestartAt(next);
      }, delay);
    };

    Object.defineProperties(video, {
      duration: {
        configurable: true,
        get: () => duration ?? durationDescriptor.get!.call(video),
      },
      currentTime: {
        configurable: true,
        get: () => pendingTarget() ?? streamStart + currentTimeDescriptor.get!.call(video),
        set: (sourceTime: number) => {
          const target = Math.max(0, sourceTime);
          // While dragging, only the released position matters. Restarting
          // FFmpeg for every pointer move would stutter, so just remember it.
          if (scrubbingConversionRef.current) {
            pendingRestartRef.current = { fileId: Number(fileId), seconds: target };
            return;
          }
          // Rapid clicks: keep the newest target and coalesce the restarts.
          if (pendingTarget() != null) {
            restart(target, 140);
            return;
          }
          const sourceNow = streamStart + currentTimeDescriptor.get!.call(video);
          if (Math.abs(target - sourceNow) <= 2) {
            currentTimeDescriptor.set!.call(video, Math.max(0, target - streamStart));
            return;
          }
          restart(target, 140);
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
  }, [streamUrl, streamStart, duration, usesLiveConversion, fileId]);

  // The pending seek target pins the fake source clock until the reloaded
  // stream reports its first frame (handleLoadedData). This timer only covers
  // streams that never get there (fatal encode failures), so the playhead
  // cannot stay frozen forever.
  useEffect(() => {
    if (pendingRestartRef.current?.fileId !== Number(fileId)) return;
    const timer = setTimeout(() => {
      if (pendingRestartRef.current?.fileId === Number(fileId)) pendingRestartRef.current = null;
    }, 20_000);
    return () => clearTimeout(timer);
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

  const settlePendingRestart = useCallback(() => {
    const pending = pendingRestartRef.current;
    const video = videoRef.current;
    if (!pending || !video || pending.fileId !== Number(fileId) || pending !== restartAt) return;
    // The reloaded stream's own clock starts at the scrubbed position, so the
    // fake clock can hand over without a jump. `seeked` releases Video.js'
    // scrub hold and resolves the player's pending seek.
    pendingRestartRef.current = null;
    video.dispatchEvent(new Event("timeupdate"));
    video.dispatchEvent(new Event("seeked"));
  }, [fileId, restartAt]);

  // Resume position callback
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLMediaElement>) => {
    const v = e.currentTarget;
    if ((restartAt?.fileId === Number(fileId) || mediaRetryKey > 0) && !restartPlaybackRef.current) v.pause();
    // Seek restarts reload the stream in place, which pauses the element.
    // Resuming here plays only what was playing when the seek was issued.
    if (restartPlaybackRef.current) {
      restartPlaybackRef.current = false;
      void v.play().catch(() => {});
    }
    if (recoveryTargetRef.current != null) {
      const target = recoveryTargetRef.current;
      recoveryTargetRef.current = null;
      v.currentTime = target;
    }
    if (autoAdvanceRef.current) {
      void v.play().then(() => {
        autoAdvanceRef.current = false;
      }).catch(() => {});
    }
    settlePendingRestart();
    const resumePos = play.data?.watch?.position ?? 0;
    if (mediaRetryKey === 0 && restartAt?.fileId !== Number(fileId) && resumePos > 15 && !play.data?.watch?.played) {
      if ((effectivePath === "direct" || effectivePath === "hls") && Math.abs(v.currentTime - resumePos) > 3) {
        v.currentTime = resumePos;
      }
    }
  }, [effectivePath, fileId, mediaRetryKey, play.data?.watch, restartAt, settlePendingRestart]);

  const handleLoadedData = useCallback(() => {
    recoveryAttemptsRef.current = 0;
    settlePendingRestart();
    if (!playbackStartedRef.current) {
      playbackStartedRef.current = true;
      void api.reportPlaybackDiagnostic({
        kind: "startup",
        path: diagnosticPlaybackPath(playbackPathRef.current),
        durationMs: Math.round(performance.now() - playbackStartedAtRef.current),
      }).catch(() => {});
    }
    hideBuffering();
  }, [hideBuffering, settlePendingRestart]);

  const recoverPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    restartPlaybackRef.current = !video.paused;
    if (recoveryAttemptsRef.current === 0) {
      recoveryAttemptsRef.current = 1;
      setIsBuffering(true);
      setMediaRetryKey((key) => key + 1);
      return;
    }
    if (recoveryAttemptsRef.current >= 2) {
      setIsBuffering(false);
      return;
    }
    recoveryAttemptsRef.current = 2;

    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")?.get?.call(video) ?? 0;
    let nearest: number | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < video.buffered.length; i++) {
      for (const point of [video.buffered.start(i), video.buffered.end(i)]) {
        const nextDistance = Math.abs(point - currentTime);
        if (nextDistance < distance) {
          nearest = point;
          distance = nextDistance;
        }
      }
    }
    if (nearest != null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")?.set;
      try {
        setter?.call(video, nearest);
        recoveryAttemptsRef.current = 0;
        setIsBuffering(false);
        return;
      } catch { /* Try a new source below. */ }
    }
    if (effectivePath === "remux" || effectivePath === "transcode") {
      setRestartAt({ fileId: Number(fileId), seconds: video.currentTime });
      setMediaRetryKey((key) => key + 1);
      return;
    }
    recoveryTargetRef.current = video.currentTime;
    setIsBuffering(true);
    setMediaRetryKey((key) => key + 1);
  }, [effectivePath, fileId]);

  useEffect(() => {
    recoverPlaybackRef.current = recoverPlayback;
  }, [recoverPlayback]);

  const handleMediaError = useCallback(() => {
    if (recoveryAttemptsRef.current > 0) {
      void api.reportPlaybackDiagnostic({
        kind: "error",
        path: diagnosticPlaybackPath(playbackPathRef.current),
        mediaErrorCode: videoRef.current?.error?.code ?? undefined,
      }).catch(() => {});
    }
    recoverPlayback();
  }, [recoverPlayback]);

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
    if (!video) return;
    const total = duration ?? (Number.isFinite(video.duration) ? video.duration : null);
    const markers = skipSegmentsQuery.data;
    const series = play.data?.next?.title ?? play.data?.title ?? "";
    const skipKind = segmentAt(markers, video.currentTime);
    setActiveSkipSegment(skipKind);
    // Auto-skip only intros/recaps. Credits are left to the ending button so
    // the viewer can still see the last scene before the next episode starts.
    if (skipKind && skipKind !== "outro" && series && segmentSkipCount(series, skipKind) >= 3) {
      const marker = markers?.[skipKind];
      if (marker) {
        video.currentTime = marker.end;
        setActiveSkipSegment(null);
      }
    }
    if (!total || !play.data?.nextFileId) {
      setShowNextPrompt(false);
      return;
    }
    const shouldShow = markers?.outro
      ? video.currentTime >= markers.outro.start
      : video.currentTime >= total - 90;
    if (
      markers?.outro && video.currentTime >= markers.outro.start
      && series
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
    setActiveSkipSegment(null);
    // "Skip ending" is also the natural next-episode action when one exists.
    if (activeSkipSegment === "outro" && play.data?.nextFileId) {
      if (series) rememberNextSkip(series);
      autoAdvanceRef.current = true;
      void navigate({ to: "/watch/$fileId", params: { fileId: String(play.data.nextFileId) } });
      return;
    }
    videoRef.current.currentTime = marker.end;
  }, [activeSkipSegment, navigate, play.data?.nextFileId, play.data?.next?.title, play.data?.title, skipSegmentsQuery.data]);

  // Markers arrive asynchronously; evaluate them immediately instead of waiting
  // for the next timeupdate (which may not come while paused or buffering).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setActiveSkipSegment(segmentAt(skipSegmentsQuery.data, video.currentTime));
  }, [skipSegmentsQuery.data]);

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

  // Arrow/J/L seek handling. The slider's own key handler is captured here so
  // a focused thumb behaves like the player, with holds accelerating the step.
  // Seeking itself goes straight to the media element (or the live-conversion
  // restart above), exactly like the slider's pointer seeks.
  useEffect(() => {
    let activeKey: string | null = null;
    let direction: 1 | -1 | null = null;
    let startedAt = 0;

    const seekBy = (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const total = knownDuration ?? (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      const target = video.currentTime + delta;
      video.currentTime = total == null ? Math.max(0, target) : Math.min(total, Math.max(0, target));
    };

    const applyStep = (initial: boolean) => {
      if (!direction) return;
      if (initial) {
        seekBy(direction * 10);
        return;
      }
      const heldFor = performance.now() - startedAt;
      const maxStep = effectivePath === "direct" || effectivePath === "hls" ? 30 : 10;
      const step = heldFor < 350 ? 1
        : heldFor < 800 ? 2
          : heldFor < 1_400 ? 4
            : heldFor < 2_200 ? 8
              : maxStep;
      seekBy(direction * step);
    };

    const stop = () => {
      activeKey = null;
      direction = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox']")) return;
      const key = event.key.toLowerCase();
      const nextDirection: 1 | -1 | null =
        event.key === "ArrowRight" || key === "l" ? 1
          : event.key === "ArrowLeft" || key === "j" ? -1
            : null;
      if (!nextDirection) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeKey === key) {
        applyStep(false);
        return;
      }
      activeKey = key;
      direction = nextDirection;
      startedAt = performance.now();
      applyStep(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== activeKey) return;
      stop();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    };
  }, [knownDuration, effectivePath]);

  const nextEpisode = play.data?.next ?? null;
  // The back control opens the title this file belongs to, not the app shell.
  // Episodes list the series they belong to; the manifest supplies that.
  const detailItemId = play.data?.parentItemId ?? play.data?.itemId ?? null;
  const leavePlayer = useCallback(() => {
    if (detailItemId != null) {
      void navigate({ to: "/title/$itemId", params: { itemId: String(detailItemId) } });
    } else {
      void navigate({ to: "/" });
    }
  }, [detailItemId, navigate]);

  return (
    <div
      ref={containerRef}
      onClick={() => setPlayerMenu(null)}
      onContextMenu={(event) => {
        event.preventDefault();
        setPlayerMenu({ x: event.clientX, y: event.clientY });
      }}
      style={{ "--plexy-caption-offset": `${subtitlePosition}px` } as CSSProperties}
      className="fixed inset-0 z-50 flex flex-col bg-black select-none overflow-hidden"
    >
      {showPlaybackStats && (
        <PlaybackStatsOverlay video={videoRef.current} path={play.data?.path} tick={playbackStatsTick} onClose={() => setShowPlaybackStats(false)} />
      )}
      {playerMenu && (
        <div className="fixed z-[80] min-w-44 rounded-lg border border-white/15 bg-[#171719] p-1 text-sm text-white shadow-2xl" style={{ left: Math.min(playerMenu.x, window.innerWidth - 190), top: Math.min(playerMenu.y, window.innerHeight - 54) }} onContextMenu={(event) => event.preventDefault()}>
          <button type="button" className="w-full rounded-md px-3 py-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white" onClick={() => { setPlayerMenu(null); setShowPlaybackStats(true); }}>Stats for nerds</button>
        </div>
      )}
      {/* Main Video View / Video.js 10 */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full p-0">
        {play.data?.path === "unsupported" ? (
          <div className="max-w-md p-6 text-center rounded-2xl bg-[#181818] border border-white/10 text-white z-20">
            <p className="font-display text-lg font-bold">Unsupported Format</p>
            <p className="mt-2 text-sm text-ink-muted">{play.data.reason}</p>
            <button
              onClick={leavePlayer}
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
                    onClick={leavePlayer}
                    aria-label="Back"
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      controlsVisible ? "pointer-events-auto" : "pointer-events-none"
                    }`}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPlaybackStats(true)}
                    aria-label="Show playback stats"
                    title="Stats for nerds"
                    className={`pointer-events-auto ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${controlsVisible ? "" : "pointer-events-none"}`}
                  >
                    <Activity size={16} />
                    <span>Stats</span>
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

                {play.data?.nextFileId && showNextPrompt && !activeSkipSegment && (
                  <div className="pointer-events-none absolute bottom-24 right-6 z-40 flex flex-col items-end gap-2 sm:bottom-20 sm:right-8">
                    {nextEpisode && (
                      <div className="flex max-w-64 items-center gap-2 rounded-lg border border-white/15 bg-black/75 p-2 text-white shadow-xl backdrop-blur-md">
                        {nextEpisode.poster && <img src={nextEpisode.poster} alt="" className="h-10 w-16 rounded-sm object-cover" />}
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
                    aria-label={skipLabel(activeSkipSegment)}
                  >
                    <SkipForward size={17} /> {skipLabel(activeSkipSegment)}
                  </button>
                )}

                {streamUrl && (
                  isHls ? (
                    <Suspense fallback={null}>
                    <HlsJsVideo
                      key={`${fileId}:${mediaRetryKey}`}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay={mediaRetryKey === 0 ? restartAt?.fileId !== Number(fileId) || restartPlaybackRef.current : restartPlaybackRef.current}
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={handleLoadedData}
                      onEnded={handleEnded}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={handleMediaError}
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
                          default={playbackPreferences.autoSubtitles && t.isDefault}
                        />
                      ))}
                    </HlsJsVideo>
                    </Suspense>
                  ) : (
                    <Video
                      key={`${fileId}:${mediaRetryKey}`}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay={mediaRetryKey === 0 ? restartAt?.fileId !== Number(fileId) || restartPlaybackRef.current : restartPlaybackRef.current}
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={handleLoadedData}
                      onEnded={handleEnded}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={handleMediaError}
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
                          default={playbackPreferences.autoSubtitles && t.isDefault}
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
          duration,
          videoRef,
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/watch/$fileId")({ component: WatchRoute });

function PlaybackStatsOverlay({ video, path, tick, onClose }: { video: HTMLVideoElement | null; path?: string; tick: number; onClose: () => void }) {
  const quality = video && "getVideoPlaybackQuality" in video ? video.getVideoPlaybackQuality() : null;
  const buffered = video?.buffered;
  const ahead = video && buffered ? Array.from({ length: buffered.length }, (_, index) => ({ start: buffered.start(index), end: buffered.end(index) })).find((range) => video.currentTime >= range.start && video.currentTime <= range.end)?.end : undefined;
  const bufferSeconds = ahead != null && video ? Math.max(0, ahead - video.currentTime).toFixed(1) : "—";
  const resolution = video?.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight}` : "Waiting for video";
  return (
    <section key={tick} aria-label="Stats for nerds" className="absolute right-5 top-5 z-[80] w-72 rounded-xl border border-white/15 bg-black/85 p-4 font-mono text-xs text-white shadow-2xl backdrop-blur-md" onContextMenu={(event) => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between font-sans text-sm font-semibold"><span>Stats for nerds</span><button type="button" onClick={onClose} className="rounded px-2 py-1 text-white/65 hover:bg-white/10 hover:text-white" aria-label="Close stats">×</button></div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-white/70">
        <dt>Playback</dt><dd className="text-right text-white">{path ?? "—"}</dd>
        <dt>Video resolution</dt><dd className="text-right text-white">{resolution}</dd>
        <dt>Current position</dt><dd className="text-right text-white">{video ? `${Math.floor(video.currentTime)}s` : "—"}</dd>
        <dt>Buffer ahead</dt><dd className="text-right text-white">{bufferSeconds}s</dd>
        <dt>Decoded frames</dt><dd className="text-right text-white">{quality?.totalVideoFrames ?? "—"}</dd>
        <dt>Dropped frames</dt><dd className="text-right text-white">{quality?.droppedVideoFrames ?? "—"}</dd>
      </dl>
      <p className="mt-3 border-t border-white/10 pt-2 font-sans text-[10px] text-white/45">Session stats update once per second while open.</p>
    </section>
  );
}

/**
 * Periodically reports watch position to server every 10s and on pause/close (PRD 5.8).
 *
 * The media element is resolved at report time, never captured: live remux and
 * transcode streams restart as an FFmpeg conversion and the recovery path can
 * remount the media element. A snapshot ref then would keep reporting the
 * frozen position of a detached element while the new one plays on, so watch
 * progress (and the Continue Watching bar) would only advance on a hard reload.
 *
 * Reports on leave play it safe the other way round: they never sample the
 * element again, because navigation out of the player tears the element down
 * while sibling mounts briefly connect elements that report their initial
 * resume position — sampling then could roll the watched position backward.
 * Only the last validated live read is replayed instead.
 */
function ProgressReporter({
  bridge,
}: {
  bridge: {
    play: Playability | undefined;
    fileId: number;
    queryClient: ReturnType<typeof useQueryClient>;
    duration: number | null | undefined;
    videoRef: React.RefObject<HTMLVideoElement | null>;
  };
}) {
  const itemId = bridge.play?.itemId ?? null;
  const parentItemId = bridge.play?.parentItemId ?? null;
  // The observer below must not rebuild when streamStart or knownDuration
  // change (every seek restart does), so it re-reads the latest inputs through
  // this ref instead of their values from an old render.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  useEffect(() => {
    if (!itemId) return;

    const mediaEl = (): HTMLMediaElement | null =>
      bridgeRef.current.videoRef.current ?? (document.querySelector("video") as HTMLMediaElement | null);

    // The freshest position seen from an element that was genuinely connected
    // and playing (or just paused by the viewer). Navigation out of the player
    // unmounts the media element while sibling mounts churn: a freshly mounted
    // element reports its initial resume position (e.g. the stream's start
    // offset) and must never overwrite what live playback already reached. So
    // fresh element reads only update this during real playback; the leave
    // report never samples the element at cleanup time.
    let lastLivePos: number | null = null;

    const post = (position: number, played: boolean) => {
      const duration = bridgeRef.current.duration ?? (mediaEl()?.duration || null);
      void api
        .progress(itemId, position, duration, played)
        .then(() => {
          bridge.queryClient.invalidateQueries({ queryKey: ["home"] });
          bridge.queryClient.invalidateQueries({ queryKey: ["items"] });
          bridge.queryClient.invalidateQueries({ queryKey: ["title"] });
        })
        .catch(() => {});
    };

    // Resolves the live element and remembers its position. Returns null when
    // a trustworthy read is not possible right now.
    const liveRead = (): number | null => {
      const el = mediaEl();
      if (!el || !el.isConnected) return null;
      const position = el.currentTime;
      if (!(position > 0)) return null;
      lastLivePos = position;
      return position;
    };

    const report = (played: boolean) => {
      // Prefer the element when it is resolvable; fall back to the last live
      // read during element churn so a remount's artefact cannot regress it.
      const position = liveRead() ?? lastLivePos;
      if (position == null || !(position > 5)) return;
      post(position, played);
    };

    const interval = setInterval(() => {
      const el = mediaEl();
      if (!el || !el.isConnected || el.paused) return;
      report(false);
    }, 10_000);

    // Pause events do not bubble, but capture-phase listeners on the document
    // still see them for every media element, including remounted ones.
    const onPause = () => {
      const el = mediaEl();
      if (!el) return;
      const dur = bridgeRef.current.duration ?? (el.duration || null);
      report(Boolean(dur) && el.currentTime > dur! * 0.9);
    };

    const leave = () => {
      const reached = lastLivePos;
      if (reached != null && reached > 5) {
        const dur = bridgeRef.current.duration ?? (mediaEl()?.duration || null);
        post(reached, Boolean(dur) && reached > dur! * 0.9);
      }
      // The screens the viewer can return to must show the fresh position:
      // only active observers are refetched by invalidation, and home / the
      // library / the title page may all be inactive at this moment.
      bridge.queryClient.invalidateQueries({ queryKey: ["home"] });
      bridge.queryClient.invalidateQueries({ queryKey: ["items"] });
      bridge.queryClient.invalidateQueries({ queryKey: ["title"] });
    };

    document.addEventListener("pause", onPause, true);
    window.addEventListener("pagehide", leave);

    return () => {
      clearInterval(interval);
      document.removeEventListener("pause", onPause, true);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [itemId, parentItemId, bridge.queryClient, bridge.videoRef]);

  return null;
}
