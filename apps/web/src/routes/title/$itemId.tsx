/// Title Detail (PRD 10.3): movie & series detail, seasons, episodes, trailer, playability specs, cast & fix match.
import { useState, useEffect, useRef } from "react";
import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Video,
  CheckCircle2,
  Circle,
  Wrench,
  RotateCw,
  Sparkles,
  PlayCircle,
  ArrowLeft,
  Trash2,
} from "lucide-react";
import { queries } from "../../queries";
import { api, probeBrowserCaps, type TitleDetail } from "../../client";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TrailerModal } from "../../components/trailer-modal";
import { FixMatchModal } from "../../components/fix-match-modal";
import { Dialog } from "../../components/ui/dialog";
import { cx } from "../../components/ui/button";
import { PageLoader } from "../../components/page-loader";
import { prefetchAssets } from "../../lib/asset-prefetch";
import { prefetchTriggerEnabled } from "../../lib/prefetch-config";

// Capabilities do not change during a session; probing once keeps hover
// prefetches free of layout work.
const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

/**
 * Episodes are stored as `S01E02 · Real Name` once TMDB hydration completes.
 * Strip the prefix for display, but keep fallbacks sensible when a series has
 * not been matched yet (the raw name may be only `S01E02`).
 */
function episodeDisplayTitle(name: string, episodeNumber: number): string {
  const stripped = name.replace(/^S\d+E\d+\s*[·\-:]\s*/i, "").trim();
  if (stripped && !/^S\d+E\d+$/i.test(stripped)) return stripped;
  // Some shows (e.g. Netflix Originals) genuinely title episodes "Episode 1".
  return `Episode ${episodeNumber}`;
}

function TitleRoute() {
  const { itemId } = useParams({ from: Route.id });
  const queryId = /^\d+$/.test(itemId) ? Number(itemId) : itemId;
  const { data, isLoading, isError, refetch } = useQuery(queries.title(queryId));

  if (isLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-6 sm:px-8">
        <PageLoader />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-16 sm:px-8">
        <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
          <h2 className="font-display text-xl font-bold text-ink">Title not found</h2>
          <p className="text-sm text-ink-muted">The requested title could not be loaded from Plexy.</p>
          <Link to="/">
            <Button variant="brand" className="mt-4">
              Back to Home
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-2 sm:px-8">
      <DetailView detail={data} queryId={queryId} onRefresh={() => refetch()} />
    </main>
  );
}

export const Route = createFileRoute("/title/$itemId")({ component: TitleRoute });

