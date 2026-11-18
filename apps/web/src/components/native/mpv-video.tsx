/// The Video.js media component for embedded mpv playback.
///
/// It owns the desktop playback session: it asks the main process to open the
/// file, feeds every mpv event into `MpvMedia`, and stops the session when the
/// route changes. The UI above it is the ordinary Video.js skin, so controls,
/// hotkeys and gestures behave exactly like the browser player.
import { useEffect, useMemo, useRef } from "react";
import { useAttachMedia, useMediaInstance } from "@videojs/react";

import { nativeBridge, nativeServerUrl } from "../../lib/native-playback";
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

  // Stable callbacks so the session is not restarted on every render.
  const callbacks = useRef({ onEvent, onSession, onFatal });
  callbacks.current = { onEvent, onSession, onFatal };

  const controller = useMemo<MpvSessionController>(() => {
    const send = (action: Parameters<NonNullable<ReturnType<typeof nativeBridge>>["command"]>[0]["action"], value?: number) => {
      const bridge = nativeBridge();
      const sessionId = sessionRef.current;
      if (!bridge || !sessionId) return;
      void bridge.command({ sessionId, action, value }).catch((cause) => {
        callbacks.current.onFatal?.(cause instanceof Error ? cause.message : String(cause));
      });
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
  const resume = source.watch && !source.watch.played && source.watch.position > 15
    ? source.watch.position
    : 0;

  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) {
      callbacks.current.onFatal?.("The embedded player is unavailable in this build.");
      return;
    }

    let cancelled = false;
    sessionRef.current = null;
    media.begin(controller, { title: source.title });

    const off = bridge.onEvent((event: NativePlaybackEvent) => {
      if (event.fileId !== fileId) return;
      if (sessionRef.current && event.sessionId !== sessionRef.current) return;
      if (event.type === "error") {
        callbacks.current.onFatal?.(event.message ?? "Playback failed");
        return;
      }
      if (event.type === "closed") {
        if (!media.ended) callbacks.current.onFatal?.("The player closed unexpectedly.");
        return;
      }
      media.apply(event);
      callbacks.current.onEvent?.(event);
    });

    bridge
      .play({
        fileId,
        serverUrl: nativeServerUrl(),
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
      })
      .catch((cause) => {
        if (!cancelled) {
          callbacks.current.onFatal?.(cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
      off();
      const sessionId = sessionRef.current;
      sessionRef.current = null;
      media.end();
      if (sessionId) void bridge.stop({ sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, resume, autoSubtitles, subtitleLanguage, media, controller]);

  return <div ref={attachRef} className="absolute inset-0" aria-hidden />;
}
