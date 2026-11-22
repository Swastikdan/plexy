/// Native playback page for the desktop app.
///
/// mpv decodes the original file into a native surface that lives inside the
/// Plexy window, below the page. Everything the viewer interacts with is the
/// ordinary Video.js skin: the same controls, gestures, hotkeys, audio menu and
/// captions menu as the browser player. `MpvVideo` bridges mpv's state into the
/// Video.js player store.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Gesture, Hotkey } from "@videojs/react";
import { selectControls } from "@videojs/core/dom";
import { VideoPlayer, usePlayer } from "@videojs/react/video";
import { ArrowLeft, SkipForward } from "lucide-react";

import { api } from "@/client";
import { queries } from "@/queries";
import { getPlaybackPreferences } from "@/lib/playback-preferences";
import { prefetchAssets } from "@/lib/asset-prefetch";
import { getApiBase } from "@/server-config";
import { nativeBridge } from "@/lib/native-playback";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { useScreenWakeLock } from "@/lib/use-screen-wake-lock";
import { segmentAt, skipLabel, type SkipSegmentKind } from "@/lib/skip-segments";
import { NextEpisodeButton } from "@/components/player/next-episode-button";
import type { NativeAudioTrack, NativePlaybackEvent } from "@/electron";
import type { ServerAudioTrack } from "@/components/videojs/ui/audio-track-menu";
import { BufferingIndicator } from "@/components/videojs/ui/buffering-indicator";
import { Container } from "@/components/videojs/ui/container";
import { PlaybackHotkeys } from "@/components/videojs/video/behaviors/playback-hotkeys";
import { VideoStatusIndicators } from "@/components/videojs/video/display/status-indicators";
import { NeutralVideoControls } from "@/components/videojs/video/layout/controls";
import "@/components/videojs/styles/video/neutral.css";
import { MpvVideo } from "./mpv-video";

/**
 * Arrow keys seek the embedded player. A tap seeks ±10s; holding accelerates
 * the step so a long press behaves like a fast-forward/rewind control.
 */
function useArrowSeek(
  sessionIdRef: { current: string | null },
  positionRef: { current: number },
  durationRef: { current: number | null },
) {
  useEffect(() => {
    let direction: 1 | -1 | 0 = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let startedAt = 0;

    const stepFor = (elapsed: number) => {
      if (elapsed < 700) return 10;
      if (elapsed < 2_000) return 20;
      if (elapsed < 4_000) return 40;
      if (elapsed < 8_000) return 80;
      return 120;
    };

    const seek = (delta: number) => {
      const bridge = nativeBridge();
      const sessionId = sessionIdRef.current;
      if (!bridge || !sessionId) return;
      const total = durationRef.current;
      const limit = total && total > 0 ? Math.max(0, total - 3) : Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(limit, positionRef.current + delta));
      if (!Number.isFinite(target)) return;
      positionRef.current = target;
      void bridge.command({ sessionId, action: "seek", value: target }).catch(() => {});
    };

    const stop = () => {
      direction = 0;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = (next: 1 | -1) => {
      if (direction === next) return;
      stop();
      direction = next;
      startedAt = performance.now();
      seek(stepFor(0) * next);
      timer = setInterval(() => {
        if (!direction) return;
        seek(stepFor(performance.now() - startedAt) * direction);
      }, 180);
    };

    const isTypingOrMenu = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="dialog"], [role="slider"]',
        ),
      );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isTypingOrMenu(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      start(event.key === "ArrowRight" ? 1 : -1);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const released = event.key === "ArrowRight" ? 1 : -1;
      // Releasing the opposite arrow must not cancel the one still held.
      if (direction === released) stop();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [durationRef, positionRef, sessionIdRef]);
}

/**
 * Clicking the video surface must not toggle playback on desktop: macOS
 * delivers the click that focuses an inactive window to the page, so a paused
 * player would resume just by switching back to its window or Space. The play
 * button, Space/K and the seek buttons cover the same actions deliberately.
 *
 * Double-tap seeking stays; desktop fullscreen is a native window action (see
 * DesktopFullscreenButton), so it is not a gesture here.
 */