function DetailView({
  detail,
  queryId,
  onRefresh,
}: {
  detail: TitleDetail;
  queryId: number | string;
  onRefresh: () => void;
}) {
  const { item, metadata, cast, trailer, seasons, episodes, file, logo, unmatched, matchReason } = detail;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [fixMatchOpen, setFixMatchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const seasonList = seasons && seasons.length > 0
    ? seasons
    : [{ id: 1, number: 1, name: "Season 1", poster: null }];

  const [selectedSeason, setSelectedSeason] = useState<number>(
    seasonList[0].number,
  );
  const [castExpanded, setCastExpanded] = useState(false);
  const episodesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (seasonList.length > 0 && !seasonList.some((s) => s.number === selectedSeason)) {
      setSelectedSeason(seasonList[0].number);
    }
  }, [seasonList, selectedSeason]);


  // Watch state mutations. `setWatched` can mark *and* unmark; clearing removes
  // the row so the title drops out of Continue Watching entirely.
  const invalidateWatch = () => {
    queryClient.invalidateQueries({ queryKey: ["title", queryId] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const watchMutation = useMutation({
    mutationFn: (vars: { itemId: number; played: boolean }) => api.setWatched(vars.itemId, vars.played),
    onSuccess: invalidateWatch,
  });

  const clearWatchMutation = useMutation({
    mutationFn: (targetId: number) => api.clearWatch(targetId),
    onSuccess: invalidateWatch,
  });

  // Metadata refresh mutation
  const refreshMutation = useMutation({
    mutationFn: () => api.refreshItem(item.id),
    onSuccess: () => {
      onRefresh();
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTitle(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    },
  });


  const isPlayed = !!item.watch?.played;
  const resumePos = item.watch?.position ?? 0;
  const hasResume = resumePos > 15 && !isPlayed;

  // Warm the player manifest (and therefore the stream) as soon as the pointer
  // lands on a play control, so the navigation has nothing left to wait for.
  const prefetchPlay = (fileId: number | null | undefined) => {
    if (!fileId || !BROWSER_CAPS) return;
    void queryClient.prefetchQuery(queries.play(fileId, BROWSER_CAPS));
  };

  const filteredEpisodes = episodes
    ? episodes.filter((ep) => {
        if (ep.seasonNumber != null) {
          return ep.seasonNumber === selectedSeason;
        }
        return selectedSeason === 1;
      })
    : [];

  // Warm episode artwork as cards approach the viewport. The observer is torn
  // down when the season or title changes, and only artwork present on the
  // card is fetched — the detail payload carries no trickplay data to warm.
  useEffect(() => {
    const root = episodesRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-episode-art]"));
    if (cards.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          if (!prefetchTriggerEnabled("scroll")) continue;
          const card = entry.target as HTMLElement;
          prefetchAssets([card.dataset.poster, card.dataset.backdrop]);
        }
      },
      { rootMargin: "300px 0px" },
    );
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [episodes, selectedSeason]);

  const primaryFileId = (() => {
    if (item.kind === "series" && episodes && episodes.length > 0) {
      const targetEp = filteredEpisodes.find((e) => !e.watch?.played)
        ?? filteredEpisodes[0]
        ?? episodes[0];
      return targetEp?.fileId ?? targetEp?.id ?? null;
    }
    return file?.fileId ?? item.fileId ?? null;
  })();

  const handlePrimaryPlay = () => {
    if (primaryFileId) {
      navigate({ to: "/watch/$fileId", params: { fileId: String(primaryFileId) } });
    }
  };

  return (
    <div className="space-y-10">
      {/* Detail hero banner */}
      <section className="relative isolate min-h-[500px] sm:min-h-[480px] lg:h-[540px] overflow-hidden rounded-sm sm:rounded-sm border border-line/40 bg-surface flex flex-col justify-end">
        {/* Backdrop image */}
        <img
          src={item.backdrop ?? item.poster ?? ""}
          alt={item.name}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[center_24%] sm:object-[center_28%] transition-transform duration-700 ease-out hover:scale-102"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        {/* Cinematic directional masks */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/85 via-35% via-canvas/30 to-black/10 pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute inset-0 hidden sm:block bg-gradient-to-r from-canvas/90 via-canvas/65 via-45% to-transparent pointer-events-none"
          aria-hidden
        />

        {/* Content container */}
        <div className="relative z-10 w-full max-w-3xl p-5 sm:p-8 lg:p-12 animate-in fade-in duration-300">
          {item.kind === "episode" && item.parentId && (
            <Link
              to="/title/$itemId"
              params={{ itemId: item.parentPublicId ?? String(item.parentId) }}
              className="mb-3 inline-flex items-center gap-1.5 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1 text-xs font-semibold text-white/90 transition-all hover:bg-black/80 hover:text-white active:scale-95"
            >
              <ArrowLeft size={13} />
              Back to {item.parentTitle || "Series"}
            </Link>
          )}

          {logo ? (
            <img
              src={logo}
              alt={item.name}
              className="mb-3 max-h-16 sm:max-h-20 max-w-[280px] sm:max-w-[340px] object-contain drop-shadow-md"
            />
          ) : (
            <h1 className="font-sans text-3xl min-[480px]:text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md">
              {item.name}
            </h1>
          )}

          {metadata?.tagline && (
            <p className="mt-2 max-w-[60ch] text-sm sm:text-base italic text-white/65">{metadata.tagline}</p>
          )}

          <div className="mt-2.5 sm:mt-3 flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs text-ink-muted">
            {item.year && (
              <span className="font-semibold text-white/80">
                {item.year}
              </span>
            )}
            {item.kind === "episode" && item.seasonNumber != null && item.episodeNumber != null && (
              <span className="border border-white/20 bg-white/8 px-2 py-0.5 text-xs font-bold text-white/90">
                S{item.seasonNumber} E{item.episodeNumber}
              </span>
            )}
            {metadata?.runtime && <span className="text-white/70 font-medium">{metadata.runtime} min</span>}
            {metadata?.certification && (
              <span className="border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/80">
                {metadata.certification}
              </span>
            )}
            {item.rating && (
              <span className="flex items-center gap-1 font-semibold text-amber">
                ★ {item.rating.toFixed(1)}
              </span>
            )}
            {metadata?.genres.slice(0, 3).map((g) => (
              <span
                key={g}
                className="bg-white/8 border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80"
              >
                {g}
              </span>
            ))}
          </div>

          {/* Unmatched / review notice */}
          {unmatched && item.kind !== "episode" && (
            <div className="mt-4 flex items-center gap-3 border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-sm text-amber-300">
              <Sparkles size={16} className="shrink-0" />
              <span className="text-xs sm:text-sm">
                Not identified yet{matchReason ? `: ${matchReason}` : ""}.
              </span>
              <Button
                variant="surface"
                onClick={() => setFixMatchOpen(true)}
                className="ml-auto h-8 px-3 text-xs font-semibold"
              >
                Fix Match
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 sm:mt-6 flex flex-wrap items-center gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
            {(file || (item.kind === "series" && episodes && episodes.length > 0)) && (
              <Button
                variant="primary"
                onClick={handlePrimaryPlay}
                onPointerEnter={() => prefetchPlay(primaryFileId)}
                onFocus={() => prefetchPlay(primaryFileId)}
                className="h-10 sm:h-11 px-5 sm:px-6 text-sm font-bold active:scale-95 transition-all"
              >
                {hasResume ? (
                  <PlayCircle size={18} />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
                {hasResume ? `Resume ${Math.round(item.watch?.percent ?? 0)}%` : "Play"}
              </Button>
            )}

            {trailer && (
              <Button
                variant="secondary"
                onClick={() => setTrailerOpen(true)}
                className="h-10 sm:h-11 px-3.5 sm:px-4 text-xs sm:text-sm font-semibold backdrop-blur-md bg-white/10 hover:bg-white/20 active:scale-95 border border-white/15 text-white transition-all"
              >
                <Video size={17} />
                Trailer
              </Button>
            )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Button
              variant="secondary"
              onClick={() => watchMutation.mutate({ itemId: item.id, played: !isPlayed })}
              disabled={watchMutation.isPending || clearWatchMutation.isPending}
              className="h-10 sm:h-11 px-3.5 sm:px-4 text-xs sm:text-sm font-semibold backdrop-blur-md bg-white/10 hover:bg-white/20 active:scale-95 border border-white/15 text-white transition-all"
              title={isPlayed ? "Mark as unwatched" : "Mark as watched"}
              aria-label={isPlayed ? "Mark as unwatched" : "Mark as watched"}
            >
              {isPlayed ? (
                <>
                  <CheckCircle2 size={17} className="text-brand-text" />
                  <span className="hidden sm:inline">Watched</span>
                </>
              ) : (
                <>
                  <Circle size={17} />
                  <span className="hidden sm:inline">Mark Watched</span>
                </>
              )}
            </Button>

            {item.watch && (
              <Button
                variant="ghost"
                onClick={() => clearWatchMutation.mutate(item.id)}
                disabled={clearWatchMutation.isPending}
                className="h-10 sm:h-11 px-3 text-xs sm:text-sm font-semibold text-white/70 hover:text-red-300 hover:bg-red-500/10 active:scale-95 transition-all"
                title="Remove this title from Continue Watching and reset its progress"
                aria-label="Remove progress"
              >
                <Trash2 size={15} />
                <span className="hidden sm:inline">Remove Progress</span>
              </Button>
            )}

            <Button
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              className="h-10 sm:h-11 px-3.5 sm:px-4 text-xs sm:text-sm font-semibold"
              title="Delete this title and its original video files"
            >
              <Trash2 size={15} />
              <span className="hidden sm:inline">Delete title</span>
            </Button>

            {item.kind !== "episode" && (
              <Button
                variant="ghost"
                onClick={() => setFixMatchOpen(true)}
                className="h-10 sm:h-11 px-3 text-xs sm:text-sm text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                title="Search and assign the correct TMDB match"
                aria-label="Fix match"
              >
                <Wrench size={15} />
                <span className="hidden sm:inline">Fix Match</span>
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || unmatched}
              className="h-10 sm:h-11 px-3 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
              title={unmatched ? "Match this title first, then refresh metadata" : "Refresh metadata"}
              aria-label="Refresh metadata"
            >
              <RotateCw size={15} className={refreshMutation.isPending ? "animate-spin" : ""} />
            </Button>
            </div>
          </div>

          {refreshMutation.isError && (
            <p className="mt-2.5 text-xs text-red-400">{refreshMutation.error.message}</p>
          )}
          {refreshMutation.isSuccess && (
            <p className="mt-2.5 text-xs text-emerald-400">Metadata refreshed from TMDB.</p>
          )}
        </div>
      </section>

      {/* Main grid: synopsis and episodes on the left, cast and media details on the right */}
      <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-10">
          {item.overview && (
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                Synopsis
              </h2>
              <p className="mt-3 max-w-[75ch] text-base leading-relaxed text-ink-muted">
                {item.overview}
              </p>
            </div>
          )}

          {/* Series: seasons & episodes (PRD 10.3) */}
          {item.kind === "series" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-ink">Episodes</h2>
                  <span className="text-xs text-ink-muted">
                    {filteredEpisodes.length} {filteredEpisodes.length === 1 ? "episode" : "episodes"}
                  </span>
                </div>

                {seasonList.length > 1 && (
                  <Select.Root
                    value={String(selectedSeason)}
                    onValueChange={(v) => setSelectedSeason(Number(v))}
                    items={seasonList.map((s) => ({
                      value: String(s.number),
                      label: s.name || `Season ${s.number}`,
                    }))}
                  >
                    <Select.Trigger aria-label="Season" className="min-w-40">
                      <Select.Value />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Positioner>
                      {seasonList.map((s) => (
                        <Select.Item key={s.number} value={String(s.number)}>
                          <Select.ItemText>{s.name || `Season ${s.number}`}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Positioner>
                  </Select.Root>
                )}
              </div>

              {filteredEpisodes.length > 0 ? (
                <div ref={episodesRef} className="space-y-2.5">
                  {filteredEpisodes.map((ep, idx) => {
                    const epNum = ep.episodeNumber ?? idx + 1;
                    const displayTitle = episodeDisplayTitle(ep.name, epNum);
                    const targetFileId = ep.fileId ?? ep.id;
                    const played = !!ep.watch?.played;
                    const hasWatch = !!ep.watch;
                    const seasonNum = ep.seasonNumber ?? selectedSeason;
                    const badge = `S${seasonNum}E${epNum}`;

                    return (
                      <div
                        key={ep.id}
                        data-episode-art
                        data-poster={ep.poster ?? undefined}
                        data-backdrop={ep.backdrop ?? undefined}
                        className={cx(
                          "group relative flex w-full items-center justify-between gap-2.5 rounded-xl border bg-surface p-2 sm:p-2.5 sm:gap-3.5",
                          "transition-all duration-150 ease-out hover:border-line hover:bg-surface-hover/80 active:scale-[0.99]",
                          played ? "border-line/40 opacity-80 hover:opacity-100" : "border-line/70",
                        )}
                      >
                        <button
                          type="button"
                          onPointerEnter={() => prefetchPlay(targetFileId)}
                          onFocus={() => prefetchPlay(targetFileId)}
                          onClick={() => {
                            navigate({
                              to: "/watch/$fileId",
                              params: { fileId: String(targetFileId) },
                            });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5 text-left focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 rounded-lg"
                        >
                          {/* Episode index number on desktop */}
                          <div className="hidden sm:flex w-6 shrink-0 justify-center font-display text-xs font-semibold tabular-nums text-ink-muted/70 transition-colors group-hover:text-ink">
                            {String(epNum).padStart(2, "0")}
                          </div>

                          {/* Episode thumbnail */}
                          <div className="relative aspect-video w-24 min-[400px]:w-32 sm:w-40 md:w-44 shrink-0 overflow-hidden rounded-lg bg-surface-2 border border-line/50">
                            {ep.poster || ep.backdrop ? (
                              <img
                                src={ep.poster ?? ep.backdrop ?? ""}
                                alt={displayTitle}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center p-2 font-display text-[10px] text-ink-muted text-center bg-gradient-to-t from-black/60 to-transparent">
                                <span className="line-clamp-2">{displayTitle}</span>
                              </div>
                            )}

                            {/* Play overlay affordance */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-2xs transition-opacity duration-150 group-hover:opacity-100">
                              <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white text-black shadow-md transition-transform duration-150 group-hover:scale-105 active:scale-95">
                                <Play size={14} className="ml-0.5" fill="currentColor" />
                              </div>
                            </div>

                            {/* Duration tag */}
                            {ep.runtime && (
                              <div className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-0.2 text-[9px] font-semibold text-white/90">
                                {ep.runtime}m
                              </div>
                            )}

                            {/* Watch progress line */}
                            {ep.watch && ep.watch.percent > 0 && (
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden">
                                <div
                                  className="h-full bg-brand"
                                  style={{ width: `${Math.min(100, Math.max(2, ep.watch.percent))}%` }}
                                />
                              </div>
                            )}
                          </div>

                          {/* Episode info */}
                          <div className="min-w-0 flex-1 py-0.5">
                            <div className="flex items-center gap-2">
                              <span className="rounded-sm bg-brand/10 text-brand-text px-1.5 py-0.2 text-[10px] font-bold tabular-nums shrink-0">
                                {badge}
                              </span>
                              <h3 className="truncate text-xs sm:text-sm font-semibold text-ink transition-colors group-hover:text-white">
                                {displayTitle}
                              </h3>
                              {ep.runtime && (
                                <span className="hidden sm:inline-block shrink-0 text-[11px] font-medium text-ink-muted/80">
                                  · {ep.runtime} min
                                </span>
                              )}
                            </div>

                            {ep.overview ? (
                              <p className="mt-1 line-clamp-1 min-[420px]:line-clamp-2 text-[11px] sm:text-xs leading-relaxed text-ink-muted">
                                {ep.overview}
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] text-ink-muted/60 italic">
                                No description available.
                              </p>
                            )}
                          </div>
                        </button>

                        {/* Per-episode quick controls */}
                        <div className="flex shrink-0 items-center gap-0.5 pr-1">
                          <button
                            type="button"
                            onClick={() => watchMutation.mutate({ itemId: ep.id, played: !played })}
                            disabled={watchMutation.isPending}
                            aria-label={played ? `Mark ${displayTitle} unwatched` : `Mark ${displayTitle} watched`}
                            title={played ? "Mark unwatched" : "Mark watched"}
                            className={cx(
                              "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95 disabled:opacity-50",
                              played
                                ? "text-brand-text hover:bg-brand/10"
                                : "text-ink-muted hover:text-ink hover:bg-surface-2",
                            )}
                          >
                            {played ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                          </button>
                          {hasWatch && (
                            <button
                              type="button"
                              onClick={() => clearWatchMutation.mutate(ep.id)}
                              disabled={clearWatchMutation.isPending}
                              aria-label={`Remove progress for ${displayTitle}`}
                              title="Remove progress"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-all hover:bg-red-500/10 hover:text-red-400 active:scale-95 disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-4 text-sm text-ink-muted">
                  No individual episode records indexed for this season yet.
                </p>
              )}
            </div>
          )}

        </div>

        {/* Right column: Top Cast and technical media details */}
        {(cast?.length || file) && (
          <aside className="h-fit space-y-6">
            {cast && cast.length > 0 && (
              <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                    Top Cast
                  </h2>
                  {cast.length > 6 && (
                    <button
                      onClick={() => setCastExpanded((v) => !v)}
                      className="shrink-0 text-xs text-ink-muted transition-colors hover:text-ink"
                    >
                      {castExpanded ? "Show Less" : `View All (${cast.length})`}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {(castExpanded ? cast : cast.slice(0, 6)).map((c) => (
                    <div
                      key={c.name}
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-line/60 bg-canvas/50 p-2.5"
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                        {c.photo ? (
                          <img
                            src={c.photo}
                            alt={c.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-ink-muted">
                            {c.name[0]}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">{c.name}</p>
                        {c.character && (
                          <p className="truncate text-[11px] text-ink-muted">{c.character}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {file && <section className="h-fit space-y-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
              <h3 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-ink-muted">
                Media Details
              </h3>
              <dl className="space-y-2.5 text-xs">
                {file.width && file.height && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Resolution</dt>
                    <dd className="font-medium text-ink">
                      {file.height >= 2160
                        ? "4K UHD"
                        : file.height >= 1080
                          ? "1080p FHD"
                          : `${file.width}×${file.height}`}
                    </dd>
                  </div>
                )}

                {file.videoCodec && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Video Codec</dt>
                    <dd className="font-medium uppercase text-ink">
                      {file.videoCodec} {file.videoProfile ? `(${file.videoProfile})` : ""}
                    </dd>
                  </div>
                )}

                {file.container && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Container</dt>
                    <dd className="font-medium uppercase text-ink">{file.container}</dd>
                  </div>
                )}

                {file.audio && file.audio.length > 0 && (
                  <div className="flex items-baseline justify-between gap-6">
                    <dt className="shrink-0 text-ink-muted">Audio</dt>
                    <dd className="text-right font-medium text-ink">
                      {file.audio
                        .map((a) => [a.codec.toUpperCase(), a.language].filter(Boolean).join(" · "))
                        .join(", ")}
                    </dd>
                  </div>
                )}

                {file.subtitleCount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtitles</dt>
                    <dd className="font-medium text-ink">{file.subtitleCount} tracks</dd>
                  </div>
                )}

                {file.size > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">File Size</dt>
                    <dd className="font-medium tabular-nums text-ink">
                      {(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                    </dd>
                  </div>
                )}

                {file.duration && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Duration</dt>
                    <dd className="font-medium tabular-nums text-ink">{Math.round(file.duration / 60)} min</dd>
                  </div>
                )}
              </dl>
            </div>
            </section>}
          </aside>
        )}
      </div>

      <TrailerModal
        open={trailerOpen}
        onOpenChange={setTrailerOpen}
        trailerKey={trailer?.key ?? null}
        title={item.name}
      />

      <FixMatchModal
        open={fixMatchOpen}
        onOpenChange={setFixMatchOpen}
        itemId={item.id}
        initialTitle={item.name}
        initialYear={item.year}
        kind={item.kind}
      />

      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>Delete “{item.name}” and its video files?</Dialog.Title>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              This permanently deletes the original video files from disk and removes the title from Plexy.
              {item.kind === "series" ? " The files for its episodes will also be deleted." : ""}
            </p>
            {deleteMutation.isError && <p role="alert" className="mt-3 text-sm text-red-400">{deleteMutation.error.message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting…" : "Delete title and files"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
