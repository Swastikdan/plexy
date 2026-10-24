import type { BrowserCaps } from "./types";

/**
 * Measure real browser decoding capabilities from an HTMLVideoElement (PRD 5.6, 10).
 * Tests supported MIME types and codecs directly against the browser engine.
 */
export function probeBrowserCaps(video?: HTMLVideoElement | null): BrowserCaps {
  if (typeof window === "undefined") {
    return { avc: true, hevc: false, vp9: true, av1: false, aac: true, opus: true };
  }
  const el = video || document.createElement("video");
  const can = (type: string) => {
    try {
      const res = el.canPlayType(type);
      return res === "probably" || res === "maybe";
    } catch {
      return false;
    }
  };

  return {
    avc: can('video/mp4; codecs="avc1.640028"'),
    hevc: can('video/mp4; codecs="hvc1.1.6.L123.B0"') || can('video/mp4; codecs="hev1.1.6.L123.B0"'),
    vp9: can('video/webm; codecs="vp9"'),
    av1: can('video/mp4; codecs="av01.0.08M.08"') || can('video/webm; codecs="av01.0.08M.08"'),
    aac: can('audio/mp4; codecs="mp4a.40.2"'),
    opus: can('audio/webm; codecs="opus"'),
  };
}
