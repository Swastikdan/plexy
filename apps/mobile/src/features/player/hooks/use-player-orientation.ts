import * as NavigationBar from "expo-navigation-bar";
import * as Orientation from "expo-screen-orientation";
import { useEffect,useRef } from "react";

// The player is landscape-only: the device never rotates to portrait while
// playback is open. The app shell outside the player is portrait and is
// restored on exit. Serialize native calls so rapid changes cannot leave a
// stale lock behind.
export function usePlayerOrientation(onError: () => void) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => {
    let live = true;
    queue.current = queue.current
      .then(async () => {
        if (!live) return;
        await Orientation.lockAsync(Orientation.OrientationLock.LANDSCAPE);
        if (live) NavigationBar.NavigationBar.setHidden(true);
      })
      .catch(() => {
        if (live) error.current();
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      NavigationBar.NavigationBar.setHidden(false);
      queue.current = queue.current
        .then(async () => {
          await Orientation.lockAsync(Orientation.OrientationLock.PORTRAIT);
        })
        .catch(() => {});
    };
  }, []);
}
