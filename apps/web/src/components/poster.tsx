/// Poster / wide episode card.
///
/// One card language for the whole catalogue: a framed still, a quiet title
/// line, progress where it matters, and a menu that only appears when asked.
import { useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Film,
  Info,
  MoreVertical,
  Play,
  Star,
  Tv,
  XCircle,
} from "lucide-react";
import { Dropdown } from "@heroui/react";
import { api, probeBrowserCaps, type ItemCard } from "../client";
import { queries } from "../queries";
import { nativeBridge } from "../lib/native-playback";
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
  parentTitle?: string | null;
}

function stripEpisodePrefix(name: string): string {
  return name.replace(/^S\d+E\d+\s*[·:\-–—]\s*/i, "").trim() || name;
}

export function Poster({
  item,
  className,
  wide = false,
  directPlay = false,
}: {
  item: PosterItem;
  className?: string;
  wide?: boolean;
  directPlay?: boolean;
}) {
  const imgSrc = artworkUrl(wide ? item.backdrop ?? item.poster : item.poster ?? item.backdrop);
  const showTitleBelow = !wide;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canPlayDirect = directPlay && item.fileId != null;
  const [menuOpen, setMenuOpen] = useState(false);

  const updateWatch = (request: Promise<unknown>) => {
    void request.then(() => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["title", item.id] });
    }).catch(() => {});
  };

  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPrefetch = () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      if (canPlayDirect) {
        if (BROWSER_CAPS) {
          void queryClient.prefetchQuery(nativeBridge() ? queries.playNative(item.fileId!) : queries.play(item.fileId!, BROWSER_CAPS));
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

  const episodeTitle = item.kind === "episode" ? stripEpisodePrefix(item.name) : item.name;
  const primaryTitle = item.kind === "episode" ? item.parentTitle ?? episodeTitle : item.name;
  const secondaryTitle = item.kind === "episode" && item.parentTitle ? episodeTitle : null;
  const percent = Math.min(100, Math.max(0, item.watch?.percent ?? 0));

  return (
    <div
      className={cx(
        "group/card min-w-0 shrink-0",
        !wide && "inline-block align-top",
        wide && "flex flex-col",
      )}
    >
      <div
        data-open={menuOpen || undefined}
        data-kind={wide ? "wide" : "poster"}
        className={cx(
          "media-card group relative block h-full overflow-hidden",
          "focus-within:ring-2 focus-within:ring-accent/60 focus-within:ring-offset-2 focus-within:ring-offset-background",
          wide ? "rounded-xl" : "rounded-[calc(var(--radius)*1.35)]",
          menuOpen && "z-30",
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
          aria-label={wide && item.kind === "episode" ? `${primaryTitle}, ${episodeTitle}` : item.name}
        />

        {imgSrc ? (
          <img
            src={imgSrc}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="media-art h-full w-full object-cover pointer-events-none"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface-secondary text-muted pointer-events-none">
            {item.kind === "series" ? <Tv size={24} /> : <Film size={24} />}
          </div>
        )}

        {/* Wide cards carry their own caption on the art. */}
        {wide && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3 sm:p-3.5">
              <p className="truncate text-[12.5px] font-semibold text-white">{primaryTitle}</p>
              {secondaryTitle && (
                <p className="mt-0.5 truncate text-[10px] text-white/55">{secondaryTitle}</p>
              )}
            </div>
          </div>
        )}

        {percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-[3px] bg-black/55" aria-hidden>
            <div
              className="h-full origin-left bg-accent transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${Math.max(2, percent) / 100})` }}
            />
          </div>
        )}

        {wide && (
          <div className="card-overflow absolute right-2 top-2 z-20">
            <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
              <Dropdown.Trigger
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                aria-label={`Options for ${item.name}`}
                className="flex size-7 items-center justify-center rounded-md border border-white/20 bg-black/65 text-white/85 backdrop-blur-md transition-[background-color,color,transform] duration-150 hover:bg-black/90 hover:text-white active:scale-95"
              >
                <MoreVertical size={13} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end" shouldFlip={false}>
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
                  <Dropdown.Item id="details" textValue="View details">
                    <Info size={13} className="shrink-0 text-muted" />
                    <span>View details</span>
                  </Dropdown.Item>
                  <Dropdown.Item id="watched" textValue="Mark as watched">
                    <CheckCircle2 size={13} className="shrink-0 text-success-soft-foreground" />
                    <span>Mark as watched</span>
                  </Dropdown.Item>
                  <Dropdown.Section>
                    <Dropdown.Item
                      id="remove"
                      textValue="Remove from Continue watching"
                      className="text-danger-soft-foreground"
                    >
                      <XCircle size={13} className="shrink-0" />
                      <span>Remove from Continue watching</span>
                    </Dropdown.Item>
                  </Dropdown.Section>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        )}
      </div>

      {showTitleBelow && (
        <div className="pt-2.5">
          <p className="line-clamp-1 text-[12.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground" title={item.name}>
            {item.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
            {item.year && <span>{item.year}</span>}
            {item.year && item.rating != null && <span aria-hidden className="h-0.5 w-0.5 rounded-full bg-muted/50" />}
            {item.rating != null && (
              <span className="inline-flex items-center gap-0.5 tabular-nums">
                <Star size={8} fill="currentColor" className="text-[#e0b258]" aria-hidden />
                {item.rating.toFixed(1)}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
