/// Home featured carousel.
///
/// A full-bleed banner carries each slide: the TMDB title mark (or the title
/// itself when no logo exists), the facts, the synopsis, and the three icon
/// actions a viewer reaches for. The artwork is part of the page rather than a
/// card floating on it, the whole slide opens the title page, and the dots and
/// arrows stay secondary. Slides advance on their own, pause whenever the
/// pointer or keyboard is on the carousel, and can be stopped.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, ChevronLeft, ChevronRight, Pause, Play, Star } from "lucide-react";
import { artworkUrl } from "../lib/artwork-url";
import { cx } from "../lib/cx";
import { useItemFlags } from "../lib/use-item-flags";
import type { ItemCard } from "../client";

const ADVANCE_MS = 7000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function slidePlayback(item: ItemCard) {
  const watch = item.playWatch ?? item.watch;
  const resuming = (watch?.percent ?? 0) > 0 && !watch?.played;
  const fileId = item.playFileId ?? item.fileId ?? null;
  return { resuming, fileId, canPlay: fileId != null };
}

function HeroSlide({ item }: { item: ItemCard }) {
  const navigate = useNavigate();
  const backdrop = artworkUrl(item.backdrop ?? item.poster);
  const logo = artworkUrl(item.logo);
  const { resuming, fileId, canPlay } = slidePlayback(item);
  const { flags, toggleWatchlist } = useItemFlags(item);
  const inWatchlist = flags.watchlist;

  const play = () => {
    if (!canPlay) {
      void navigate({ to: "/title/$itemId", params: { itemId: item.publicId } });
      return;
    }
    void navigate({
      to: "/watch/$fileId",
      params: { fileId: String(fileId) },
      state: { playerFromTitle: true },
    });
  };

  const playLabel = !canPlay
    ? "Details"
    : resuming
      ? "Continue watching"
      : "Play";

  return (
    <article className="relative h-full w-full shrink-0 overflow-hidden">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="hero-media absolute inset-0 h-full w-full object-cover object-[center_26%]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_30%,transparent),transparent_64%)]"
        />
      )}

      <div aria-hidden className="hero-scrim" />

      {/* The banner is the link. Text and artwork stay quiet; the three
          controls sit above it and keep their own click targets. */}
      <Link
        to="/title/$itemId"
        params={{ itemId: item.publicId }}
        aria-label={`View ${item.name}`}
        className="absolute inset-0 z-[2] rounded-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      />

      <div className="pointer-events-none relative z-10 mx-auto flex h-full max-w-[var(--app-max)] flex-col justify-end px-[var(--app-gutter)] pb-20 pt-20 sm:pb-24 lg:pb-24">
        <div className="hero-copy min-w-0 max-w-[44rem]">
          {item.genres.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Genres">
              {item.genres.slice(0, 3).map((genre) => (
                <span key={genre} className="hero-chip">
                  {genre}
                </span>
              ))}
            </div>
          )}
          {logo ? (
            <>
              <h1 className="sr-only">{item.name}</h1>
              <img
                src={logo}
                alt=""
                className="mb-5 max-h-[4.5rem] max-w-[15rem] object-contain object-left drop-shadow-[0_4px_30px_rgba(0,0,0,0.55)] sm:max-h-[6.5rem] sm:max-w-[23rem] lg:max-h-[7.5rem] lg:max-w-[28rem]"
              />
            </>
          ) : (
            <h1 className="hero-title mb-4 max-w-[16ch] font-sans text-[2.4rem] text-white sm:text-5xl lg:text-[3.8rem]">
              {item.name}
            </h1>
          )}

          <div className="hero-meta">
            {item.playSubtitle && (
              <span className="font-semibold text-white/92">{item.playSubtitle}</span>
            )}
            {item.playSubtitle && item.year && <span className="meta-dot" aria-hidden />}
            {item.year && <span>{item.year}</span>}
            {item.rating != null && (
              <>
                <span className="meta-dot" aria-hidden />
                <span className="inline-flex items-center gap-1">
                  <Star size={11} fill="currentColor" className="text-[#f0c56a]" aria-hidden />
                  <strong>{item.rating.toFixed(1)}</strong>
                </span>
              </>
            )}
            {item.runtime != null && item.runtime > 0 && (
              <>
                <span className="meta-dot" aria-hidden />
                <span>{item.runtime} min</span>
              </>
            )}
            <span className="meta-dot" aria-hidden />
            <span>{item.kind === "series" ? "Series" : "Film"}</span>
          </div>

          <div className="pointer-events-auto mt-6 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                play();
              }}
              aria-label={canPlay ? `${playLabel} ${item.name}` : `Details for ${item.name}`}
              title={canPlay ? playLabel : "Details"}
              className="hero-primary"
            >
              <Play size={15} fill="currentColor" aria-hidden />
              {playLabel}
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void navigate({ to: "/title/$itemId", params: { itemId: item.publicId } });
              }}
              aria-label={`Details for ${item.name}`}
              title="Details"
              className="hero-secondary"
            >
              Details
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleWatchlist();
              }}
              aria-label={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
              title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
              data-selected={inWatchlist || undefined}
              className="hero-icon"
            >
              <Bookmark size={16} fill={inWatchlist ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function HomeHero({ items }: { items: ItemCard[] }) {
  const count = items.length;
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    if (active >= count) setActive(0);
  }, [active, count]);

  const paused = hovered || focused || userPaused || reducedMotion;

  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setActive((index) => (index + 1) % count);
    }, ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [active, count, paused]);

  if (!count) return null;

  const step = (direction: -1 | 1) =>
    setActive((index) => (index + direction + count) % count);

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      data-paused={paused || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(false);
      }}
      className="hero-shell hero-shell--bleed hero-carousel relative !-mt-[3.25rem] h-[clamp(30rem,68vh,52rem)] select-none md:!-mt-[var(--app-topbar-height)]"
    >
      <div className="relative h-full" aria-live={paused ? "polite" : "off"}>
        {items.map((item, index) => (
          <div
            key={item.publicId}
            className={cx(
              "absolute inset-0 h-full w-full transition-opacity duration-700 ease-out",
              index === active ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={index !== active}
            inert={index !== active}
          >
            <HeroSlide item={item} />
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous featured title"
            className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white/80 backdrop-blur-md transition-[background-color,color,transform] duration-200 hover:bg-black/55 hover:text-white active:scale-95 sm:flex"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next featured title"
            className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white/80 backdrop-blur-md transition-[background-color,color,transform] duration-200 hover:bg-black/55 hover:text-white active:scale-95 sm:flex"
          >
            <ChevronRight size={20} />
          </button>

          <div className="absolute inset-x-[var(--app-gutter)] bottom-7 z-20 flex items-center gap-1.5 sm:bottom-8">
            {!reducedMotion && (
              <button
                type="button"
                onClick={() => setUserPaused((value) => !value)}
                aria-label={userPaused ? "Start featured carousel" : "Pause featured carousel"}
                title={userPaused ? "Play" : "Pause"}
                className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/75 backdrop-blur-md transition-[background-color,color,transform] duration-150 hover:bg-black/55 hover:text-white active:scale-95"
              >
                {userPaused ? <Play size={11} fill="currentColor" aria-hidden /> : <Pause size={11} fill="currentColor" aria-hidden />}
              </button>
            )}
            {items.map((item, index) => (
              <button
                key={item.publicId}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show ${item.name}, slide ${index + 1} of ${count}`}
                aria-current={index === active ? "true" : undefined}
                className="group/dot flex h-6 items-center justify-center px-1"
              >
                <span
                  className={cx(
                    "block h-1.5 rounded-full transition-[width,background-color] duration-300",
                    index === active ? "w-7 bg-white" : "w-2.5 bg-white/35 group-hover/dot:bg-white/65",
                  )}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
