/// The Video.js media component for embedded mpv playback.
///
/// It owns the desktop playback session: it asks the main process to open the
/// file, feeds every mpv event into `MpvMedia`, and stops the session when the
/// route changes. The UI above it is the ordinary Video.js skin, so controls,
/// hotkeys and gestures behave exactly like the browser player.
import { useEffect, useMemo, useRef } from "react";
import { useAttachMedia, useMediaInstance } from "@videojs/react";

import { nativeBridge, nativeFallbackServerUrl, nativeServerUrl } from "../../lib/native-playback";
import type { NativePlaybackEvent } from "../../electron";
import { MpvMedia, type MpvSessionController } from "./mpv-media";

/** The subset of the native manifest this component needs. */
export interface MpvVideoSource {
  fileId: number;
  title?: string;
  subtitle?: string | null;
  duration?: number | null;
  watch?: { position: number; duration: number | null; played: boolean } | null;
}

export interface MpvVideoProps {
  source: MpvVideoSource;
  autoSubtitles: boolean;
  subtitleLanguage: string;
  onEvent?: (event: NativePlaybackEvent) => void;
  onSession?: (sessionId: string) => void;
  onFatal?: (message: string) => void;
}

interface MediaInstance {
  destroy(): void;
}

export function MpvVideo({
  source,
  autoSubtitles,
  subtitleLanguage,
  onEvent,
  onSession,
  onFatal,
}: MpvVideoProps) {
  // The adapter is a structural HTMLMediaElement; Video.js types it through
  // its EngineAdapter union, which this deliberately does not implement.
  const media = useMediaInstance(
    MpvMedia as unknown as new () => MpvMedia & { destroy(): void },
  );
  const attachRef = useAttachMedia(media);
  const sessionRef = useRef<string | null>(null);
  const pendingPauseAction = useRef<"pause" | "resume" | null>(null);

  // Stable callbacks so the session is not restarted on every render.
  const callbacks = useRef({ onEvent, onSession, onFatal });
  callbacks.current = { onEvent, onSession, onFatal };

  const controller = useMemo<MpvSessionController>(() => {
    const send = (action: Parameters<NonNullable<ReturnType<typeof nativeBridge>>["command"]>[0]["action"], value?: number) => {
      const bridge = nativeBridge();
      const sessionId = sessionRef.current;
      if (!bridge) return;
      if (!sessionId) {
        if (action === "pause" || action === "resume") pendingPauseAction.current = action;
        return;
      }
      // Commands race with teardown and hover playback. A late seek or volume
      // write against an already-closed session must not tear down a healthy
      // player; session-level errors arrive through the event stream instead.
      void bridge.command({ sessionId, action, value }).catch(() => {});
    };
    return {
      resume: () => send("resume"),
      pause: () => send("pause"),
      seek: (seconds) => send("seek", seconds),
      setVolume: (percent) => send("set-volume", percent),
      setMute: (muted) => send("set-mute", muted ? 1 : 0),
      setSpeed: (rate) => send("set-speed", rate),
      selectAudio: (trackId) => send("set-audio", trackId),
      selectSubtitle: (trackId) => send("set-subtitle", trackId),
    };
  }, []);

  const fileId = source.fileId;
  // The manifest is refetched while trickplay is generated and as progress is
  // saved. Its watch position therefore changes during playback; only the
  // value from the first manifest for this file may start a session, or the
  // player would stop and reopen itself every time the query refreshes.
  const resumeRef = useRef<{ fileId: number; seconds: number } | null>(null);
  if (!resumeRef.current || resumeRef.current.fileId !== fileId) {
    resumeRef.current = {
      fileId,
      seconds:
        source.watch && !source.watch.played && source.watch.position > 15
          ? source.watch.position
          : 0,
    };
  }
  const resume = resumeRef.current.seconds;

  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) {
      callbacks.current.onFatal?.("The embedded player is unavailable in this build.");
      return;
    }

    let cancelled = false;
    sessionRef.current = null;
    media.begin(controller, { title: source.title });

    const pendingEvents = new Map<string, NativePlaybackEvent[]>();
    const applyEvent = (event: NativePlaybackEvent) => {
      if (event.type === "error") {
        callbacks.current.onFatal?.(event.message ?? "Playback failed");
        return;
      }
      if (event.type === "closed") {
        if (media.ended) return;
        callbacks.current.onFatal?.("The player closed unexpectedly.");
        return;
      }
      media.apply(event);
      callbacks.current.onEvent?.(event);
    };
    const off = bridge.onEvent((event) => {
      if (event.fileId !== fileId) return;
      const sessionId = sessionRef.current;
      if (sessionId) {
        if (event.sessionId === sessionId) applyEvent(event);
        return;
      }
      // mpv can report tracks, readiness or failure before the IPC reply.
      const events = pendingEvents.get(event.sessionId) ?? [];
      events.push(event);
      pendingEvents.set(event.sessionId, events);
    });

    bridge
      .play({
        fileId,
        serverUrl: nativeServerUrl(),
        fallbackServerUrl: nativeFallbackServerUrl(),
        resumeSeconds: resume,
        autoSubtitles,
        subtitleLanguage,
      })
      .then((result) => {
        if (cancelled) {
          void bridge.stop({ sessionId: result.sessionId }).catch(() => {});
          return;
        }
        sessionRef.current = result.sessionId;
        callbacks.current.onSession?.(result.sessionId);
        if (result.title) media.contentData = { title: result.title };
        const events = pendingEvents.get(result.sessionId);
        pendingEvents.clear();
        events?.forEach(applyEvent);
        const action = pendingPauseAction.current;
        pendingPauseAction.current = null;
        if (action === "pause") media.pause();
        if (action === "resume") void media.play();
      })
      .catch((cause) => {
        pendingEvents.clear();
        if (!cancelled) {
          callbacks.current.onFatal?.(cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
      off();
      pendingEvents.clear();
      const sessionId = sessionRef.current;
      sessionRef.current = null;
      pendingPauseAction.current = null;
      media.end();
      if (sessionId) void bridge.stop({ sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, resume, autoSubtitles, subtitleLanguage, media, controller]);

  return <div ref={attachRef} className="absolute inset-0" aria-hidden />;
}
