import {
  DOUBLE_TAP_MS,
  SEEK_BURST_MS,
  SEEK_SECONDS,
  doubleTapSeek,
  type PlayerTap,
} from "./player-interactions";

/**
 * A single tap is a click: it reveals hidden controls immediately, otherwise
 * it toggles them after the double-tap window. A double tap skips one
 * interval and opens a seek burst.
 *
 * While the burst is open, every same-side tap skips one more interval. That
 * lets a user tap twice and then keep tapping once per second to accumulate a
 * larger skip, instead of double tapping again for each step.
 */
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
  let burst = false;
  const reset = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    previous = null;
    pendingToggle = false;
    burst = false;
  };
  const step = () => seekSeconds?.() ?? SEEK_SECONDS;
  /** Keep the burst alive from the latest skip so the next tap continues it. */
  const keepBurstOpen = () => {
    if (timer !== null) cancel(timer);
    burst = true;
    pendingToggle = false;
    timer = schedule(reset, SEEK_BURST_MS);
  };
  return {
    reset,
    tap(current: PlayerTap, visible: boolean) {
      // A tap during an open burst is another skip, not a new click.
      if (
        burst &&
        previous?.side === current.side &&
        current.time >= previous.time &&
        current.time - previous.time <= SEEK_BURST_MS
      ) {
        previous = current;
        keepBurstOpen();
        seekBy(current.side === "left" ? -step() : step());
        return;
      }
      const seconds = doubleTapSeek(previous, current, step());
      if (seconds !== null) {
        // The double tap starts the burst and skips a single interval.
        previous = current;
        keepBurstOpen();
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
