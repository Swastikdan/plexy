import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Playback was pushed from a title page; closing it can go back safely. */
    playerFromTitle?: boolean;
  }
}
