/// Poster card — Netflix-style card with smooth zoom, fallback typography, and watch progress.
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { type ItemCard } from "../client";
import { Link } from "@tanstack/react-router";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

export interface PosterItem {
  id: number;
  name: string;
  poster?: string | null;
  backdrop?: string | null;
  kind?: string;
  year?: number | null;
  rating?: number | null;
  watch?: ItemCard["watch"] | null;
}

export function Poster({
  item,
  className,
  wide = false,
}: {
  item: PosterItem;
  className?: string;
  wide?: boolean;
}) {
  const imgSrc = wide ? item.backdrop ?? item.poster : item.poster ?? item.backdrop;

  return (
    <Link
      to="/title/$itemId"
      params={{ itemId: String(item.id) }}
      className={cx(
        "group relative block overflow-hidden rounded-[var(--radius-poster)]",
        "bg-[#181818] border border-white/5",
        "transition-all duration-300 ease-out hover:z-20 hover:scale-[1.04] hover:shadow-2xl hover:shadow-black/80 hover:border-white/20",
        className,
      )}
    >
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
          <span className="font-display text-sm font-semibold text-white line-clamp-2">
            {item.name}
          </span>
          {item.year && (
            <span className="text-xs text-ink-muted mt-1">{item.year}</span>
          )}
        </div>
      )}

      {/* Subtle hover gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden
      >
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="truncate text-xs font-semibold text-white drop-shadow-md">
            {item.name}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
            {item.year && <span>{item.year}</span>}
            {item.rating && (
              <span className="text-amber-400">★ {item.rating.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Netflix-style red progress bar for continuing watch */}
      {item.watch && item.watch.percent > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden"
          aria-hidden
        >
          <div
            className="h-full bg-[#E50914] transition-all"
            style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
          />
        </div>
      )}
    </Link>
  );
}
