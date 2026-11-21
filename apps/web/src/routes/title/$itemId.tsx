/// Title Detail (PRD 10.3): movie & series detail, seasons, episodes, trailer,
/// playability specs, cast & fix match.
import { useState, useEffect } from "react";
import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Video,
  CheckCircle2,
  Circle,
  Wrench,
  RotateCw,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  Trash2,
  Bookmark,
  Star,
  MoreHorizontal,
  ChevronRight,
  Users,
  HardDrive,
  EyeOff,
  FolderHeart,
  Download,
  Captions,
} from "lucide-react";
import { queries } from "@/queries";
import { nativeBridge } from "@/lib/native-playback";
import { api, probeBrowserCaps, type TitleDetail } from "@/client";
import { Button, Dropdown, Modal } from "@heroui/react";
import { TrailerModal } from "@/components/trailer-modal";
import { FixMatchModal } from "@/components/fix-match-modal";
import { CollectionPicker } from "@/components/collection-picker";
import { SubtitleSearchModal } from "@/components/subtitle-search-modal";
import { Row } from "@/components/row";
import { Page } from "@/components/page";
import { State } from "@/components/state";
import { cx } from "@/lib/cx";
import { artworkUrl } from "@/lib/artwork-url";
import { useItemFlags } from "@/lib/use-item-flags";

// Capabilities do not change during a session; probing once keeps hover
// prefetches free of layout work.
const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

/**
 * Episodes are stored as `S01E01 · Real Name` once TMDB hydration completes.
 * Strip redundant season/episode numbering so headers don't repeat (e.g. S1 • E1 – Real Name).
 */
function episodeDisplayTitle(name: string, episodeNumber: number): string {
  if (!name) return `Episode ${episodeNumber}`;
  const stripped = name
    .replace(/^(?:S\d+E\d+|E\d+|\d+x\d+|Episode\s+\d+|Ep\.?\s*\d+)\s*[·\-:–—]\s*/i, "")
    .replace(/^(?:S\d+E\d+|E\d+|\d+x\d+)\s+/i, "")
    .trim();
  if (stripped && !/^(?:S\d+E\d+|E\d+|\d+x\d+)$/i.test(stripped)) {
    return stripped;
  }
  return `Episode ${episodeNumber}`;
}

