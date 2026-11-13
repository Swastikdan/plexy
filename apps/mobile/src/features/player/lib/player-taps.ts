import { DOUBLE_TAP_MS, doubleTapSeek, type PlayerTap } from "./player-interactions";

/** Single taps reveal immediately when hidden; double taps still seek. */
export function createPlayerTapController({
  toggleControls,
  seekBy,
  schedule,
  cancel,
}: {
  toggleControls: () => void;
  seekBy: (seconds: number) => void;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
}) {
  let previous: PlayerTap | null = null;
  let timer: unknown = null;
  let pendingToggle = false;
  const reset = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    previous = null;
    pendingToggle = false;
  };
  return {
    reset,
    tap(current: PlayerTap, visible: boolean) {
      const seconds = doubleTapSeek(previous, current);
      if (seconds !== null) {
        reset();
        seekBy(seconds);
        return;
      }
      // Opposite-side taps are separate single taps, not a cancelled first tap.
      const flush = pendingToggle;
      reset();
      if (flush) toggleControls();
      previous = current;
      if (!visible) toggleControls();
      else pendingToggle = true;
      timer = schedule(() => {
        const toggle = pendingToggle;
        reset();
        if (toggle) toggleControls();
      }, DOUBLE_TAP_MS);
    },
  };
}
