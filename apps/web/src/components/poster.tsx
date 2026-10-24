/// Poster card with smooth zoom and hover overlay.
///
/// Optional `showKind` pins a small type chip (movie / series / episode) at the
/// top of the artwork, and hovering any poster quietly prefetches its detail
/// page so opening a title is instant.
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Film, MonitorPlay, Tv } from "lucide-react";
import { probeBrowserCaps, type ItemCard } from "../client";
import { queries } from "../queries";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

export interface PosterItem {
  id: number;
  name: string;
  poster?: string | null;
  backdrop?: string | null;
  kind?: string;
  year?: number | null;
  rating?: number | null;
  fileId?: number | null;
  watch?: ItemCard["watch"] | null;
}

function KindChip({ kind }: { kind?: string }) {
  if (kind === "episode") {
    return (
      <span
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
        aria-hidden
      >
        <MonitorPlay size={10} />
        Episode
      </span>
    );
  }
  const isSeries = kind === "series";
  return (
    <span
      className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
      aria-hidden
    >
      {isSeries ? <Tv size={10} /> : <Film size={10} />}
      {isSeries ? "Series" : "Film"}
    </span>
  );
}

export function Poster({
  item,
  className,
  wide = false,
  showKind = false,
  directPlay = false,
}: {
  item: PosterItem;
  className?: string;
  wide?: boolean;
  showKind?: boolean;
  directPlay?: boolean;
}) {
  const imgSrc = wide ? item.backdrop ?? item.poster : item.poster ?? item.backdrop;
  const queryClient = useQueryClient();
  const canPlayDirect = directPlay && item.fileId != null;

  // Quiet prefetch: the first hover warms the destination so navigation has
  // nothing left to wait for. Direct-play cards warm the player manifest.
  const prefetch = () => {
    if (canPlayDirect) {
      if (BROWSER_CAPS) {
        void queryClient.prefetchQuery(queries.play(item.fileId!, BROWSER_CAPS));
      }
      return;
    }
    void queryClient.prefetchQuery(queries.title(item.id));
  };

  const destination = canPlayDirect
    ? ({ to: "/watch/$fileId", params: { fileId: String(item.fileId) } } as const)
    : ({ to: "/title/$itemId", params: { itemId: String(item.id) } } as const);

  return (
    <Link
      {...destination}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        "group relative block overflow-hidden rounded-[var(--radius-poster)]",
        "bg-surface border border-line/60",
        "transition-[transform,border-color] duration-300 ease-out hover:z-20 hover:scale-[1.04] hover:border-line",
        "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2",
        className,
      )}
    >
      {showKind && <KindChip kind={item.kind} />}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 ease-out"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-end p-4 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
          <span className="font-display text-sm font-semibold text-ink line-clamp-2">
            {item.name}
          </span>
          {item.year && (
            <span className="text-xs text-ink-muted mt-1">{item.year}</span>
          )}
        </div>
      )}

      {/* Hover overlay with title and rating; always visible on wide cards */}
      <div
        className={cx(
          "pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-300",
          wide ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-hidden
      >
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="truncate text-xs font-semibold text-white">
            {item.name}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
            {item.year && <span>{item.year}</span>}
            {item.rating && (
              <span className="text-amber">★ {item.rating.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Watch progress for continuing titles */}
      {item.watch && item.watch.percent > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden"
          aria-hidden
        >
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
          />
        </div>
      )}
    </Link>
  );
}
