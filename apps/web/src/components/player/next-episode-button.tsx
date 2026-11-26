import { useState } from "react";
import { SkipForward } from "lucide-react";
import type { NextEpisode } from "@plexy/api-client";

import { artworkUrl } from "@/lib/artwork-url";

export function NextEpisodeButton({
  next,
  onPlay,
}: {
  next: NextEpisode | null;
  onPlay: () => void;
}) {
  const poster = artworkUrl(next?.poster);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
      }}
      aria-label={next ? `Next Episode: ${next.title}, ${next.subtitle}` : undefined}
      className="group relative pointer-events-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-black shadow-lg transition-colors hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <SkipForward size={16} aria-hidden="true" />
      Next Episode
      {next && (
        <span
          aria-hidden="true"
          className="pointer-events-none invisible absolute right-0 top-full mt-2 flex w-[min(84vw,20rem)] items-center gap-3 rounded-xl border border-white/15 bg-black/90 p-2.5 text-left text-white shadow-xl backdrop-blur-md group-hover:visible group-focus-visible:visible"
        >
          {poster && poster !== failedPoster && (
            <img
              src={poster}
              alt=""
              onError={() => setFailedPoster(poster)}
              className="h-14 w-24 shrink-0 rounded-md object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{next.title}</span>
            <span className="mt-0.5 line-clamp-2 text-xs font-medium text-white/75">
              {next.subtitle}
            </span>
          </span>
        </span>
      )}
    </button>
  );
}
