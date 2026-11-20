/// Library hero — the reference's featured card above the shelves. A compact
/// manual carousel with the title mark, genres, facts, Play/Details and dots.
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import { artworkUrl } from "../lib/artwork-url";
import { cx } from "../lib/cx";
import { useItemFlags } from "../lib/use-item-flags";
import type { ItemCard } from "../client";

function playback(item: ItemCard) {
  const watch = item.playWatch ?? item.watch;
  const resuming = (watch?.percent ?? 0) > 0 && !watch?.played;
  const fileId = item.playFileId ?? item.fileId ?? null;
  return { resuming, fileId, canPlay: fileId != null };
}

function HeroSlide({ item }: { item: ItemCard }) {
  const navigate = useNavigate();
  const { resuming, fileId, canPlay } = playback(item);
  const backdrop = artworkUrl(item.backdrop ?? item.poster);
  const logo = artworkUrl(item.logo);
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

  return (
    <article className="relative h-full w-full shrink-0 overflow-hidden">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[center_26%]"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--brand)_28%,transparent),transparent_66%)]" />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/26 to-black/16" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/74 via-black/30 to-transparent" />

      <Link
        to="/title/$itemId"
        params={{ itemId: item.publicId }}
        aria-label={`View ${item.name}`}
        className="absolute inset-0 z-[2] rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      />

      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-end px-5 pb-7 pt-20 sm:pl-14 sm:pr-8 sm:pb-9">
        <div className="hero-copy min-w-0 max-w-[42rem]">
          {item.genres.length > 0 && (
            <div className="mb-3.5 flex flex-wrap gap-2" aria-label="Genres">
              {item.genres.slice(0, 3).map((genre) => (
                <span key={genre} className="hero-chip">
                  {genre}
                </span>
              ))}
            </div>
          )}

          {logo ? (
            <>
              <h2 className="sr-only">{item.name}</h2>
              <img
                src={logo}
                alt=""
                className="mb-4 max-h-[3.6rem] max-w-[13rem] object-contain object-left drop-shadow-[0_4px_30px_rgba(0,0,0,0.55)] sm:max-h-[5rem] sm:max-w-[19rem] lg:max-h-[6rem] lg:max-w-[23rem]"
              />
            </>
          ) : (
            <h2 className="hero-title mb-3.5 max-w-[16ch] text-[2.2rem] text-white sm:text-[3.2rem] lg:text-[4rem]">
              {item.name}
            </h2>
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
            <span className="meta-dot" aria-hidden />
            <span>{item.kind === "series" ? "Series" : "Film"}</span>
          </div>

          <div className="pointer-events-auto mt-5 flex flex-wrap items-center gap-2.5">
            {canPlay && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  play();
                }}
                className="hero-primary"
              >
                <Play size={15} fill="currentColor" aria-hidden />
                {resuming ? "Continue watching" : "Play"}
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void navigate({ to: "/title/$itemId", params: { itemId: item.publicId } });
              }}
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
              data-selected={inWatchlist || undefined}
              className="hero-icon !hidden sm:!inline-flex"
            >
              <Bookmark size={16} fill={inWatchlist ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function LibraryHero({ items }: { items: ItemCard[] }) {
  const [active, setActive] = useState(0);
  if (!items.length) return null;
  const count = items.length;
  const index = Math.min(active, count - 1);
  const step = (direction: -1 | 1) =>
    setActive((current) => (current + direction + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured titles"
      className="relative h-[clamp(25rem,52vh,35rem)] overflow-hidden rounded-[calc(var(--radius)*2.2)] border border-[var(--cinema-line)] bg-[var(--cinema-canvas)]"
    >
      <div className="relative h-full">
        {items.map((item, slide) => (
          <div
            key={item.publicId}
            aria-hidden={slide !== index}
            className={cx(
              "absolute inset-0 transition-opacity duration-500 ease-out",
              slide === index ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <HeroSlide item={item} />
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => step(-1)}
            className="absolute left-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 backdrop-blur-md transition hover:bg-black/55 hover:text-white active:scale-95 sm:flex"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => step(1)}
            className="absolute right-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 backdrop-blur-md transition hover:bg-black/55 hover:text-white active:scale-95 sm:flex"
          >
            <ChevronRight size={17} />
          </button>
          <div className="absolute bottom-4 left-5 z-20 flex items-center gap-1.5 sm:left-8">
            {items.map((item, slide) => (
              <button
                key={item.publicId}
                type="button"
                aria-label={`Show ${item.name}`}
                aria-current={slide === index ? "true" : undefined}
                onClick={() => setActive(slide)}
                className={cx(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  slide === index ? "w-6 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
