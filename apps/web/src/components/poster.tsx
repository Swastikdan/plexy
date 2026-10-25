/// Poster card with smooth zoom and hover overlay.
///
/// Optional `showKind` pins a small type chip (movie / series / episode) at the
/// top of the artwork, and hovering any poster quietly prefetches its detail
/// page so opening a title is instant.
import { useRef, useEffect } from "react";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Film, MonitorPlay, Tv, MoreVertical, Play, Info, CheckCircle2, XCircle, Star } from "lucide-react";
import { api, probeBrowserCaps, type ItemCard } from "../client";
import { queries } from "../queries";
import { Menu } from "./ui/menu";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

export interface PosterItem {
  id: number;
  publicId?: string;
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
  const navigate = useNavigate();
  const canPlayDirect = directPlay && item.fileId != null;

  const clearWatchMutation = useMutation({
    mutationFn: (targetId: number) => api.clearWatch(targetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["title", item.id] });
    },
  });

  const watchMutation = useMutation({
    mutationFn: ({ itemId, played }: { itemId: number; played: boolean }) =>
      api.setWatched(itemId, played),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["title", item.id] });
    },
  });

  // Quiet prefetch with hover dwell delay (100ms) so rapid scrolling doesn't flood the network
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPrefetch = () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      if (canPlayDirect) {
        if (BROWSER_CAPS) {
          void queryClient.prefetchQuery(queries.play(item.fileId!, BROWSER_CAPS));
        }
        return;
      }
      void queryClient.prefetchQuery(queries.title(item.publicId ?? item.id));
    }, 100);
  };

  const cancelPrefetch = () => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  const destination = canPlayDirect
    ? ({ to: "/watch/$fileId", params: { fileId: String(item.fileId) } } as const)
    : ({ to: "/title/$itemId", params: { itemId: item.publicId ?? String(item.id) } } as const);

  return (
    <div
      className={cx(
        "group relative block overflow-hidden rounded-[var(--radius-poster)]",
        "bg-surface border border-line/60",
        "transition-[transform,border-color] duration-300 ease-out hover:z-20 hover:scale-[1.04] hover:border-line",
        "focus-within:ring-2 focus-within:ring-brand/40",
        className,
      )}
    >
      <Link
        {...destination}
        onPointerEnter={startPrefetch}
        onPointerLeave={cancelPrefetch}
        onFocus={startPrefetch}
        onBlur={cancelPrefetch}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 z-0 outline-none"
        aria-label={item.name}
      />

      {showKind && <KindChip kind={item.kind} />}
      {item.rating != null && !wide && (
        <span
          className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber"
          aria-label={`Rated ${item.rating.toFixed(1)} out of 10`}
        >
          <Star size={10} fill="currentColor" />
          {item.rating.toFixed(1)}
        </span>
      )}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 ease-out pointer-events-none"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-end p-4 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none">
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
          className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden pointer-events-none z-10"
          aria-hidden
        >
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
          />
        </div>
      )}

      {/* More Options Menu for Continue Watching cards */}
      {wide && (
        <div className="absolute right-2 top-2 z-20 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <Menu.Root>
            <Menu.Trigger
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-label={`Options for ${item.name}`}
              title="More options"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/75 backdrop-blur-md text-white/90 border border-white/20 hover:bg-black/95 hover:text-white hover:scale-105 active:scale-95 transition-all shadow-lg"
            >
              <MoreVertical size={13} />
            </Menu.Trigger>
            <Menu.Positioner align="end" side="bottom" sideOffset={6}>
              {canPlayDirect && (
                <Menu.Item
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigate({ to: "/watch/$fileId", params: { fileId: String(item.fileId) } });
                  }}
                >
                  <Play size={13} className="shrink-0 text-brand-text" />
                  <span>Resume playback</span>
                </Menu.Item>
              )}
              <Menu.Item
                onClick={(e) => {
                  e.stopPropagation();
                  void navigate({ to: "/title/$itemId", params: { itemId: item.publicId ?? String(item.id) } });
                }}
              >
                <Info size={13} className="shrink-0 text-ink-muted" />
                <span>View Details</span>
              </Menu.Item>
              <Menu.Item
                onClick={(e) => {
                  e.stopPropagation();
                  watchMutation.mutate({ itemId: item.id, played: true });
                }}
              >
                <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                <span>Mark as Watched</span>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                onClick={(e) => {
                  e.stopPropagation();
                  clearWatchMutation.mutate(item.id);
                }}
                className="text-red-400 data-[highlighted]:bg-red-500/15 data-[highlighted]:text-red-300"
              >
                <XCircle size={13} className="shrink-0" />
                <span>Remove from Continue Watching</span>
              </Menu.Item>
            </Menu.Positioner>
          </Menu.Root>
        </div>
      )}
    </div>
  );
}
