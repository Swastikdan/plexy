/// Wide, short result card for the search page.
///
/// A landscape still on the left and the title/description on the right keeps
/// the row scannable: names read at a glance, and the overview gets enough
/// width to be useful without turning every result into a tall poster tile.
import { Link } from "@tanstack/react-router";
import { Film, MonitorPlay, Star, Tv } from "lucide-react";
import type { ItemCard } from "../client";
import { cx } from "./poster";

/** "S02E03 · Chapter 3" → "Chapter 3"; falls back to the raw name. */
function episodeName(item: ItemCard): string {
  const cleaned = item.name.replace(/^S\d+E\d+\s*[·:\-–—]\s*/i, "").trim();
  return cleaned || item.name;
}

function KindLabel({ kind }: { kind: string }) {
  if (kind === "episode") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-muted">
        <MonitorPlay size={11} aria-hidden />
        Episode
      </span>
    );
  }
  const isSeries = kind === "series";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-muted">
      {isSeries ? <Tv size={11} aria-hidden /> : <Film size={11} aria-hidden />}
      {isSeries ? "Series" : "Film"}
    </span>
  );
}

function MetaDot() {
  return <span className="text-ink-muted/50" aria-hidden>·</span>;
}

export function SearchResultCard({ item }: { item: ItemCard }) {
  const isEpisode = item.kind === "episode";
  const title = isEpisode ? episodeName(item) : item.name;
  const image = isEpisode
    ? item.backdrop ?? item.poster
    : item.backdrop ?? item.poster;
  const stamp =
    isEpisode && item.seasonNumber != null && item.episodeNumber != null
      ? `S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}`
      : null;

  return (
    <Link
      to="/title/$itemId"
      params={{ itemId: item.publicId }}
      className={cx(
        "group flex min-h-[88px] overflow-hidden border border-line/60 bg-surface",
        "transition-colors duration-150 hover:border-line-strong hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
      )}
    >
      <div className="relative aspect-video w-[136px] shrink-0 self-center overflow-hidden bg-surface-2 sm:w-[176px]">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface text-ink-muted">
            {isEpisode ? <MonitorPlay size={22} /> : <Film size={22} />}
          </div>
        )}
        {item.watch && item.watch.percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/60" aria-hidden>
            <div
              className="h-full bg-brand"
              style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 pl-3 pr-3 sm:pl-4 sm:pr-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <KindLabel kind={item.kind} />
          {isEpisode && item.parentTitle && (
            <>
              <MetaDot />
              <span className="truncate text-[11px] font-medium text-ink-muted">
                {item.parentTitle}
              </span>
            </>
          )}
          {stamp && (
            <>
              <MetaDot />
              <span className="shrink-0 font-mono text-[10px] text-ink-muted">{stamp}</span>
            </>
          )}
        </div>

        <h3 className="truncate text-[15px] font-semibold leading-snug text-ink">
          {title}
        </h3>

        {item.overview ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted sm:line-clamp-1">
            {item.overview}
          </p>
        ) : (
          <p className="line-clamp-1 text-xs leading-relaxed text-ink-muted/70">
            {[item.year, item.genres?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") ||
              "No description yet"}
          </p>
        )}

        {(item.year != null || item.rating != null || item.runtime != null) && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
            {item.year != null && <span>{item.year}</span>}
            {item.rating != null && (
              <span className="inline-flex items-center gap-1 text-amber">
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
