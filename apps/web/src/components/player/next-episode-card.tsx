/// The top-right "up next" control shared by browser and native playback.
///
/// The card is intentionally part of the player chrome rather than the bottom
/// controls: it previews the actual next episode (poster, series, episode label)
/// and stays visible for the whole episode. Once the credits start it switches
/// to the "Up next" treatment, which also survives the controls fading out.
import { useEffect, useState } from "react";
import { Play, SkipForward } from "lucide-react";
import type { NextEpisode } from "@plexy/api-client";

import { artworkUrl } from "@/lib/artwork-url";

export function NextEpisodeCard({
  next,
  upNext,
  visible,
  onPlay,
}: {
  next: NextEpisode;
  /** True once the credits have started; switches to the "Up next" treatment. */
  upNext: boolean;
  visible: boolean;
  onPlay: () => void;
}) {
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => setPosterFailed(false), [next.fileId]);
  const poster = artworkUrl(next.poster);

  return (
    <div
      className={`absolute right-3 top-16 z-40 w-[min(84vw,22rem)] transition duration-300 sm:right-5 sm:top-[4.5rem] ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-1 opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={(event) => {
          // Do not let the player surface treat this control click as play/pause.
          event.stopPropagation();
          onPlay();
        }}
        aria-label={`Play next episode: ${next.subtitle}`}
        className={`group flex w-full items-center gap-3 rounded-xl border bg-black/75 p-2.5 pr-3 text-left text-white shadow-2xl backdrop-blur-md transition hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          upNext ? "border-white/30" : "border-white/15"
        }`}
      >
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-white/10 sm:h-16 sm:w-28">
          {poster && !posterFailed ? (
            <img
              src={poster}
              alt=""
              onError={() => setPosterFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/45">
              <Play size={22} />
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
              <Play size={16} className="ml-0.5" fill="currentColor" />
            </span>
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`block text-[10px] font-semibold uppercase tracking-[0.16em] ${
              upNext ? "text-white/75" : "text-white/45"
            }`}
          >
            {upNext ? "Up next" : "Next episode"}
          </span>
          <span
            title={next.subtitle}
            className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug"
          >
            {next.subtitle}
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/60" title={next.title}>
            {next.title}
          </span>
        </span>

        <SkipForward size={18} className="shrink-0 text-white/65 transition group-hover:text-white" />
      </button>
    </div>
  );
}
