import { DOUBLE_TAP_MS, doubleTapSeek, type PlayerTap } from "./player-interactions";

/** Single taps reveal immediately when hidden; double taps still seek. */
export function createPlayerTapController({
  toggleControls,
  seekBy,
  schedule,
  cancel,
  seekSeconds,
}: {
  toggleControls: () => void;
  seekBy: (seconds: number) => void;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
  seekSeconds?: () => number;
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
      const seconds = doubleTapSeek(previous, current, seekSeconds?.());
      if (seconds !== null) {
        reset();
        seekBy(seconds);
        // Continue a same-side burst without requiring a new double tap.
        previous = current;
        timer = schedule(reset, DOUBLE_TAP_MS);
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
