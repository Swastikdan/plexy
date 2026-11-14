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
      <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-secondary/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <MonitorPlay size={11} aria-hidden />
        Episode
      </span>
    );
  }
  const isSeries = kind === "series";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-secondary/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
      {isSeries ? <Tv size={11} aria-hidden /> : <Film size={11} aria-hidden />}
      {isSeries ? "Series" : "Film"}
    </span>
  );
}

function MetaDot() {
  return <span className="text-muted/50" aria-hidden>·</span>;
}

export function SearchResultCard({ item }: { item: ItemCard }) {
  const isEpisode = item.kind === "episode";
  const title = isEpisode ? episodeName(item) : item.name;
  const rawImage = isEpisode
    ? item.backdrop ?? item.poster
    : item.backdrop ?? item.poster;
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
        "group flex min-h-[96px] items-center gap-3 sm:gap-4 rounded-2xl border border-border/70 bg-surface p-2 sm:p-2.5",
        "shadow-2xs transition-all duration-200 hover:border-border hover:bg-surface-secondary/80 hover:shadow-sm active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      )}
    >
      <div className="relative aspect-video w-[124px] sm:w-[160px] md:w-[180px] shrink-0 self-stretch overflow-hidden rounded-xl bg-surface-secondary border border-border/40">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-secondary to-surface text-muted">
            {isEpisode ? <MonitorPlay size={22} /> : <Film size={22} />}
          </div>
        )}
        {item.watch && item.watch.percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden" aria-hidden>
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
              <span className="truncate text-[11px] font-medium text-muted">
                {item.parentTitle}
              </span>
            </>
          )}
          {stamp && (
            <>
              <MetaDot />
              <span className="shrink-0 font-mono text-[10px] text-muted">{stamp}</span>
            </>
          )}
        </div>

        <h3 className="truncate text-sm sm:text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-foreground">
          {title}
        </h3>

        {item.overview ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted sm:line-clamp-1">
            {item.overview}
          </p>
        ) : (
          <p className="line-clamp-1 text-xs leading-relaxed text-muted/70">
            {[item.year, item.genres?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") ||
              "No description yet"}
          </p>
        )}

        {(item.year != null || item.rating != null || item.runtime != null) && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            {item.year != null && <span>{item.year}</span>}
            {item.rating != null && (
              <span className="inline-flex items-center gap-1 text-warning font-medium">
                <Star size={10} fill="currentColor" aria-hidden />
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
