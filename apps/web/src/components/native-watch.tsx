/// Native playback player surface for the desktop app.
///
/// mpv decodes the original file in its own video window; Plexy draws the
/// player chrome here, styled after the Video.js skin so the desktop client and
/// the website feel like one player. Every control (seek, volume, audio,
/// subtitles, speed, fullscreen) is mapped onto mpv's JSON IPC surface, and mpv
/// runs without its own on-screen controller so there is only one control UI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Captions,
  Check,
  ChevronRight,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipForward,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import { api } from "../client";
import { queries } from "../queries";
import { getPlaybackPreferences } from "../lib/playback-preferences";
import { formatClock, nativeBridge, nativeServerUrl } from "../lib/native-playback";
import { languageName } from "../lib/language";
import type {
  NativeAudioTrack,
  NativePlaybackEvent,
  NativePlayResult,
} from "../electron";

type SkipSegment = { start: number; end: number } | null | undefined;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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
  const artworkId = manifest?.parentPublicId ?? manifest?.itemId ?? null;
  const detail = useQuery({
    ...queries.title(artworkId ?? ""),
    enabled: artworkId != null,
  });
  const backdrop = detail.data?.item.backdrop ?? detail.data?.item.poster ?? null;

  const [session, setSession] = useState<NativePlayResult | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [cached, setCached] = useState(0);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [ended, setEnded] = useState(false);
  const [closed, setClosed] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<NativeAudioTrack[]>([]);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"audio" | "subtitles" | "speed" | "volume" | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const itemIdRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const scrubTargetRef = useRef<number | null>(null);

  itemIdRef.current = manifest?.itemId ?? null;
  if (durationRef.current == null && manifest?.duration) durationRef.current = manifest.duration;

  // A failed manifest means there is nothing to hand mpv; surface it instead of
  // leaving the surface on "Opening the player…" forever.
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

  // Start one native session per file, resuming where the viewer stopped.
  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) {
      setError("The native player is unavailable. Update the desktop app and try again.");
      setStarting(false);
      return;
    }
    if (!manifest?.fileId) return;
    let cancelled = false;
    setStarting(true);
    setError(null);
    setEnded(false);
    setClosed(false);
    setOpenMenu(null);
    endedRef.current = false;
    const resume = manifest.watch && !manifest.watch.played && manifest.watch.position > 15
      ? manifest.watch.position
      : 0;
    positionRef.current = resume;
    setPosition(resume);
    setCached(0);
    setDuration(manifest.duration ?? manifest.watch?.duration ?? null);
    durationRef.current = manifest.duration ?? manifest.watch?.duration ?? null;

    bridge
      .play({
        fileId,
        serverUrl: nativeServerUrl(),
        resumeSeconds: resume,
        autoSubtitles: preferences.autoSubtitles,
        subtitleLanguage: preferences.subtitleLanguage,
      })
      .then((result) => {
        if (cancelled) {
          void bridge.stop({ sessionId: result.sessionId }).catch(() => {});
          return;
        }
        sessionIdRef.current = result.sessionId;
        setSession(result);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStarting(false);
      });

    return () => {
      cancelled = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void bridge.stop({ sessionId }).catch(() => {});
    };
  }, [fileId, manifest?.fileId, preferences.autoSubtitles, preferences.subtitleLanguage, sessionNonce]);

  // Native events: position, cache, pause, tracks, volume and failures.
  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) return;
    const onEvent = (event: NativePlaybackEvent) => {
      if (event.fileId !== fileId) return;
      if (sessionIdRef.current && event.sessionId !== sessionIdRef.current) return;
      switch (event.type) {
        case "ready":
          setStarting(false);
          setBuffering(false);
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
          if (event.cachedSeconds != null) setCached(event.cachedSeconds);
          break;
        }
        case "duration":
          if (event.duration != null) {
            durationRef.current = event.duration;
            setDuration(event.duration);
          }
          break;
        case "pause":
          setPaused(Boolean(event.paused));
          if (event.paused) saveProgress(false);
          break;
        case "buffering":
          setBuffering(Boolean(event.buffering));
          break;
        case "volume":
          if (event.volume != null) setVolume(event.volume);
          if (event.muted != null) setMuted(event.muted);
          break;
        case "speed":
          if (event.speed != null) setSpeed(event.speed);
          break;
        case "fullscreen":
          setFullscreen(Boolean(event.fullscreen));
          break;
        case "tracks":
          setAudioTracks(event.audioTracks ?? []);
          setSubtitleTracks(event.subtitleTracks ?? []);
          break;
        case "ended":
          setEnded(true);
          endedRef.current = true;
          if (event.position != null) positionRef.current = event.position;
          saveProgress(true);
          break;
        case "error":
          setError(event.message ?? "Native playback failed");
          setStarting(false);
          break;
        case "closed":
          setStarting(false);
          setBuffering(false);
          if (!endedRef.current) {
            setClosed(true);
            saveProgress(false);
          }
          break;
        default:
          break;
      }
    };
    return bridge.onEvent(onEvent);
  }, [fileId, saveProgress]);

  // Periodic progress writes while playing (mirrors the browser reporter).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (paused || ended) return;
      if (Date.now() - lastSaveRef.current < 10_000) return;
      saveProgress(false);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [ended, paused, saveProgress]);

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

  const send = useCallback(
    async (
      action:
        | "pause"
        | "resume"
        | "seek"
        | "stop"
        | "set-audio"
        | "set-subtitle"
        | "set-volume"
        | "set-mute"
        | "set-speed"
        | "toggle-fullscreen",
      value?: number,
    ) => {
      const bridge = nativeBridge();
      const sessionId = sessionIdRef.current;
      if (!bridge || !sessionId) return;
      try {
        await bridge.command({ sessionId, action, value });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [],
  );

  const seekTo = useCallback(
    (target: number) => {
      const limit = durationRef.current;
      const next = Math.max(0, limit ? Math.min(limit, target) : target);
      positionRef.current = next;
      setPosition(next);
      void send("seek", next);
    },
    [send],
  );

  const seekBy = useCallback((delta: number) => seekTo(positionRef.current + delta), [seekTo]);

  const setVolumeTo = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(130, Math.max(0, next)));
      setVolume(clamped);
      if (clamped > 0 && muted) {
        setMuted(false);
        void send("set-mute", 0);
      }
      void send("set-volume", clamped);
    },
    [muted, send],
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    void send("set-mute", next ? 1 : 0);
  }, [muted, send]);

  const togglePlay = useCallback(() => {
    if (ended) {
      seekTo(0);
      void send("resume");
      return;
    }
    void send(paused ? "resume" : "pause");
  }, [ended, paused, seekTo, send]);

  // Auto-hide the chrome while playing; any pointer activity brings it back.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2_600);
  }, []);

  useEffect(() => {
    if (paused || ended || scrubbing != null || openMenu) {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      setControlsVisible(true);
      return;
    }
    revealControls();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [ended, openMenu, paused, revealControls, scrubbing]);

  // Space/K toggles playback, arrows seek, M mutes, F toggles fullscreen: the
  // same muscle memory as the browser player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.key === " " || key === "k") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight" || key === "l") {
        event.preventDefault();
        seekBy(10);
      } else if (event.key === "ArrowLeft" || key === "j") {
        event.preventDefault();
        seekBy(-10);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setVolumeTo(volume + 5);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setVolumeTo(volume - 5);
      } else if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (key === "f") {
        event.preventDefault();
        void send("toggle-fullscreen");
      } else if (event.key === "Escape") {
        setOpenMenu(null);
      }
      revealControls();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [revealControls, seekBy, send, setVolumeTo, toggleMute, togglePlay, volume]);

  const scrubTo = useCallback((clientX: number) => {
    const bounds = scrubRef.current?.getBoundingClientRect();
    const total = durationRef.current;
    if (!bounds || !total || bounds.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const target = ratio * total;
    scrubTargetRef.current = target;
    setScrubbing(target);
  }, []);

  const activeSegment = useMemo((): { kind: "intro" | "recap" | "outro"; end: number } | null => {
    const data = skipSegments.data;
    if (!data?.enabled) return null;
    const entries: Array<["intro" | "recap" | "outro", SkipSegment]> = [
      ["intro", data.intro],
      ["recap", data.recap],
      ["outro", data.outro],
    ];
    for (const [kind, marker] of entries) {
      if (marker && position >= marker.start && position < marker.end) {
        return { kind, end: marker.end };
      }
    }
    return null;
  }, [position, skipSegments.data]);

  const title = manifest?.title || session?.title || "Now playing";
  const shownPosition = scrubbing ?? position;
  const total = duration ?? durationRef.current;
  const percent = total && total > 0 ? Math.min(100, Math.max(0, (shownPosition / total) * 100)) : 0;
  const cachedPercent = total && total > 0 ? Math.min(100, Math.max(percent, ((shownPosition + cached) / total) * 100)) : 0;
  const subtitleEp = manifest?.subtitle ?? "";
  const cleanSubtitle = subtitleEp.replace(
    /^(?:S\d+E\d+|E\d+|\d+x\d+|Episode\s+\d+|Ep\.?\s*\d+)\s*[·\-:–—]\s*/i,
    "",
  ).trim();
  const episodeMatch = subtitleEp.match(/(?:Episode\s+(\d+)|E(\d+))/i);
  const episodeNumber = episodeMatch ? episodeMatch[1] || episodeMatch[2] : null;
  const primaryTitle = cleanSubtitle || title;

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

  const activeAudio = audioTracks.find((track) => track.selected) ?? null;
  const activeSubtitle = subtitleTracks.find((track) => track.selected) ?? null;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div
      className="fixed inset-0 z-50 select-none overflow-hidden bg-black text-white"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
    >
      {/* Artwork stands in for the video surface; mpv draws the actual frames
          in its own window. It keeps the player from looking like an empty app. */}
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            controlsVisible ? "opacity-40" : "opacity-25"
          }`}
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />

      {/* Top chrome */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start gap-3 bg-gradient-to-b from-black/85 via-black/30 to-transparent px-5 pb-12 pt-4 transition-opacity duration-300 ${
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
        <div className="min-w-0 pt-0.5">
          <p className="font-display truncate text-lg font-bold leading-tight">{primaryTitle}</p>
          {(episodeNumber || subtitleEp) && (
            <p className="mt-0.5 truncate text-xs font-medium text-white/70">
              {episodeNumber ? `Episode ${episodeNumber}` : subtitleEp}
            </p>
          )}
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75 backdrop-blur-sm">
            Native player · mpv
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            saveProgress(false);
            void send("stop");
          }}
          aria-label="Stop playback"
          className={`pointer-events-auto ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            controlsVisible ? "" : "pointer-events-none"
          }`}
        >
          <Square size={14} />
          <span>Stop</span>
        </button>
      </div>

      {/* Centre state: buffering, paused, finished, closed or an error. */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
        {error ? (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-black/70 p-6 text-center backdrop-blur-md">
            <p className="font-display text-lg font-bold">Playback stopped</p>
            <p className="mt-2 text-sm text-white/65">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={leave}
                className="rounded-lg border border-white/20 px-5 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-white/40 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setSessionNonce((nonce) => nonce + 1);
                }}
                className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-85"
              >
                Try again
              </button>
            </div>
          </div>
        ) : starting || buffering ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-white/80">
            <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
            <span className="text-xs font-medium">
              {starting ? "Opening the player…" : "Buffering…"}
            </span>
          </div>
        ) : closed ? (
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center rounded-2xl border border-white/10 bg-black/70 p-6 text-center backdrop-blur-md">
            <Square size={22} className="text-white/70" />
            <p className="mt-3 font-display text-lg font-bold">Player window closed</p>
            <p className="mt-1.5 text-sm text-white/65">
              Your progress is saved. Open the player again to keep watching.
            </p>
            <button
              onClick={() => {
                setClosed(false);
                setSessionNonce((nonce) => nonce + 1);
              }}
              className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-85"
            >
              Open player again
            </button>
          </div>
        ) : ended ? (
          <div className="pointer-events-auto flex flex-col items-center text-center">
            <p className="font-display text-xl font-bold">Playback finished</p>
            <p className="mt-1.5 text-sm text-white/65">
              {manifest?.nextFileId ? "Starting the next episode…" : "Thanks for watching."}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => {
                  seekTo(0);
                  void send("resume");
                }}
                aria-label="Play again"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/20"
              >
                <RotateCcw size={18} />
              </button>
              {manifest?.nextFileId && (
                <button
                  onClick={() =>
                    void navigate({
                      to: "/watch/$fileId",
                      params: { fileId: String(manifest.nextFileId) },
                      replace: true,
                    })
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  <SkipForward size={17} /> Next episode
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={togglePlay}
            aria-label={paused ? "Play" : "Pause"}
            className={`pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white shadow-xl backdrop-blur-sm transition-[opacity,transform] duration-200 hover:scale-[1.03] hover:bg-black/50 ${
              controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {paused ? <Play size={30} className="translate-x-0.5" fill="currentColor" /> : <Pause size={28} fill="currentColor" />}
          </button>
        )}
      </div>

      {/* Bottom chrome: title block, skip chips and the control bar. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-4 pt-16 transition-opacity duration-300 sm:px-6 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="mx-auto w-full max-w-[1500px]">
          {!error && !closed && !ended && (
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="pointer-events-none">
                <p className="font-display text-lg font-bold drop-shadow sm:text-xl">{primaryTitle}</p>
                {subtitleEp && (
                  <p className="mt-0.5 text-xs font-medium text-white/70 drop-shadow">{subtitleEp}</p>
                )}
              </div>
              <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                {activeSegment && (
                  <button
                    onClick={() => seekTo(activeSegment.end)}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black shadow-lg transition hover:bg-white/85"
                  >
                    <SkipForward size={16} />
                    {activeSegment.kind === "outro" ? "Skip ending" : `Skip ${activeSegment.kind}`}
                  </button>
                )}
                {manifest?.nextFileId && position > 0 && total != null && position >= total - 90 && (
                  <button
                    onClick={() =>
                      void navigate({
                        to: "/watch/$fileId",
                        params: { fileId: String(manifest.nextFileId) },
                        replace: true,
                        state: (previous) => ({ playerFromTitle: previous.playerFromTitle }),
                      })
                    }
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black shadow-lg transition hover:bg-white/85"
                  >
                    <SkipForward size={16} /> Next episode
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Time slider: same track/fill/buffer/thumb language as the skin. */}
          <div
            ref={scrubRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(total ?? 0)}
            aria-valuenow={Math.round(shownPosition)}
            tabIndex={0}
            className="group/slider pointer-events-auto relative flex h-8 cursor-pointer touch-none items-center"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              scrubTo(event.clientX);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              scrubTo(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              const target = scrubTargetRef.current;
              scrubTargetRef.current = null;
              setScrubbing(null);
              if (target != null) seekTo(target);
            }}
            onPointerCancel={() => {
              scrubTargetRef.current = null;
              setScrubbing(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") seekBy(10);
              else if (event.key === "ArrowLeft") seekBy(-10);
            }}
          >
            <div className="relative h-1.5 w-full rounded-full bg-white/25 transition-[height] duration-150 group-hover/slider:h-2 group-focus-visible/slider:h-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/35"
                style={{ width: `${cachedPercent}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white"
                style={{ width: `${percent}%` }}
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity duration-150 group-hover/slider:opacity-100 group-focus-visible/slider:opacity-100"
                style={{ left: `${percent}%` }}
              />
            </div>
          </div>

          <div className="pointer-events-auto mt-1 flex flex-wrap items-center gap-x-1 gap-y-2">
            <button
              onClick={() => seekBy(-10)}
              aria-label="Back 10 seconds"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Rewind size={19} />
            </button>
            <button
              onClick={togglePlay}
              aria-label={paused ? "Play" : "Pause"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-[1.04] active:scale-95"
            >
              {paused || ended ? <Play size={19} className="translate-x-px" fill="currentColor" /> : <Pause size={19} fill="currentColor" />}
            </button>
            <button
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <FastForward size={19} />
            </button>

            <div className="pointer-events-auto relative">
              <button
                onClick={() => setOpenMenu(openMenu === "volume" ? null : "volume")}
                aria-label={muted ? "Unmute" : "Volume"}
                aria-expanded={openMenu === "volume"}
                data-player-menu-trigger
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
              >
                <VolumeIcon size={19} />
              </button>
              <Popover open={openMenu === "volume"} align="left" onClose={() => setOpenMenu(null)}>
                <div className="flex w-44 items-center gap-2 px-1">
                  <button
                    onClick={toggleMute}
                    aria-label={muted ? "Unmute" : "Mute"}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    <VolumeIcon size={16} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={130}
                    value={muted ? 0 : Math.round(volume)}
                    onChange={(event) => setVolumeTo(Number(event.target.value))}
                    aria-label="Volume"
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-white"
                  />
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-white/70">
                    {muted ? 0 : Math.round(volume)}
                  </span>
                </div>
              </Popover>
            </div>

            <div className="ml-auto flex items-center gap-1.5 text-xs tabular-nums text-white/70 sm:text-sm">
              <span className="text-white">{formatClock(shownPosition)}</span>
              <span className="text-white/50">/</span>
              <span>{total ? formatClock(total) : "—"}</span>
            </div>

            <div className="hidden h-5 w-px bg-white/15 sm:block" />

            {/* Audio tracks */}
            <div className="relative">
              <MenuTrigger
                open={openMenu === "audio"}
                onClick={() => setOpenMenu(openMenu === "audio" ? null : "audio")}
                label={activeAudio?.language ? languageName(activeAudio.language) : "Audio"}
              />
              <Popover open={openMenu === "audio"} onClose={() => setOpenMenu(null)}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Audio
                </p>
                {audioTracks.length === 0 && (
                  <p className="px-3 pb-2 text-xs text-white/55">One track</p>
                )}
                {audioTracks.map((track) => (
                  <MenuItem
                    key={track.id}
                    active={track.selected}
                    onClick={() => {
                      setOpenMenu(null);
                      void send("set-audio", track.id);
                    }}
                  >
                    {track.language ? languageName(track.language) : track.title ?? `Track ${track.id}`}
                    {track.default ? " · default" : ""}
                  </MenuItem>
                ))}
              </Popover>
            </div>

            {/* Subtitles */}
            <div className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === "subtitles" ? null : "subtitles")}
                data-player-menu-trigger
                aria-label="Subtitles"
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/15 hover:text-white ${
                  activeSubtitle ? "text-white" : "text-white/70"
                }`}
              >
                <Captions size={19} />
              </button>
              <Popover open={openMenu === "subtitles"} onClose={() => setOpenMenu(null)}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Subtitles
                </p>
                <MenuItem
                  active={!activeSubtitle}
                  onClick={() => {
                    setOpenMenu(null);
                    void send("set-subtitle", 0);
                  }}
                >
                  Off
                </MenuItem>
                {subtitleTracks.map((track) => (
                  <MenuItem
                    key={track.id}
                    active={track.selected}
                    onClick={() => {
                      setOpenMenu(null);
                      void send("set-subtitle", track.id);
                    }}
                  >
                    {track.language ? languageName(track.language) : track.title ?? `Track ${track.id}`}
                  </MenuItem>
                ))}
              </Popover>
            </div>

            {/* Playback speed */}
            <div className="relative">
              <MenuTrigger
                open={openMenu === "speed"}
                onClick={() => setOpenMenu(openMenu === "speed" ? null : "speed")}
                label={speed === 1 ? "1×" : `${speed}×`}
              />
              <Popover open={openMenu === "speed"} onClose={() => setOpenMenu(null)}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  Speed
                </p>
                {SPEEDS.map((option) => (
                  <MenuItem
                    key={option}
                    active={Math.abs(speed - option) < 0.01}
                    onClick={() => {
                      setOpenMenu(null);
                      setSpeed(option);
                      void send("set-speed", option);
                    }}
                  >
                    {option === 1 ? "Normal" : `${option}×`}
                  </MenuItem>
                ))}
              </Popover>
            </div>

            <button
              onClick={() => void send("toggle-fullscreen")}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A translucent popover anchored above a control, closed on outside clicks. */
function Popover({
  open,
  align = "right",
  onClose,
  children,
}: {
  open: boolean;
  align?: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The trigger's own click toggles the menu; closing here would make the
      // toggle reopen it instead of closing it.
      if (target?.closest("[data-player-menu-trigger]")) return;
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute bottom-[calc(100%+10px)] z-50 min-w-44 rounded-xl border border-white/10 bg-black/75 p-1 text-sm text-white shadow-2xl backdrop-blur-lg ${
        align === "left" ? "left-0" : "right-0"
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuTrigger({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      data-player-menu-trigger
      className={`inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors hover:bg-white/15 hover:text-white ${
        open ? "bg-white/15 text-white" : "text-white/80"
      }`}
    >
      <span className="max-w-24 truncate capitalize">{label}</span>
      <ChevronRight size={13} className="rotate-[-90deg] text-white/50" />
    </button>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white ${
        active ? "text-white" : "text-white/75"
      }`}
    >
      <span className="truncate">{children}</span>
      {active && <Check size={14} className="shrink-0 text-white" />}
    </button>
  );
}
