/// Home featured carousel.
///
/// A full-bleed hero image carries each slide: the TMDB title mark (or the
/// title itself when no logo exists), the facts, the synopsis, and the two
/// actions a viewer reaches for. Slides advance on their own, pause whenever
/// the pointer or keyboard is on the carousel, and can be stopped. The frame
/// height is fixed, so changing slides never moves the shelves below.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, ChevronLeft, ChevronRight, Info, Pause, Play, Star } from "lucide-react";
import { artworkUrl } from "../lib/artwork-url";
import { cx } from "../lib/cx";
import { useStoredFlag } from "../lib/use-stored-flag";
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
  const [inWatchlist, toggleWatchlist] = useStoredFlag(`plexy:watchlist:${item.id}`);

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

  const actionLabel = !canPlay
    ? "View title"
    : resuming
      ? item.playSubtitle
        ? `Resume ${item.playSubtitle}`
        : "Resume"
      : item.playSubtitle
        ? `Play ${item.playSubtitle}`
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

      <div className="relative z-10 mx-auto flex h-full max-w-[var(--app-max)] flex-col justify-end px-5 pb-20 pt-20 sm:px-8 sm:pb-24 lg:px-12 lg:pb-28">
        <div className="hero-copy min-w-0 max-w-[44rem]">
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
            {item.genres.length > 0 && (
              <>
                <span className="meta-dot" aria-hidden />
                <span className="text-white/60">{item.genres.slice(0, 3).join(" · ")}</span>
              </>
            )}
            <span className="meta-dot" aria-hidden />
            <span>{item.kind === "series" ? "Series" : "Film"}</span>
          </div>

          {item.overview && (
            <p className="mt-3 max-w-[38rem] text-[12.5px] leading-relaxed text-white/75 line-clamp-2 sm:mt-4 sm:text-sm sm:line-clamp-3">
              {item.overview}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={play} className="hero-primary">
              {canPlay ? <Play size={15} fill="currentColor" aria-hidden /> : <Info size={15} aria-hidden />}
              {actionLabel}
            </button>

            <button
              type="button"
              onClick={toggleWatchlist}
              aria-label={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
              title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
              data-selected={inWatchlist || undefined}
              className="hero-icon"
            >
              <Bookmark size={16} fill={inWatchlist ? "currentColor" : "none"} />
            </button>

            <Link to="/title/$itemId" params={{ itemId: item.publicId }} className="hero-secondary">
              <Info size={15} aria-hidden />
              Details
            </Link>
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
      className="hero-shell hero-carousel relative h-[clamp(28rem,60vh,42rem)] select-none"
    >
      <h1 className="sr-only">{items[active]?.name ?? "Featured titles"}</h1>

      <div
        className="flex h-full transition-transform duration-700 ease-out"
        style={{ transform: `translateX(-${active * 100}%)` }}
        aria-live={paused ? "polite" : "off"}
      >
        {items.map((item, index) => (
          <div
            key={item.publicId}
            className="relative h-full w-full shrink-0"
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

          <div className="absolute inset-x-5 bottom-4 z-20 flex items-center gap-1.5 sm:inset-x-8 sm:bottom-5">
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
