import { Link } from "@tanstack/react-router";
import { Film, MonitorPlay, Star, Tv } from "lucide-react";
import type { ItemCard } from "../client";
import { cx } from "../lib/cx";
import { artworkUrl } from "../lib/artwork-url";

/** "S02E03 · Chapter 3" → "Chapter 3"; falls back to the raw name. */
function episodeName(item: ItemCard): string {
  const cleaned = item.name.replace(/^S\d+E\d+\s*[·:\-–—]\s*/i, "").trim();
  return cleaned || item.name;
}

function KindLabel({ kind }: { kind: string }) {
  if (kind === "episode") {
    return (
      <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted/80">
        <MonitorPlay size={9} aria-hidden />
        Episode
      </span>
    );
  }
  const isSeries = kind === "series";
  return (
    <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted/80">
      {isSeries ? <Tv size={9} aria-hidden /> : <Film size={9} aria-hidden />}
      {isSeries ? "Series" : "Film"}
    </span>
  );
}

function MetaDot() {
  return <span className="text-muted/30" aria-hidden>·</span>;
}

export function SearchResultCard({ item }: { item: ItemCard }) {
  const isEpisode = item.kind === "episode";
  const title = isEpisode ? episodeName(item) : item.name;
  const rawImage = item.backdrop ?? item.poster;
  const image = artworkUrl(rawImage);
  const stamp =
    isEpisode && item.seasonNumber != null && item.episodeNumber != null
      ? `S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}`
      : null;

  return (
    <Link
      to="/title/$itemId"
      params={{ itemId: item.publicId }}
      className={cx(
        "media-card group flex min-h-[5.5rem] items-center gap-3 overflow-hidden rounded-xl p-1.5 sm:gap-4 sm:p-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      )}
    >
      <div className="relative aspect-video w-[6.6rem] shrink-0 self-stretch overflow-hidden rounded-lg border border-border/40 bg-surface-secondary sm:w-[8.5rem]">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="media-art h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-secondary to-surface text-muted">
            {isEpisode ? <MonitorPlay size={20} /> : <Film size={20} />}
          </div>
        )}
        {item.watch && item.watch.percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/55" aria-hidden>
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1 pr-2 sm:pr-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <KindLabel kind={item.kind} />
          {isEpisode && item.parentTitle && (
            <>
              <MetaDot />
              <span className="truncate text-[9.5px] font-medium text-muted">
                {item.parentTitle}
              </span>
            </>
          )}
          {stamp && (
            <>
              <MetaDot />
              <span className="shrink-0 font-mono text-[9px] text-muted/70">{stamp}</span>
            </>
          )}
        </div>

        <h3 className="truncate text-[13px] font-semibold leading-snug tracking-[-0.01em] text-foreground sm:text-sm">
          {title}
        </h3>

        {item.overview ? (
          <p className="line-clamp-1 text-[10.5px] leading-relaxed text-muted sm:text-[11px]">
            {item.overview}
          </p>
        ) : (
          <p className="line-clamp-1 text-[10.5px] leading-relaxed text-muted/70">
            {[item.year, item.genres?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "No description yet"}
          </p>
        )}

        {(item.year != null || item.rating != null || item.runtime != null) && (
          <div className="mt-0.5 flex items-center gap-2 text-[9.5px] text-muted/80">
            {item.year != null && <span>{item.year}</span>}
            {item.rating != null && (
              <span className="inline-flex items-center gap-0.5 font-medium text-[#e0b258]">
                <Star size={8} fill="currentColor" aria-hidden />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.runtime != null && <span>{item.runtime} min</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
