import { useEffect, useId, useRef, useState } from "react";
import { nativeMedia, type CastStatus } from "@/core/native-media/bridge";
import { useEventCallback } from "@/shared/hooks/use-event-callback";

export function useCastPlayback(update: (status: CastStatus, first: boolean) => void, disconnected: () => void, error: (message: string) => void) {
  const id = useId();
  const activeRef = useRef(false);
  const [requested, setRequested] = useState(false);
  const [active, setActive] = useState(false);
  const onUpdate = useEventCallback(update);
  const onDisconnect = useEventCallback(disconnected);
  const onError = useEventCallback(error);
  useEffect(() => {
    const bridge = nativeMedia;
    if (!bridge) return;
    const listener = bridge.addListener("onCastError", ({ id: requestId, message }) => {
      if (requestId !== id) return;
      setRequested(false);
      if (activeRef.current) {
        activeRef.current = false;
        setActive(false);
        onDisconnect();
      }
      onError(message);
    });
    return () => listener.remove();
  }, [id, onDisconnect, onError]);
  useEffect(() => {
    const bridge = nativeMedia;
    if (!bridge || !requested) return;
    let live = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await bridge.castStatus(id);
        if (!live) return;
        if (status?.active) {
          const first = !activeRef.current;
          activeRef.current = true;
          if (first) setActive(true);
          onUpdate(status, first);
        } else if (activeRef.current && !status) {
          activeRef.current = false;
          setActive(false);
          setRequested(false);
          onDisconnect();
        }
      } catch {
        if (live) onError("Couldn’t read the TV’s playback status.");
      } finally {
        checking = false;
      }
    };
    const interval = setInterval(() => void check(), 500);
    return () => {
      live = false;
      clearInterval(interval);
      void bridge.castCommand(id, "stop", 0).catch(() => {});
    };
  }, [id, requested, onUpdate, onDisconnect, onError]);

  const command = (action: "play" | "pause" | "seek" | "stop", seconds = 0) =>
    void nativeMedia?.castCommand(id, action, seconds).catch(() => onError("Couldn’t control TV playback."));

  return {
    available: Boolean(nativeMedia),
    active,
    activeRef,
    start(uri: string, title: string, seconds: number) {
      const bridge = nativeMedia;
      if (!bridge) return;
      setRequested(true);
      void bridge.startCasting(id, uri, title, seconds).catch((cause) => {
        setRequested(false);
        onError(cause instanceof Error ? cause.message : "Couldn’t start casting.");
      });
    },
    command,
  };
}
