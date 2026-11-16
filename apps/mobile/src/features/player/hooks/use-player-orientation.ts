import { useLayoutEffect, useEffect, useRef } from "react";
import * as NavigationBar from "expo-navigation-bar";
import * as Orientation from "expo-screen-orientation";

// Both the native player and the online iframe player are landscape-only. The
// lock is ref-counted so a handoff from one player to the other never flashes
// portrait, and the app shell is restored only after the last player exits.
const LANDSCAPE = Orientation.OrientationLock.LANDSCAPE;
const PORTRAIT = Orientation.OrientationLock.PORTRAIT;
let activePlayers = 0;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let handoffUntil = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Call before replacing one player with another to avoid a portrait flash. */
export function markPlayerHandoff() {
  handoffUntil = Date.now() + 1000;
}

function enqueue(task: () => Promise<void>, onError?: () => void) {
  queue = queue
    .then(async () => {
      try {
        await task();
      } catch {
        onError?.();
      }
    })
    .catch(() => {});
}

/** Re-assert landscape for the custom fullscreen control. */
export function lockPlayerLandscape() {
  enqueue(async () => {
    await Orientation.lockAsync(LANDSCAPE);
    try {
      await NavigationBar.NavigationBar.setHidden(true);
    } catch {}
  });
}

export function usePlayerOrientation(onError: () => void) {
  const error = useRef(onError);
  useLayoutEffect(() => {
    error.current = onError;
  }, [onError]);
  useEffect(() => {
    activePlayers += 1;
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
    if (activePlayers === 1) {
      enqueue(async () => {
        await Orientation.lockAsync(LANDSCAPE);
        try {
          await NavigationBar.NavigationBar.setHidden(true);
        } catch {}
      }, () => error.current());
    }
    return () => {
      activePlayers = Math.max(0, activePlayers - 1);
      if (activePlayers > 0 || restoreTimer) return;
      const delay = Date.now() < handoffUntil ? 500 : 0;
      const restore = () => {
        restoreTimer = null;
        if (activePlayers > 0) return;
        enqueue(async () => {
          try {
            await NavigationBar.NavigationBar.setHidden(false);
          } catch {}
          await Orientation.lockAsync(PORTRAIT);
        });
      };
      if (delay === 0) {
        restore();
        return;
      }
      restoreTimer = setTimeout(restore, delay);
    };
  }, []);
}
