/**
 * useIsFullscreen — returns true while the window or document is in fullscreen mode.
 *
 * Supports:
 * 1. Electron macOS window fullscreen events (IPC fullscreen-change & isFullScreen)
 * 2. Media query (display-mode: fullscreen)
 * 3. HTML5 Fullscreen API (document.fullscreenElement / webkitFullscreenElement)
 *
 * When on Electron macOS in windowed mode, 88px of space is kept for the window traffic
 * light buttons (close/minimize/zoom). In fullscreen mode, macOS auto-hides those controls,
 * so the top navigation logo / back button can move flush to the left.
 */
import { useEffect, useState } from "react";

function checkDocumentFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    return true;
  }
  if (typeof window !== "undefined") {
    if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) {
      return true;
    }
  }
  return false;
}

export function useIsFullscreen(): boolean {
  // Electron's native window fullscreen is reported over IPC, not through the
  // Document fullscreen API. Keep the two sources separate: a window resize
  // used to reset the document check to false and clobber the IPC state, so
  // fullscreen navigation stayed offset for the traffic lights.
  const [electronFullscreen, setElectronFullscreen] = useState(false);
  const [documentFullscreen, setDocumentFullscreen] = useState(checkDocumentFullscreen);

  useEffect(() => {
    let isSubscribed = true;

    if (window.electronAPI?.isFullScreen) {
      window.electronAPI
        .isFullScreen()
        .then((fs) => {
          if (isSubscribed) setElectronFullscreen(Boolean(fs));
        })
        .catch(() => {});
    }

    const unsubElectron = window.electronAPI?.onFullScreenChange?.((fs) => {
      if (isSubscribed) setElectronFullscreen(Boolean(fs));
    });

    const update = () => {
      if (isSubscribed) setDocumentFullscreen(checkDocumentFullscreen());
    };

    const mediaQuery = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(display-mode: fullscreen)")
      : null;

    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener("change", update);
    }

    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);

    return () => {
      isSubscribed = false;
      unsubElectron?.();
      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener("change", update);
      }
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  return electronFullscreen || documentFullscreen;
}
