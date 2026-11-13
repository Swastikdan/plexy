/// Poster card with a title label and an optional wide-card hover overlay.
///
/// Optional `showKind` pins a small type chip (movie / series / episode) at the
/// top of the artwork, and hovering any poster quietly prefetches its detail
/// page so opening a title is instant.
import { useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Film, MonitorPlay, Tv, MoreVertical, Play, Info, CheckCircle2, XCircle, Star } from "lucide-react";
import { Dropdown } from "@heroui/react";
import { api, probeBrowserCaps, type ItemCard } from "../client";
import { queries } from "../queries";
import { artworkUrl } from "../lib/artwork-url";
import { cx } from "../lib/cx";

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
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/80"
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
      className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/80"
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
  const imgSrc = artworkUrl(wide ? item.backdrop ?? item.poster : item.poster ?? item.backdrop);
  const showTitleBelow = !wide || item.kind === "series";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canPlayDirect = directPlay && item.fileId != null;

  // While the options menu is open we keep the card in its zoomed state, so
  // the portaled menu's anchor rect never moves — otherwise leaving the card
  // with the mouse would shrink the card under the open menu and drag the
  // menu along with it (bad layout shift).
  const [menuOpen, setMenuOpen] = useState(false);

  const updateWatch = (request: Promise<unknown>) => {
    void request.then(() => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["title", item.id] });
    }).catch(() => {});
  };

  // Quiet prefetch with hover dwell delay (100ms) so rapid scrolling doesn't flood the network
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPrefetch = () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      if (canPlayDirect) {
        if (BROWSER_CAPS) {
          void queryClient.prefetchQuery(queries.play(item.fileId!, BROWSER_CAPS));
        }
      } else {
        void queryClient.prefetchQuery(queries.title(item.publicId ?? item.id));
      }
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
        "min-w-0 overflow-hidden rounded-lg",
        !wide && "inline-block align-top",
        wide && "flex flex-col",
        className,
      )}
    >
      <div
        className={cx(
          "group relative block h-full overflow-hidden rounded-lg",
          "bg-surface border border-border/40",
          "transition-[transform,border-color] duration-200 ease-out hover:z-20 hover:scale-[1.03] hover:border-separator",
          "focus-within:ring-2 focus-within:ring-white/20",
          // Freeze the zoom while the menu is open (covers hover-out), and stay
          // above neighboring cards even when the pointer isn't on us.
          menuOpen && "z-30 scale-[1.03] border-separator",
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
          className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
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
        <div className="flex h-full w-full items-center justify-center bg-surface-secondary text-muted pointer-events-none">
          {item.kind === "series" ? <Tv size={24} /> : <Film size={24} />}
        </div>
      )}

      {/* Landscape cards retain the title treatment; poster cards identify
          themselves below the artwork instead of covering it with a Details icon. */}
      {wide && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <p className="truncate text-xs font-semibold text-white">{item.name}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-white/70">
              {item.year && <span>{item.year}</span>}
              {item.rating != null && <span className="text-warning">★ {item.rating.toFixed(1)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Watch progress for continuing titles */}
      {item.watch && item.watch.percent > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden pointer-events-none z-10"
          aria-hidden
        >
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(2, item.watch.percent))}%` }}
          />
        </div>
      )}

      {/* More Options Menu for Continue Watching cards */}
      {wide && (
        <div
          className={cx(
            "absolute right-2 top-2 z-20 transition-opacity",
            menuOpen
              ? "opacity-100"
              : "opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
            <Dropdown.Trigger
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-label={`Options for ${item.name}`}
              className="flex size-7 items-center justify-center rounded-md border border-white/20 bg-black/75 text-white/90 shadow-lg backdrop-blur-md transition-all hover:scale-105 hover:bg-black/95 hover:text-white active:scale-95"
            >
              <MoreVertical size={13} />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "resume" && item.fileId != null) {
                    void navigate({ to: "/watch/$fileId", params: { fileId: String(item.fileId) } });
                  } else if (key === "details") {
                    void navigate({ to: "/title/$itemId", params: { itemId: item.publicId ?? String(item.id) } });
                  } else if (key === "watched") {
                    updateWatch(api.setWatched(item.id, true));
                  } else if (key === "remove") {
                    updateWatch(api.clearWatch(item.id));
                  }
                }}
              >
                {canPlayDirect && (
                  <Dropdown.Item id="resume" textValue="Resume playback">
                    <Play size={13} className="shrink-0 text-muted" />
                    <span>Resume playback</span>
                  </Dropdown.Item>
                )}
                <Dropdown.Item id="details" textValue="View Details">
                  <Info size={13} className="shrink-0 text-muted" />
                  <span>View Details</span>
                </Dropdown.Item>
                <Dropdown.Item id="watched" textValue="Mark as Watched">
                  <CheckCircle2 size={13} className="shrink-0 text-success-soft-foreground" />
                  <span>Mark as Watched</span>
                </Dropdown.Item>
                <Dropdown.Section>
                  <Dropdown.Item
                    id="remove"
                    textValue="Remove from Continue Watching"
                    className="text-danger-soft-foreground"
                  >
                    <XCircle size={13} className="shrink-0" />
                    <span>Remove from Continue Watching</span>
                  </Dropdown.Item>
                </Dropdown.Section>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      )}
      </div>
      {showTitleBelow && (
        <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-foreground" title={item.name}>
          {item.name}
        </p>
      )}
    </div>
  );
}
