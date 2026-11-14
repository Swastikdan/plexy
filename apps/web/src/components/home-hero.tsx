/// Home billboard. The best-rated title gets one cinematic, full-width card
/// so the desktop home has a clear focal point instead of starting with a row.
import { Link, useNavigate } from "@tanstack/react-router";
import { Clock3, Info, Play, Sparkles, Star } from "lucide-react";
import { artworkUrl } from "../lib/artwork-url";
import type { ItemCard } from "../client";

export function HomeHero({ item }: { item: ItemCard }) {
  const navigate = useNavigate();
  const backdrop = artworkUrl(item.backdrop ?? item.poster);
  const percent = Math.min(100, Math.max(0, item.watch?.percent ?? 0));
  const resuming = percent > 0 && !item.watch?.played;
  const canPlay = item.fileId != null;

  const play = () => {
    if (!canPlay) {
      void navigate({ to: "/title/$itemId", params: { itemId: item.publicId } });
      return;
    }
    void navigate({
      to: "/watch/$fileId",
      params: { fileId: String(item.fileId) },
      state: { playerFromTitle: true },
    });
  };

  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-border/70 bg-surface shadow-sm">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="hero-media absolute inset-0 h-full w-full object-cover object-[center_28%]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_65%)]"
        />
      )}

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/5"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/10 to-transparent"
      />

      <div className="relative z-10 flex min-h-[380px] flex-col justify-end gap-3.5 p-5 sm:min-h-[460px] sm:p-8 lg:min-h-[520px] lg:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/85 backdrop-blur-md">
          <Sparkles size={11} />
          Featured
        </span>

        {item.logo ? (
          <img
            src={item.logo}
            alt={item.name}
            className="max-h-14 max-w-[260px] object-contain object-left drop-shadow-[0_2px_14px_rgba(0,0,0,0.55)] sm:max-h-20 sm:max-w-[340px]"
          />
        ) : (
          <h1 className="max-w-2xl font-sans text-3xl font-black tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.55)] sm:text-4xl lg:text-5xl">
            {item.name}
          </h1>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-medium text-white/80">
          {item.year && <span>{item.year}</span>}
          {item.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star size={11} fill="currentColor" className="text-warning" />
              {item.rating.toFixed(1)}
            </span>
          )}
          {item.runtime != null && item.runtime > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock3 size={11} />
              {item.runtime} min
            </span>
          )}
          {item.genres.length > 0 && (
            <span className="text-white/65">{item.genres.slice(0, 3).join(" · ")}</span>
          )}
        </div>

        {item.overview && (
          <p className="max-w-xl text-xs leading-relaxed text-white/80 line-clamp-3 sm:text-sm">
            {item.overview}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={play}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-black shadow-lg transition-[background-color,transform] duration-150 hover:bg-white/90 active:scale-[0.97] sm:h-11 sm:px-5 sm:text-sm"
          >
            {canPlay ? <Play size={15} fill="currentColor" /> : <Info size={15} />}
            {!canPlay
              ? "View title"
              : resuming
                ? `Resume ${formatTime(item.watch?.position ?? 0)}`
                : "Play"}
          </button>
          {canPlay && (
            <Link
              to="/title/$itemId"
              params={{ itemId: item.publicId }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-xs font-semibold text-white backdrop-blur-md transition-[background-color,transform] duration-150 hover:bg-white/20 active:scale-[0.97] sm:h-11 sm:px-5 sm:text-sm"
            >
              <Info size={15} />
              More info
            </Link>
          )}
        </div>

        {percent > 0 && (
          <div className="mt-2 max-w-[280px]">
            <div className="h-1 overflow-hidden rounded-full bg-white/20" aria-hidden>
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${percent / 100})` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] font-medium text-white/65">
              {percent >= 95 ? "Finished" : `${Math.round(percent)}% watched`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