function PlayerGestures() {
  return (
    <>
      <Gesture type="doubletap" action="seekStep" region="left" />
      <Gesture type="doubletap" action="seekStep" region="right" />
    </>
  );
}

/** Video.js keys except fullscreen (which the desktop window owns). */
function NativeHotkeys() {
  return (
    <>
      <PlaybackHotkeys />
      <Hotkey keys="c" action="toggleSubtitles" />
    </>
  );
}

/** Reports the skin's chrome visibility so the page overlays can fade too. */
function ControlsVisibility({ onChange }: { onChange: (visible: boolean) => void }) {
  const controls = usePlayer(selectControls);
  const visible = controls?.controlsVisible ?? true;
  useEffect(() => {
    onChange(visible);
  }, [visible, onChange]);
  return null;
}

export function NativeWatchPage({ fileId }: { fileId: number }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const preferences = useMemo(() => getPlaybackPreferences(), []);
  const play = useQuery({
    ...queries.playNative(fileId),
    retry: 1,
    // Extraction is queued by the scanner. Poll while it runs so the scrubber
    // gains thumbnails without restarting the native session.
    refetchInterval: (query) => {
      const trickplay = query.state.data?.trickplay;
      if (!trickplay || trickplay.ready) return false;
      if (trickplay.status === "queued" || trickplay.status === "running") return 5_000;
      // A fresh file starts at "none" until the VTT request above enqueues it.
      return trickplay.status === "none" ? 15_000 : false;
    },
  });
  const skipSegments = useQuery({
    queryKey: ["skip-segments", fileId],
    queryFn: () => api.skipSegments(fileId),
    staleTime: 5 * 60_000,
  });

  const manifest = play.data;

  const [starting, setStarting] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [stoppedByAdmin, setStoppedByAdmin] = useState(false);
  const manifestError = play.isLoadingError && !play.isFetching
    ? (play.error instanceof Error ? play.error.message : "Could not load this title.")
    : null;
  const error = sessionError ?? manifestError;
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  useScreenWakeLock(playbackActive && !ended && !sessionError && !stoppedByAdmin);

  const sessionIdRef = useRef<string | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const itemIdRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const trickplayRequestedRef = useRef<number | null>(null);

  itemIdRef.current = manifest?.itemId ?? null;
  if (durationRef.current == null && manifest?.duration) durationRef.current = manifest.duration;

  useArrowSeek(sessionIdRef, positionRef, durationRef);

  // The page background is transparent only while the embedded surface is up;
  // everywhere else keeps the app's normal canvas colour.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("plexy-native-video");
    return () => root.classList.remove("plexy-native-video");
  }, []);

  // Browser playback triggers extraction as a side effect of loading the
  // trickplay `<track>`. Native playback has no such track, so ask for the VTT
  // once; the server enqueues a sheet and the play query poll picks it up.
  useEffect(() => {
    const trickplay = manifest?.trickplay;
    if (!trickplay || trickplay.ready || trickplay.status !== "none") return;
    if (trickplayRequestedRef.current === fileId) return;
    trickplayRequestedRef.current = fileId;
    void fetch(api.trickplayTrackUrl(fileId), {
      credentials: "include",
      cache: "no-store",
    }).catch(() => {});
  }, [fileId, manifest?.trickplay?.ready, manifest?.trickplay?.status]);

  const invalidateProgress = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["home"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
    void queryClient.invalidateQueries({ queryKey: ["title"] });
  }, [queryClient]);

  const saveProgress = useCallback(
    (played: boolean) => {
      const itemId = itemIdRef.current;
      const current = positionRef.current;
      if (!itemId || !(current > 5)) return;
      lastSaveRef.current = Date.now();
      void api
        .progress(itemId, current, durationRef.current, played)
        .then((result) => {
          if (result.stop) {
            setStoppedByAdmin(true);
            const sessionId = sessionIdRef.current;
            if (sessionId) {
              void window.electronAPI?.nativePlayer
                ?.command({ sessionId, action: "pause" })
                .catch(() => {});
            }
          }
          invalidateProgress();
        })
        .catch(() => {});
    },
    [invalidateProgress],
  );

  const onPlaybackEvent = useCallback((event: NativePlaybackEvent) => {
    switch (event.type) {
      case "ready":
        setStarting(false);
        setPlaybackActive(true);
        break;
      case "pause":
        setPlaybackActive(!event.paused);
        break;
      case "time": {
        if (event.position != null) {
          positionRef.current = event.position;
          setPosition(event.position);
        }
        if (event.duration != null) {
          durationRef.current = event.duration;
          setDuration(event.duration);
        }
        break;
      }
      case "duration":
        if (event.duration != null) {
          durationRef.current = event.duration;
          setDuration(event.duration);
        }
        break;
      case "ended":
        setPlaybackActive(false);
        setEnded(true);
        endedRef.current = true;
        if (event.position != null) positionRef.current = event.position;
        saveProgress(true);
        break;
      case "error":
      case "closed":
        setPlaybackActive(false);
        break;
      case "tracks":
        setAudioTracks(event.audioTracks ?? []);
        break;
      default:
        break;
    }
  }, [saveProgress]);

  // Periodic progress writes while playing (mirrors the browser reporter).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ended) return;
      if (Date.now() - lastSaveRef.current < 10_000) return;
      saveProgress(false);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [ended, saveProgress]);

  // Flush the last position when leaving the player.
  useEffect(() => {
    const onPageHide = () => saveProgress(false);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      const dur = durationRef.current;
      const reached = positionRef.current;
      saveProgress(Boolean(dur) && reached > dur! * 0.9);
    };
  }, [saveProgress]);

  // A genuine completion hands off to the next episode, like the browser player.
  useEffect(() => {
    if (!ended || !manifest?.nextFileId) return;
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/watch/$fileId",
        params: { fileId: String(manifest.nextFileId) },
        replace: true,
        state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
      });
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [ended, manifest?.nextFileId, navigate]);

  const leave = () => {
    saveProgress(false);
    if (router.state.location.state.playerFromTitle) {
      router.history.back();
      return;
    }
    const backTo = manifest?.parentItemId ?? manifest?.itemId;
    if (backTo != null) {
      void navigate({ to: "/title/$itemId", params: { itemId: String(backTo) }, replace: true });
    } else {
      void navigate({ to: "/", replace: true });
    }
  };

  const serverAudioTracks = useMemo<ServerAudioTrack[]>(
    () =>
      audioTracks.map((track, index) => ({
        index,
        codec: "",
        channels: 0,
        language: track.language ?? "",
        isDefault: track.default,
        prepared: true,
      })),
    [audioTracks],
  );
  const selectedAudioIndex = Math.max(
    0,
    audioTracks.findIndex((track) => track.selected),
  );

  // Native playback has no media element, so the browser's `<track>`-based
  // trickplay path cannot load its WebVTT. Crop the same sprite sheets here and
  // hand the slider the resolved entries directly.
  const trickplayThumbnails = useMemo(() => {
    const trickplay = manifest?.trickplay;
    if (!trickplay?.ready || !trickplay.sprites?.length || !trickplay.frameCount) return undefined;
    const interval = trickplay.interval > 0 ? trickplay.interval : 10;
    const framesPerSheet = trickplay.framesPerSheet ?? 100;
    const columns = trickplay.columns ?? 10;
    const rows = trickplay.rows ?? 10;
    const durationSeconds = duration ?? manifest?.duration ?? null;
    const base = getApiBase();
    const entries = [];

    for (let index = 0; index < trickplay.frameCount; index++) {
      const sprite = trickplay.sprites[Math.floor(index / framesPerSheet)];
      if (!sprite) break;
      const position = index % framesPerSheet;
      const column = position % columns;
      const row = Math.floor(position / columns);
      if (row >= rows) break;
      const startTime = index * interval;
      const endTime = Math.min(
        startTime + interval,
        durationSeconds && durationSeconds > startTime ? durationSeconds : startTime + interval,
      );
      entries.push({
        url: new URL(sprite, base).toString(),
        startTime,
        endTime,
        width: trickplay.width,
        height: trickplay.height,
        coords: { x: column * trickplay.width, y: row * trickplay.height },
      });
    }

    return entries.length > 0 ? entries : undefined;
  }, [duration, manifest?.duration, manifest?.trickplay]);

  useEffect(() => {
    const sprites = manifest?.trickplay?.sprites;
    if (!sprites?.length) return;
    const base = getApiBase();
    prefetchAssets(sprites.map((sprite) => new URL(sprite, base).toString()));
  }, [manifest?.trickplay?.sprites]);

  const handleSelectAudio = useCallback(
    (index: number) => {
      const track = audioTracks[index];
      const bridge = nativeBridge();
      const id = sessionIdRef.current;
      if (!track || !bridge || !id) return;
      void bridge.command({ sessionId: id, action: "set-audio", value: track.id }).catch(() => {});
    },
    [audioTracks],
  );

  // The session id is owned by MpvVideo; mirror it for audio selection.

  const isFullscreen = useIsFullscreen();

  // The desktop owns fullscreen: HTML element fullscreen gives Chromium an
  // opaque compositor surface which hides the embedded video.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      const target = event.target as Element | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitem"], [role="dialog"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void window.electronAPI?.setFullScreen?.(!isFullscreen).catch(() => {});
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isFullscreen]);

  // Keep the back button clear of the macOS traffic lights (not needed in
  // fullscreen, where macOS hides the window controls).
  const needsMacOffset =
    typeof window !== "undefined" &&
    (Boolean(window.electronAPI?.isElectron) || /Electron/i.test(navigator.userAgent)) &&
    (window.electronAPI?.platform === "darwin" || /Mac/i.test(navigator.userAgent));

  const title = manifest?.title || "Now playing";
  const subtitleEp = manifest?.subtitle ?? "";
  const cleanSubtitle = subtitleEp.replace(
    /^(?:S\d+E\d+|E\d+|\d+x\d+|Episode\s+\d+|Ep\.?\s*\d+)\s*[·\-:–—]\s*/i,
    "",
  ).trim();
  // "Lupin · Season 1, Episode 5 · Chapter 5" reads better above the controls
  // than the bare S01E05 token the manifest carries.
  const seasonLine =
    manifest?.seasonNumber != null && manifest?.episodeNumber != null
      ? `Season ${manifest.seasonNumber}, Episode ${manifest.episodeNumber}${
          cleanSubtitle ? ` · ${cleanSubtitle}` : ""
        }`
      : cleanSubtitle || subtitleEp;
  const activeSegment = useMemo((): { kind: SkipSegmentKind; end: number } | null => {
    const data = skipSegments.data;
    if (!data?.enabled) return null;
    const kind = segmentAt(data, position);
    const end = kind ? data[kind]?.end : undefined;
    return kind && end != null ? { kind, end } : null;
  }, [position, skipSegments.data]);

  const nextEpisode = manifest?.next ?? null;

  const playNext = useCallback(() => {
    if (!manifest?.nextFileId) return;
    // Hide the button and completion message while the next episode opens.
    setNextDismissed(true);
    setEnded(false);
    endedRef.current = false;
    void navigate({
      to: "/watch/$fileId",
      params: { fileId: String(manifest.nextFileId) },
      replace: true,
      state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
    });
  }, [manifest?.nextFileId, navigate]);

  return (
    <VideoPlayer>
      <div className="fixed inset-0 z-50 select-none overflow-hidden bg-transparent text-white">
        {stoppedByAdmin && (
          <div className="absolute inset-x-0 top-16 z-[75] mx-auto w-[min(92vw,460px)] rounded-xl border border-white/15 bg-[#181818]/95 p-4 text-center shadow-2xl">
            <p className="text-sm font-semibold">Playback stopped by the server owner.</p>
            <button
              type="button"
              onClick={leave}
              className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/10"
            >
              Back to the title
            </button>
          </div>
        )}
        <Container
          data-theme="neutral"
          data-preset="video"
          className="h-full w-full bg-transparent [--media-background:transparent]"
        >
          <ControlsVisibility onChange={setControlsVisible} />
          {!starting && !error && <BufferingIndicator />}
          <NeutralVideoControls
            thumbnails={trickplayThumbnails}
            serverAudioTracks={serverAudioTracks}
            selectedAudioIndex={selectedAudioIndex}
            onSelectAudioTrack={handleSelectAudio}
            chapters={manifest?.chapters}
            onSelectChapter={(start) => {
              const bridge = nativeBridge();
              const id = sessionIdRef.current;
              if (!bridge || !id) return;
              positionRef.current = start;
              setPosition(start);
              void bridge.command({ sessionId: id, action: "seek", value: start }).catch(() => {});
            }}
            versions={manifest?.versions}
            selectedFileId={fileId}
            onSelectVersion={(nextFileId) => {
              void navigate({
                to: "/watch/$fileId",
                params: { fileId: String(nextFileId) },
                replace: true,
                state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
              });
            }}
          />
          <NativeHotkeys />
          <PlayerGestures />
          <VideoStatusIndicators />

          {manifest && !sessionError && (
            <MpvVideo
              key={`${fileId}:${retryNonce}`}
              source={{
                fileId,
                title: manifest.title,
                subtitle: manifest.subtitle,
                duration: manifest.duration ?? null,
                watch: manifest.watch,
              }}
              autoSubtitles={preferences.autoSubtitles}
              subtitleLanguage={preferences.subtitleLanguage}
              onSession={(id) => { sessionIdRef.current = id; }}
              onEvent={onPlaybackEvent}
              onFatal={(message) => {
                setPlaybackActive(false);
                setStarting(false);
                sessionIdRef.current = null;
                setSessionError(message);
              }}
            />
          )}

          {/* Top chrome lives inside the skin so it survives fullscreen. */}
          <div
            style={{ paddingLeft: needsMacOffset && !isFullscreen ? "88px" : undefined }}
            className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 pb-10 pt-3 transition-opacity duration-300 sm:px-5 ${
              controlsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <button
              onClick={leave}
              aria-label="Back"
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                controlsVisible ? "pointer-events-auto" : "pointer-events-none"
              }`}
            >
              <ArrowLeft size={20} />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight text-white drop-shadow-[0_1px_10px_rgba(0,0,0,0.65)]">
                {title}
              </p>
              {seasonLine && (
                <p className="mt-1 truncate text-[11px] font-medium leading-tight text-white/60 drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
                  {seasonLine}
                </p>
              )}
            </div>
            {controlsVisible && manifest?.nextFileId && !nextDismissed && (
              <NextEpisodeButton next={nextEpisode} onPlay={playNext} />
            )}
          </div>

          {activeSegment && !ended && !(activeSegment.kind === "outro" && nextEpisode) && (
            <button
              type="button"
              onClick={() => {
                const bridge = nativeBridge();
                const id = sessionIdRef.current;
                if (!bridge || !id) return;
                positionRef.current = activeSegment.end;
                setPosition(activeSegment.end);
                void bridge.command({ sessionId: id, action: "seek", value: activeSegment.end }).catch(() => {});
              }}
              className={`pointer-events-auto absolute bottom-28 right-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black shadow-xl transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-24 sm:right-8 ${
                controlsVisible ? "opacity-100" : "opacity-0"
              }`}
              aria-label={skipLabel(activeSegment.kind)}
            >
              <SkipForward size={17} />
              {skipLabel(activeSegment.kind)}
            </button>
          )}

          {ended && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55">
              <p className="font-display text-xl font-bold">Finished</p>
            </div>
          )}

          {starting && !error && (
            <div
              role="status"
              className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/30"
            >
              <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
              <p className="text-sm text-white/70">Opening the original file…</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
              <div className="w-full max-w-md rounded-2xl border border-media-border bg-media-popover p-6 text-center text-white backdrop-blur-xl">
                <p className="font-display text-lg font-bold">Playback unavailable</p>
                <p className="mt-2 text-sm text-ink-muted">{error}</p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      if (!manifest) {
                        void play.refetch();
                        return;
                      }
                      sessionIdRef.current = null;
                      setSessionError(null);
                      setStarting(true);
                      setEnded(false);
                      endedRef.current = false;
                      setRetryNonce((value) => value + 1);
                    }}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/85"
                  >
                    Try again
                  </button>
                  <button
                    onClick={leave}
                    className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
                  >
                    Back
                  </button>
                </div>
              </div>
            </div>
          )}
        </Container>
      </div>
    </VideoPlayer>
  );
}
