import * as NavigationBar from "expo-navigation-bar";
import * as Orientation from "expo-screen-orientation";
import { useEffect, useRef } from "react";
// Serialize native orientation calls so rapid fullscreen toggles cannot restore
// a stale landscape lock after leaving the player.
export function usePlayerOrientation(fullscreen: boolean, onError: () => void) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const previous = useRef<Orientation.OrientationLock | null>(null);
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => {
    queue.current = queue.current
      .then(async () => {
        previous.current = await Orientation.getOrientationLockAsync();
      })
      .catch(() => error.current());
    return () => {
      NavigationBar.NavigationBar.setHidden(false);
      queue.current = queue.current
        .then(async () => {
          await Orientation.lockAsync(Orientation.OrientationLock.PORTRAIT);
        })
        .catch(() => {});
    };
  }, []);
  useEffect(() => {
    let live = true;
    queue.current = queue.current
      .then(async () => {
        if (!live) return;
        await Orientation.lockAsync(
          fullscreen
            ? Orientation.OrientationLock.LANDSCAPE
            : Orientation.OrientationLock.PORTRAIT,
        );
        if (live) NavigationBar.NavigationBar.setHidden(fullscreen);
      })
      .catch(() => {
        if (live) error.current();
      });
    return () => {
      live = false;
    };
  }, [fullscreen]);
}
