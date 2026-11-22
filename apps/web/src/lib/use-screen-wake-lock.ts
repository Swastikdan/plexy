/// Keeps the display awake while video is actively playing.
///
/// Browsers and operating systems do not reliably infer this from a `<video>`
/// element, so macOS can dim the screen after the display-sleep timeout. The
/// Screen Wake Lock API asks the browser to hold the display assertion and is
/// re-acquired when the tab becomes visible again (the browser releases all
/// wake locks when the document is hidden).
import { useEffect, useRef } from "react";

export function useScreenWakeLock(active: boolean): void {
  const activeRef = useRef(active);
  activeRef.current = active;
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let disposed = false;
    let acquiring = false;

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
    };

    const acquire = async () => {
      if (disposed || !activeRef.current) return;
      if (document.visibilityState !== "visible") return;
      if (!navigator.wakeLock) return;
      if (acquiring) return;
      if (sentinelRef.current && !sentinelRef.current.released) return;

      acquiring = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (disposed || !activeRef.current) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener(
          "release",
          () => {
            if (sentinelRef.current === sentinel) sentinelRef.current = null;
          },
          { once: true },
        );
      } catch {
        // Permission can be refused in the background, in power-saver mode, or
        // when the page is not a secure context. Playback continues normally.
      } finally {
        acquiring = false;
      }
    };

    if (active) void acquire();
    else release();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (activeRef.current) void acquire();
      } else {
        release();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active]);
}
