/// Native playback surface for the desktop app.
///
/// mpv renders in its own window with native controls (seek, volume, audio and
/// subtitle menus). Plexy keeps a small in-app surface for session state,
/// progress, resume, skip markers and next-episode handoff, and never mounts
/// the browser <video> or the preparation blocker here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FastForward, Pause, Play, Rewind, Square } from "lucide-react";

import { api } from "../client";
import { queries } from "../queries";
import { getPlaybackPreferences } from "../lib/playback-preferences";
import { formatClock, nativeBridge, nativeServerUrl } from "../lib/native-playback";
import { languageName } from "../lib/language";
import type { NativeAudioTrack, NativePlaybackEvent, NativePlayResult } from "../electron";

type SkipSegment = { start: number; end: number } | null | undefined;

export function NativeWatchPage({
  fileId,
}: {
  fileId: number;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferences = useMemo(() => getPlaybackPreferences(), []);
  const play = useQuery(queries.playNative(fileId));
  const skipSegments = useQuery({
    queryKey: ["skip-segments", fileId],
    queryFn: () => api.skipSegments(fileId),
    staleTime: 5 * 60_000,
  });

  const [session, setSession] = useState<NativePlayResult | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [ended, setEnded] = useState(false);
  const [closed, setClosed] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);

  const sessionIdRef = useRef<string | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const itemIdRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  const manifest = play.data;
  itemIdRef.current = manifest?.itemId ?? null;
  if (durationRef.current == null && manifest?.duration) durationRef.current = manifest.duration;

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
    endedRef.current = false;
    const resume = manifest.watch && !manifest.watch.played && manifest.watch.position > 15
      ? manifest.watch.position
      : 0;
    positionRef.current = resume;
    setPosition(resume);
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

  // Native events: position, pause, buffering, completion and failures.
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
        case "audio":
          setAudioTracks(event.audioTracks ?? []);
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
    async (action: "pause" | "resume" | "seek" | "stop" | "set-audio", value?: number) => {
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

  const seekBy = useCallback(
    (delta: number) => {
      const target = Math.max(0, positionRef.current + delta);
      positionRef.current = target;
      setPosition(target);
      void send("seek", target);
    },
    [send],
  );

  // Space toggles playback, arrows seek: same muscle memory as the browser player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        event.preventDefault();
        void send(paused ? "resume" : "pause");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(30);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-10);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paused, seekBy, send]);

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
  const percent = duration && duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const leave = () => {
    saveProgress(false);
    if (manifest?.parentItemId != null) {
      void navigate({ to: "/title/$itemId", params: { itemId: String(manifest.parentItemId) }, replace: true });
    } else {
      void navigate({ to: "/", replace: true });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060607] text-white select-none">
      <div className="flex items-start justify-between gap-4 px-6 pb-10 pt-5">
        <div className="flex items-start gap-3">
          <button
            onClick={leave}
            aria-label="Back"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="font-display text-lg font-bold leading-tight">{title}</p>
            {manifest?.subtitle && <p className="mt-0.5 text-sm text-ink-muted">{manifest.subtitle}</p>}
            <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">
              Native playback · separate mpv window
            </p>
          </div>
        </div>

      </div>

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-xl text-center">
          {error ? (
            <>
              <p className="font-display text-xl font-bold">Native playback stopped</p>
              <p className="mt-2 text-sm text-ink-muted">{error}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={leave}
                  className="rounded-lg border border-white/20 px-5 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-white/40 hover:text-white"
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-white/5">
                {starting || buffering ? (
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                ) : ended ? (
                  <Square size={26} />
                ) : (
                  <Play size={28} className={paused ? "" : "opacity-70"} />
                )}
              </div>
              <p className="font-display text-lg font-bold">
                {ended
                  ? "Playback finished"
                  : starting
                    ? "Opening the native player…"
                    : closed
                      ? "Native player closed"
                      : buffering
                        ? "Buffering…"
                        : paused
                          ? "Paused"
                          : "Playing in the mpv window"}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {ended && manifest?.nextFileId
                  ? "Starting the next episode…"
                  : closed
                    ? "Your progress is saved. Reopen the native player to continue."
                    : "Seeking, volume, audio tracks and subtitles are in the mpv window. This surface keeps your progress."}
              </p>

              {closed && !ended && (
                <button
                  onClick={() => setSessionNonce((nonce) => nonce + 1)}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-85"
                >
                  Open native player again
                </button>
              )}

              {audioTracks.length > 1 && !closed && !ended && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Audio</span>
                  {audioTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => void send("set-audio", track.id)}
                      className={
                        track.selected
                          ? "rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
                          : "rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/75 transition-colors hover:border-white/40 hover:text-white"
                      }
                    >
                      {track.language
                        ? languageName(track.language)
                        : track.title ?? `Track ${track.id}`}
                      {track.default ? " · default" : ""}
                    </button>
                  ))}
                </div>
              )}

              {activeSegment && !ended && (
                <button
                  onClick={() => {
                    positionRef.current = activeSegment.end;
                    setPosition(activeSegment.end);
                    void send("seek", activeSegment.end);
                  }}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-85"
                >
                  Skip {activeSegment.kind === "outro" ? "ending" : activeSegment.kind}
                </button>
              )}

              {ended && manifest?.nextFileId && (
                <button
                  onClick={() =>
                    void navigate({
                      to: "/watch/$fileId",
                      params: { fileId: String(manifest.nextFileId) },
                      replace: true,
                    })
                  }
                  className="mt-4 rounded-lg bg-[#E50914] px-5 py-2 text-sm font-semibold transition-colors hover:bg-[#b80710]"
                >
                  Play next episode now
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="px-6 pb-8 pt-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-3 text-xs tabular-nums text-white/55">
            <span>{formatClock(position)}</span>
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-white/12"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
            >
              <div className="h-full origin-left rounded-full bg-[#E50914] transition-transform duration-700 ease-out" style={{ transform: `scaleX(${percent / 100})` }} />
            </div>
            <span>{duration ? formatClock(duration) : "—"}</span>
          </div>

          {!error && !closed && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => seekBy(-10)}
                aria-label="Back 10 seconds"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              >
                <Rewind size={18} />
              </button>
              <button
                onClick={() => void send(paused ? "resume" : "pause")}
                aria-label={paused ? "Play" : "Pause"}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition-opacity hover:opacity-90"
              >
                {paused ? <Play size={20} /> : <Pause size={20} />}
              </button>
              <button
                onClick={() => seekBy(30)}
                aria-label="Forward 30 seconds"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              >
                <FastForward size={18} />
              </button>
              <button
                onClick={() => {
                  saveProgress(false);
                  void send("stop");
                }}
                aria-label="Stop playback"
                className="ml-2 inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white"
              >
                <Square size={12} /> Stop
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
