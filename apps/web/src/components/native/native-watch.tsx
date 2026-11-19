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

import { api } from "../../client";
import { queries } from "../../queries";
import { getPlaybackPreferences } from "../../lib/playback-preferences";
import { nativeBridge } from "../../lib/native-playback";
import { useIsFullscreen } from "../../lib/use-fullscreen";
import { segmentAt, skipLabel, type SkipSegmentKind } from "../../lib/skip-segments";
import type { NativeAudioTrack, NativePlaybackEvent } from "../../electron";
import type { ServerAudioTrack } from "../videojs/ui/audio-track-menu";
import { BufferingIndicator } from "../videojs/ui/buffering-indicator";
import { Container } from "../videojs/ui/container";
import { ErrorDialog } from "../videojs/ui/error-dialog";
import { PlaybackHotkeys } from "../videojs/video/behaviors/playback-hotkeys";
import { VideoStatusIndicators } from "../videojs/video/display/status-indicators";
import { NeutralVideoControls } from "../videojs/video/layout/controls";
import "../videojs/styles/video/neutral.css";
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
  const play = useQuery(queries.playNative(fileId));
  const skipSegments = useQuery({
    queryKey: ["skip-segments", fileId],
    queryFn: () => api.skipSegments(fileId),
    staleTime: 5 * 60_000,
  });

  const manifest = play.data;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const itemIdRef = useRef<number | null>(null);
  const endedRef = useRef(false);

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

  useEffect(() => {
    if (!play.isError) return;
    setError(play.error instanceof Error ? play.error.message : "Could not load this title.");
    setStarting(false);
  }, [play.error, play.isError]);

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
        .then(invalidateProgress)
        .catch(() => {});
    },
    [invalidateProgress],
  );

  // Bridge events feed progress and the page chrome; the Video.js store is fed
  // by MpvVideo itself.
  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) return;
    return bridge.onEvent((event: NativePlaybackEvent) => {
      if (event.fileId !== fileId) return;
      switch (event.type) {
        case "ready":
          setStarting(false);
          setError(null);
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
          setEnded(true);
          endedRef.current = true;
          if (event.position != null) positionRef.current = event.position;
          saveProgress(true);
          break;
        case "tracks":
          setAudioTracks(event.audioTracks ?? []);
          break;
        default:
          break;
      }
    });
  }, [fileId, saveProgress]);

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
  sessionIdRef.current = sessionId;

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
  const total = duration ?? manifest?.duration ?? null;
  const activeSegment = useMemo((): { kind: SkipSegmentKind; end: number } | null => {
    const data = skipSegments.data;
    if (!data?.enabled) return null;
    const kind = segmentAt(data, position);
    const end = kind ? data[kind]?.end : undefined;
    return kind && end != null ? { kind, end } : null;
  }, [position, skipSegments.data]);

  const showNextPrompt =
    Boolean(manifest?.nextFileId) && total != null && position > 0 && position >= total - 90;

  return (
    <VideoPlayer>
      <div className="fixed inset-0 z-50 select-none overflow-hidden bg-transparent text-white">
        <Container
          data-theme="neutral"
          data-preset="video"
          className="h-full w-full bg-transparent [--media-background:transparent]"
        >
          <ControlsVisibility onChange={setControlsVisible} />
          <BufferingIndicator />
          <ErrorDialog />
          <NeutralVideoControls
            serverAudioTracks={serverAudioTracks}
            selectedAudioIndex={selectedAudioIndex}
            onSelectAudioTrack={handleSelectAudio}
          />
          <NativeHotkeys />
          <PlayerGestures />
          <VideoStatusIndicators />

          {manifest && (
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
              onSession={setSessionId}
              onFatal={(message) => {
                setStarting(false);
                setError(message);
              }}
            />
          )}

          {/* Top chrome lives inside the skin so it survives fullscreen. */}
          <div
            style={{ paddingLeft: needsMacOffset && !isFullscreen ? "88px" : undefined }}
            className={`pointer-events-none absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/85 via-black/35 to-transparent px-4 pb-12 pt-3 transition-opacity duration-300 sm:px-5 ${
              controlsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
              <button
                onClick={leave}
                aria-label="Back"
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  controlsVisible ? "pointer-events-auto" : "pointer-events-none"
                }`}
              >
                <ArrowLeft size={20} />
              </button>
              <div className="min-w-0 px-2 pt-1.5 text-center">
                <p className="truncate font-display text-[13px] font-semibold leading-tight drop-shadow sm:text-[15px]">
                  {title}
                </p>
                {(cleanSubtitle || subtitleEp) && (
                  <p className="mt-0.5 truncate text-[10.5px] font-medium text-white/60 sm:text-[11.5px]">
                    {cleanSubtitle || subtitleEp}
                  </p>
                )}
              </div>
              <span aria-hidden className="h-10 w-10" />
            </div>
          </div>

          {activeSegment && !ended && (
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

          {showNextPrompt && !ended && !activeSegment && manifest?.nextFileId && (
            <button
              type="button"
              onClick={() => {
                void navigate({
                  to: "/watch/$fileId",
                  params: { fileId: String(manifest.nextFileId) },
                  replace: true,
                  state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
                });
              }}
              className="pointer-events-auto absolute bottom-28 right-6 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black shadow-xl transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-24 sm:right-8"
            >
              <SkipForward size={17} /> Next episode
            </button>
          )}

          {ended && (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/55">
              <p className="font-display text-xl font-bold">Finished</p>
              {manifest?.nextFileId && (
                <button
                  onClick={() =>
                    void navigate({
                      to: "/watch/$fileId",
                      params: { fileId: String(manifest.nextFileId) },
                      replace: true,
                      state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
                    })
                  }
                  className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  <SkipForward size={17} /> Next episode
                </button>
              )}
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
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#181818] p-6 text-center text-white">
                <p className="font-display text-lg font-bold">Playback unavailable</p>
                <p className="mt-2 text-sm text-ink-muted">{error}</p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setError(null);
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