function TitleRoute() {
  const { itemId } = useParams({ from: Route.id });
  const queryId = /^\d+$/.test(itemId) ? Number(itemId) : itemId;
  const { data, isLoading, isError, refetch } = useQuery(queries.title(queryId));

  if (isLoading) {
    return (
      <Page>
        <div className="space-y-6">
          <div className="skeleton h-[clamp(24rem,56vh,40rem)] rounded-[calc(var(--radius)*3)]" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="skeleton h-72 rounded-[calc(var(--radius)*2)]" />
            <div className="skeleton h-52 rounded-[calc(var(--radius)*2)]" />
          </div>
        </div>
      </Page>
    );
  }

  if (isError || !data) {
    return (
      <Page>
        <State
          title="Title not found"
          body="The requested title could not be loaded from Plexy."
          action={
            <Link to="/">
              <Button>Back to Home</Button>
            </Link>
          }
        />
      </Page>
    );
  }

  return (
    <Page className="pt-3 sm:pt-4">
      <DetailView detail={data} queryId={queryId} onRefresh={() => refetch()} />
    </Page>
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
  const { item, metadata, cast, trailer, extras, seasons, episodes, file, logo, unmatched, matchReason } = detail;
  const extraVideos = extras ?? [];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [extraVideo, setExtraVideo] = useState<{ key: string; name: string } | null>(null);
  const [fixMatchOpen, setFixMatchOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const similar = useQuery(queries.similar(item.id));

  const seasonList = seasons && seasons.length > 0
    ? seasons
    : [{ id: 1, number: 1, name: "Season 1", poster: null }];

  const [selectedSeason, setSelectedSeason] = useState<number>(seasonList[0].number);
  const [castExpanded, setCastExpanded] = useState(false);

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

  const filteredEpisodes = episodes
    ? episodes.filter((ep) => {
        if (ep.seasonNumber != null) {
          return ep.seasonNumber === selectedSeason;
        }
        return selectedSeason === 1;
      })
    : [];

  const activeEpisode = item.kind === "series" && episodes && episodes.length > 0
    ? (filteredEpisodes.find((e) => !e.watch?.played) ?? filteredEpisodes[0] ?? episodes[0])
    : null;

  const activeWatch = activeEpisode ? activeEpisode.watch : item.watch;
  const isPlayed = !!activeWatch?.played;
  const resumePos = activeWatch?.position ?? 0;
  const hasResume = resumePos > 15 && !isPlayed;
  const {
    flags,
    toggleWatchlist,
    toggleFavorite,
    setRating,
    setHidden,
  } = useItemFlags(item);
  const inWatchlist = flags.watchlist;
  const isFavorite = flags.favorite;

  const displayRuntime = activeEpisode?.runtime || metadata?.runtime || null;
  const displayCert = metadata?.certification || null;
  const displayGenres = (metadata?.genres ?? []).slice(0, 3);
  // The hero describes the title, not whichever episode happens to be next.
  const displayOverview = metadata?.overview || item.overview || activeEpisode?.overview || null;
  const rating = item.rating ?? metadata?.rating ?? null;

  const prefetchPlay = (fileId: number | null | undefined) => {
    if (!fileId || !BROWSER_CAPS) return;
    void queryClient.prefetchQuery(nativeBridge() ? queries.playNative(fileId) : queries.play(fileId, BROWSER_CAPS));
  };

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
      navigate({ to: "/watch/$fileId", params: { fileId: String(primaryFileId) }, state: { playerFromTitle: true } });
    }
  };

  return (
    <div className="staggered space-y-8">
      <section className="hero-shell flex min-h-[30rem] flex-col sm:min-h-[34rem] lg:min-h-[35rem]">
        <img
          src={artworkUrl(item.backdrop ?? item.poster) ?? ""}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="hero-media absolute inset-0 h-full w-full object-cover object-[center_24%] sm:object-[center_28%]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        <div className="relative z-10 flex flex-1 flex-col justify-between gap-8 p-5 sm:p-8 lg:p-11">
          <div className="flex flex-wrap items-center gap-2.5">
            {item.kind === "episode" && item.parentId && (
              <Link
                to="/title/$itemId"
                params={{ itemId: item.parentPublicId ?? String(item.parentId) }}
                className="hero-secondary h-8 px-3 text-[11px]"
              >
                <ArrowLeft size={12} aria-hidden />
                Back to {item.parentTitle || "Series"}
              </Link>
            )}
            {unmatched && item.kind !== "episode" && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-soft-foreground backdrop-blur-md">
                <Sparkles size={13} className="shrink-0" aria-hidden />
                <span>
                  Not identified yet{matchReason ? `: ${matchReason}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setFixMatchOpen(true)}
                  className="ml-auto rounded border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-white/20"
                >
                  Fix match
                </button>
              </div>
            )}
          </div>

          <div className="flex items-end gap-6 lg:gap-8">
            <div className="hero-copy min-w-0 flex-1">
              {displayGenres.length > 0 && (
                <div className="mb-3.5 flex flex-wrap gap-2" aria-label="Genres">
                  {displayGenres.map((genre) => (
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
                    className="mb-4 max-h-16 max-w-[280px] object-contain object-left drop-shadow-[0_4px_30px_rgba(0,0,0,0.55)] sm:max-h-24 sm:max-w-[380px]"
                  />
                </>
              ) : (
                <h1 className="hero-title mb-3 max-w-[18ch] font-sans text-[2.4rem] text-white sm:text-5xl lg:text-[3.8rem]">
                  {item.name}
                </h1>
              )}

              <div className="hero-meta">
                {item.year && <span>{item.year}</span>}
                {displayRuntime != null && (
                  <>
                    <span className="meta-dot" aria-hidden />
                    <span>{displayRuntime} min</span>
                  </>
                )}
                {displayCert && (
                  <>
                    <span className="meta-dot" aria-hidden />
                    <span>{displayCert}</span>
                  </>
                )}
                <span className="meta-dot" aria-hidden />
                <span>{item.kind === "series" ? "Series" : "Film"}</span>
              </div>

              {rating != null && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-0.5" aria-hidden>
                    {[0, 1, 2, 3, 4].map((index) => (
                      <Star
                        key={index}
                        size={15}
                        strokeWidth={1.4}
                        fill={index < Math.round((rating / 10) * 5) ? "currentColor" : "none"}
                        className={index < Math.round((rating / 10) * 5) ? "text-warning" : "text-white/35"}
                      />
                    ))}
                  </span>
                  <span className="text-[11px] font-medium text-white/65">
                    Average rating <strong className="font-semibold text-white">{(rating / 2).toFixed(1)}</strong> / 5
                  </span>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[11px] font-medium text-white/55">
                  Your rating
                </span>
                <span className="flex items-center gap-0.5" role="group" aria-label="Rate this title">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const selected = (flags.rating ?? 0) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(flags.rating === star ? null : star)}
                        aria-label={`${selected ? "Remove" : "Set"} ${star}-star rating`}
                        title={`${star} star${star === 1 ? "" : "s"}`}
                        className="rounded p-0.5 text-warning transition-transform active:scale-90"
                      >
                        <Star
                          size={15}
                          strokeWidth={1.5}
                          fill={selected ? "currentColor" : "none"}
                          className={selected ? "" : "text-white/35"}
                        />
                      </button>
                    );
                  })}
                </span>
                {flags.rating != null && (
                  <button
                    type="button"
                    onClick={() => setRating(null)}
                    className="text-[10px] font-semibold text-white/45 underline underline-offset-2 hover:text-white/75"
                  >
                    Clear
                  </button>
                )}
              </div>

              {displayOverview && (
                <p className="mt-4 max-w-[42rem] text-[13px] leading-relaxed text-white/75 line-clamp-3 sm:text-sm">
                  {displayOverview}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrimaryPlay}
                  onPointerEnter={() => prefetchPlay(primaryFileId)}
                  onFocus={() => prefetchPlay(primaryFileId)}
                  disabled={!primaryFileId}
                  className="hero-primary disabled:opacity-60"
                >
                  {hasResume ? <Play size={15} fill="currentColor" aria-hidden /> : isPlayed ? <RotateCcw size={15} aria-hidden /> : <Play size={15} fill="currentColor" aria-hidden />}
                  {hasResume ? "Resume" : isPlayed ? "Watch again" : "Play"}
                </button>

                {trailer && (
                  <button type="button" onClick={() => setTrailerOpen(true)} className="hero-secondary">
                    <Video size={15} aria-hidden />
                    Trailer
                  </button>
                )}

                <div className="ml-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => watchMutation.mutate({ itemId: activeEpisode?.id ?? item.id, played: !isPlayed })}
                    disabled={watchMutation.isPending || clearWatchMutation.isPending}
                    aria-label={isPlayed ? "Mark as unwatched" : "Mark as watched"}
                    title={isPlayed ? "Mark as unwatched" : "Mark as watched"}
                    data-selected={isPlayed || undefined}
                    className="hero-icon"
                  >
                    {isPlayed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
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

                  <button
                    type="button"
                    onClick={toggleFavorite}
                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    data-selected={isFavorite || undefined}
                    className="hero-icon"
                  >
                    <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                  </button>

                  <Dropdown>
                    <Dropdown.Trigger aria-label="More options" className="hero-icon">
                      <MoreHorizontal size={16} />
                    </Dropdown.Trigger>
                    <Dropdown.Popover placement="bottom start">
                      <Dropdown.Menu
                        onAction={(key) => {
                          if (key === "fix-match") setFixMatchOpen(true);
                          else if (key === "collection") setCollectionOpen(true);
                          else if (key === "subtitles") setSubtitleOpen(true);
                          else if (key === "refresh") refreshMutation.mutate();
                          else if (key === "download" && file?.fileId) {
                            const anchor = document.createElement("a");
                            anchor.href = `/api/download/${file.fileId}`;
                            anchor.download = "";
                            anchor.click();
                          } else if (key === "clear-watch") clearWatchMutation.mutate(item.id);
                          else if (key === "hide") {
                            setHidden(true);
                            void navigate({ to: "/" });
                          } else if (key === "delete") setDeleteOpen(true);
                        }}
                      >
                        {item.kind !== "episode" && (
                          <Dropdown.Item id="fix-match" textValue="Fix TMDB match">
                            <Wrench size={14} className="shrink-0 text-muted" />
                            <span>Fix TMDB match</span>
                          </Dropdown.Item>
                        )}
                        {item.kind !== "episode" && (
                          <Dropdown.Item id="collection" textValue="Add to collection">
                            <FolderHeart size={14} className="shrink-0 text-muted" />
                            <span>Add to collection</span>
                          </Dropdown.Item>
                        )}
                        {file?.fileId && (
                          <Dropdown.Item id="subtitles" textValue="Find subtitles">
                            <Captions size={14} className="shrink-0 text-muted" />
                            <span>Find subtitles</span>
                          </Dropdown.Item>
                        )}
                        <Dropdown.Item
                          id="refresh"
                          textValue="Refresh metadata"
                          isDisabled={refreshMutation.isPending || unmatched}
                        >
                          <RotateCw size={14} className={cx("shrink-0 text-muted", refreshMutation.isPending && "animate-spin")} />
                          <span>Refresh metadata</span>
                        </Dropdown.Item>
                        {item.kind !== "series" && file?.fileId && (
                          <Dropdown.Item id="download" textValue="Download original">
                            <Download size={14} className="shrink-0 text-muted" />
                            <span>Download original</span>
                          </Dropdown.Item>
                        )}
                        {item.watch && (
                          <Dropdown.Item
                            id="clear-watch"
                            textValue="Clear watch progress"
                            isDisabled={clearWatchMutation.isPending}
                          >
                            <Trash2 size={14} className="shrink-0 text-danger-soft-foreground" />
                            <span>Clear watch progress</span>
                          </Dropdown.Item>
                        )}
                        {item.kind !== "episode" && (
                          <Dropdown.Item id="hide" textValue="Hide from library">
                            <EyeOff size={14} className="shrink-0 text-muted" />
                            <span>Hide from library</span>
                          </Dropdown.Item>
                        )}
                        <Dropdown.Section>
                          <Dropdown.Item id="delete" textValue="Remove title and files" className="text-danger-soft-foreground">
                            <Trash2 size={14} className="shrink-0" />
                            <span>Remove title and files</span>
                          </Dropdown.Item>
                        </Dropdown.Section>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                </div>
              </div>

              {refreshMutation.isError && (
                <p className="mt-3 text-xs text-danger-soft-foreground">{refreshMutation.error.message}</p>
              )}
              {refreshMutation.isSuccess && (
                <p className="mt-3 text-xs text-success-soft-foreground">Metadata refreshed from TMDB.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20.5rem] xl:gap-10">
        <div className="min-w-0 space-y-8">
          {item.kind === "series" && (
            <section className="panel overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 px-4 py-3.5 sm:px-5">
                <h2 className="font-sans text-lg font-bold tracking-[-0.03em] text-foreground">
                  Episodes
                </h2>

                {seasonList.length > 1 && (
                  <div className="segmented max-w-full overflow-x-auto" role="group" aria-label="Season">
                    {seasonList.map((season) => (
                      <button
                        key={season.number}
                        type="button"
                        aria-pressed={season.number === selectedSeason}
                        data-active={season.number === selectedSeason || undefined}
                        onClick={() => setSelectedSeason(season.number)}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {season.name || `Season ${season.number}`}
                      </button>
                    ))}
                  </div>
                )}
              </header>

              {filteredEpisodes.length > 0 ? (
                <div className="divide-y divide-border/50 px-2 py-1 sm:px-3">
                  {filteredEpisodes.map((ep, idx) => {
                    const epNum = ep.episodeNumber ?? idx + 1;
                    const displayTitle = episodeDisplayTitle(ep.name, epNum);
                    const targetFileId = ep.fileId ?? ep.id;
                    const played = !!ep.watch?.played;
                    const hasWatch = !!ep.watch;
                    const seasonNum = ep.seasonNumber ?? selectedSeason;
                    const isNext = activeEpisode?.id === ep.id && !played;

                    return (
                      <div
                        key={ep.id}
                        data-episode-art
                        data-poster={ep.poster ?? undefined}
                        data-backdrop={ep.backdrop ?? undefined}
                        className={cx(
                          "group relative flex w-full items-center gap-2 rounded-lg py-1.5 pl-1 pr-1 transition-colors duration-150 sm:gap-3 sm:pl-2",
                          isNext ? "bg-surface-secondary/55" : "hover:bg-surface-secondary/40",
                        )}
                      >
                        {isNext && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent" />}

                        <button
                          type="button"
                          onPointerEnter={() => prefetchPlay(targetFileId)}
                          onFocus={() => prefetchPlay(targetFileId)}
                          onClick={() => {
                            if (!targetFileId) return;
                            navigate({
                              to: "/watch/$fileId",
                              params: { fileId: String(targetFileId) },
                              state: { playerFromTitle: true },
                            });
                          }}
                          aria-label={played ? `Play ${displayTitle} again` : `Play ${displayTitle}`}
                          className="relative aspect-video w-[7.5rem] shrink-0 overflow-hidden rounded-md border border-border/50 bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 min-[420px]:w-32 sm:w-36"
                        >
                          {ep.poster || ep.backdrop ? (
                            <img
                              src={artworkUrl(ep.poster ?? ep.backdrop) ?? ""}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="zoom-on-hover-strong h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted">
                              <Play size={16} aria-hidden />
                            </div>
                          )}

                          <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-md">
                              <Play size={13} className="ml-0.5" fill="currentColor" />
                            </span>
                          </span>

                          {ep.watch && ep.watch.percent > 0 && (
                            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/55" aria-hidden>
                              <span
                                className="block h-full bg-accent"
                                style={{ width: `${Math.min(100, Math.max(2, ep.watch.percent))}%` }}
                              />
                            </span>
                          )}
                        </button>

                        <div className="min-w-0 flex-1 py-0.5">
                          <h3 className={cx("truncate text-[12.5px] font-semibold text-foreground sm:text-[13.5px]", played && "text-foreground/65")}>
                            {displayTitle}
                          </h3>
                          <p className="mt-1 text-[10.5px] text-muted">
                            Season {seasonNum}, Episode {epNum}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5 self-center pr-0.5">
                          <button
                            type="button"
                            onClick={() => watchMutation.mutate({ itemId: ep.id, played: !played })}
                            disabled={watchMutation.isPending}
                            aria-label={played ? `Mark ${displayTitle} unwatched` : `Mark ${displayTitle} watched`}
                            title={played ? "Mark unwatched" : "Mark watched"}
                            className={cx(
                              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,color,transform] duration-150 active:scale-95 disabled:opacity-50",
                              played
                                ? "text-accent hover:bg-accent/10"
                                : "text-muted/60 hover:bg-surface-secondary hover:text-foreground",
                            )}
                          >
                            {played ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                          </button>
                          {hasWatch && (
                            <button
                              type="button"
                              onClick={() => clearWatchMutation.mutate(ep.id)}
                              disabled={clearWatchMutation.isPending}
                              aria-label={`Remove progress for ${displayTitle}`}
                              title="Remove progress"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted/60 transition-[background-color,color,transform] duration-150 hover:bg-danger/10 hover:text-danger-soft-foreground active:scale-95 disabled:opacity-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-5 py-8 text-sm text-muted">
                  No individual episode records indexed for this season yet.
                </p>
              )}
            </section>
          )}

          {similar.data && similar.data.items.length > 0 && (
            <Row title="More like this" items={similar.data.items} wide />
          )}

          {extraVideos.length > 0 && (
            <section className="panel overflow-hidden">
              <header className="border-b border-border/70 px-4 py-3.5 sm:px-5">
                <h2 className="font-sans text-lg font-bold tracking-[-0.03em] text-foreground">
                  More videos
                </h2>
              </header>
              <div className="flex flex-wrap gap-2 p-3 sm:p-4">
                {extraVideos.map((extra) => (
                  <button
                    key={`${extra.provider}-${extra.key}`}
                    type="button"
                    onClick={() => setExtraVideo({ key: extra.key, name: extra.name })}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-secondary/50 px-3 py-2 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-surface-secondary"
                  >
                    <Video size={13} className="text-muted" aria-hidden />
                    <span className="max-w-56 truncate">{extra.name}</span>
                    <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted">
                      {extra.type}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

        </div>

        {(cast?.length || (item.kind !== "series" && file)) && (
          <aside className="h-fit space-y-5">
            {cast && cast.length > 0 && (
            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <Users size={13} className="text-muted" aria-hidden />
                  <h2 className="text-[12px] font-bold tracking-[-0.01em] text-foreground">Top cast</h2>
                </div>
                {cast.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setCastExpanded((v) => !v)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                  >
                    {castExpanded ? "Show less" : `View all (${cast.length})`}
                  </button>
                )}
              </header>

              <ul className="p-1.5">
                {(castExpanded ? cast : cast.slice(0, 6)).map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/person/$personId"
                      params={{ personId: String(c.id) }}
                      className="group flex min-w-0 items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-secondary/60"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-surface-secondary">
                        {c.photo ? (
                          <img
                            src={artworkUrl(c.photo) ?? ""}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-muted">
                            {c.name[0]}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-semibold text-foreground">{c.name}</p>
                        {c.character && <p className="truncate text-[10px] text-muted">{c.character}</p>}
                      </div>
                      <ChevronRight size={12} className="shrink-0 text-muted/0 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-muted/70" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {item.kind !== "series" && file && (
            <section className="panel p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <HardDrive size={13} className="text-muted" aria-hidden />
                <h2 className="text-[12px] font-bold tracking-[-0.01em] text-foreground">Details</h2>
              </div>

              <dl className="mt-3 divide-y divide-border/55 text-[11.5px]">
                {file.width && file.height && (
                  <DetailRow
                    label="Resolution"
                    value={file.height >= 2160 ? "4K UHD" : file.height >= 1080 ? "1080p" : `${file.width}×${file.height}`}
                  />
                )}
                {file.videoCodec && (
                  <DetailRow label="Video" value={`${file.videoCodec.toUpperCase()}${file.videoProfile ? ` · ${file.videoProfile}` : ""}`} />
                )}
                {file.container && <DetailRow label="Container" value={file.container.toUpperCase()} />}
                {file.audio && file.audio.length > 0 && (
                  <DetailRow
                    label="Audio"
                    value={file.audio.map((a) => [a.codec.toUpperCase(), a.language].filter(Boolean).join(" · ")).join(", ")}
                  />
                )}
                {file.subtitleCount ? <DetailRow label="Subtitles" value={`${file.subtitleCount} tracks`} /> : null}
                {file.size ? <DetailRow label="File size" value={`${(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB`} /> : null}
                {file.duration ? <DetailRow label="Duration" value={`${Math.round(file.duration / 60)} min`} /> : null}
              </dl>
            </section>
          )}
          </aside>
        )}
      </div>

      <TrailerModal
        open={trailerOpen || extraVideo !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTrailerOpen(false);
            setExtraVideo(null);
          }
        }}
        trailerKey={extraVideo?.key ?? trailer?.key ?? null}
        title={extraVideo?.name ?? item.name}
      />

      <CollectionPicker
        item={item}
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
      />

      {file?.fileId && (
        <SubtitleSearchModal
          fileId={file.fileId}
          title={item.name}
          open={subtitleOpen}
          onOpenChange={setSubtitleOpen}
        />
      )}

      <FixMatchModal
        open={fixMatchOpen}
        onOpenChange={setFixMatchOpen}
        itemId={item.id}
        initialTitle={item.name}
        initialYear={item.year}
        kind={item.kind}
        currentTmdbId={item.tmdbId}
      />

      <Modal isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="w-[min(94vw,520px)]">
              <Modal.Header>
                <Modal.Heading>Remove “{item.name}” and its video files?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm leading-relaxed text-muted">
                  The original video files move to the system Trash and the title is removed from Plexy. If the
                  recycle bin is disabled in server settings, they are deleted permanently instead.
                  {item.kind === "series" ? " The files for its episodes are removed too." : ""}
                </p>
                {deleteMutation.isError && (
                  <p role="alert" className="mt-3 text-sm text-danger-soft-foreground">{deleteMutation.error.message}</p>
                )}
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2">
                <Button variant="ghost" onPress={() => setDeleteOpen(false)} isDisabled={deleteMutation.isPending}>
                  Cancel
                </Button>
                <Button variant="danger" onPress={() => deleteMutation.mutate()} isDisabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? "Removing…" : "Remove title and files"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
