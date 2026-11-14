/// Title Detail (PRD 10.3): movie & series detail, seasons, episodes, trailer, playability specs, cast & fix match.
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
  PlayCircle,
  ArrowLeft,
  Trash2,
  Eye,
  Bookmark,
  Star,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";
import { queries } from "../../queries";
import { api, probeBrowserCaps, type TitleDetail } from "../../client";
import { Button, Dropdown, ListBox, Modal, Select } from "@heroui/react";
import { TrailerModal } from "../../components/trailer-modal";
import { FixMatchModal } from "../../components/fix-match-modal";
import { PlayerEngineChip } from "../../components/player-engine-chip";
import { cx } from "../../lib/cx";
import { PageLoader } from "../../components/page-loader";
import { artworkUrl } from "../../lib/artwork-url";
import { useStoredFlag } from "../../lib/use-stored-flag";

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

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatDate(dateStr?: string | null, year?: number | null): string {
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      }
    } catch {}
  }
  return year ? String(year) : "";
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
          <h2 className="font-display text-xl font-bold text-foreground">Title not found</h2>
          <p className="text-sm text-muted">The requested title could not be loaded from Plexy.</p>
          <Link to="/">
            <Button className="mt-4">
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
  const watchPercent = Math.min(100, Math.max(0, activeWatch?.percent ?? 0));

  const [inWatchlist, toggleWatchlist] = useStoredFlag(`plexy:watchlist:${item.id}`);
  const [isFavorite, toggleFavorite] = useStoredFlag(`plexy:favorite:${item.id}`);

  const displayRuntime = activeEpisode?.runtime || metadata?.runtime || null;
  const displayDate = formatDate((activeEpisode as any)?.airDate, item.year);
  const displayCert = metadata?.certification || null;
  const displayGenres = metadata?.genres.slice(0, 3).join(", ");
  const displayOverview = activeEpisode?.overview || metadata?.overview || item.overview || null;

  const rating = item.rating ?? metadata?.rating ?? null;
  const tmdbScore = rating == null ? null : Math.round(rating * 10);

  const resolutionBadge = file?.height
    ? file.height >= 2160
      ? "4K"
      : file.height >= 1080
        ? "1080p"
        : file.height >= 720
          ? "720p"
          : "SD"
    : "1080p";

  // Warm the player manifest (and therefore the stream) as soon as the pointer
  // lands on a play control, so the navigation has nothing left to wait for.
  const prefetchPlay = (fileId: number | null | undefined) => {
    if (!fileId || !BROWSER_CAPS) return;
    void queryClient.prefetchQuery(queries.play(fileId, BROWSER_CAPS));
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
    <div className="space-y-10">
      <section className="relative isolate min-h-[540px] sm:min-h-[620px] lg:h-[min(76vh,860px)] overflow-hidden rounded-3xl bg-surface flex flex-col justify-end border border-border/50 shadow-sm">
        <img
          src={artworkUrl(item.backdrop ?? item.poster) ?? ""}
          alt={item.name}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[center_24%] sm:object-[center_28%] transition-transform duration-700 ease-out hover:scale-102"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        <div
          className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/35 via-38% to-transparent dark:from-background dark:via-background/90 dark:via-40% pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute inset-0 hidden sm:block bg-gradient-to-r from-background/92 via-background/55 via-42% to-transparent dark:from-background/95 dark:via-background/70 dark:via-50% pointer-events-none"
          aria-hidden
        />
        {/* Light theme keeps the artwork visible, so the mark and controls get
            their own dark scrim instead of a white veil over a white logo. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[430px] max-w-[70%] bg-gradient-to-r from-black/60 via-black/25 to-transparent dark:hidden"
          aria-hidden
        />

        <div className="relative z-10 w-full p-5 sm:p-8 lg:p-12 page-enter">
          {item.kind === "episode" && item.parentId && (
            <Link
              to="/title/$itemId"
              params={{ itemId: item.parentPublicId ?? String(item.parentId) }}
              className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface/85 backdrop-blur-md border border-border px-3.5 py-1 text-xs font-semibold text-foreground transition-all hover:bg-surface-secondary active:scale-95 shadow-xs"
            >
              <ArrowLeft size={13} />
              Back to {item.parentTitle || "Series"}
            </Link>
          )}

          {unmatched && item.kind !== "episode" && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 px-4 py-2 text-sm text-warning-soft-foreground">
              <Sparkles size={16} className="shrink-0" />
              <span className="text-xs sm:text-sm">
                Not identified yet{matchReason ? `: ${matchReason}` : ""}.
              </span>
              <Button
                variant="secondary"
                onPress={() => setFixMatchOpen(true)}
                className="ml-auto h-7 px-3 text-xs font-semibold"
              >
                Fix Match
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] lg:grid-cols-[340px_1fr] xl:grid-cols-[380px_1fr] gap-6 sm:gap-10 items-end">
            <div className="flex flex-col space-y-4 sm:space-y-5">
              {logo ? (
                <img
                  src={logo}
                  alt={item.name}
                  className="max-h-16 sm:max-h-24 max-w-[240px] sm:max-w-[300px] object-contain object-left drop-shadow-[0_2px_14px_rgba(0,0,0,0.55)] dark:drop-shadow-md"
                />
              ) : (
                <h1 className="font-sans text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.55)]">
                  {item.name}
                </h1>
              )}

              {(file || (item.kind === "series" && episodes && episodes.length > 0)) && (
                <button
                  type="button"
                  onClick={handlePrimaryPlay}
                  onPointerEnter={() => prefetchPlay(primaryFileId)}
                  onFocus={() => prefetchPlay(primaryFileId)}
                  className={cx(
                    "group relative overflow-hidden inline-flex items-center justify-center rounded-xl h-11 w-full max-w-[280px] sm:max-w-[300px] select-none",
                    "font-semibold transition-all duration-150 ease-out shadow-md active:scale-[0.98]",
                    hasResume
                      ? "bg-surface-secondary hover:bg-surface-tertiary text-foreground border border-border"
                      : isPlayed
                        ? "bg-surface hover:bg-surface-secondary text-foreground border border-border"
                        : "bg-foreground hover:bg-foreground/90 text-background",
                  )}
                >
                  {hasResume ? (
                    <>
                      <span className="relative z-10 flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-foreground">
                        <Play size={15} fill="currentColor" />
                        <span>Resume {formatTime(resumePos)}</span>
                      </span>
                      {/* A slim progress bar reads cleanly in both themes; the
                          old full-height fill looked like a broken black pill
                          against the light surface. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-2.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-foreground/15"
                      >
                        <span
                          className="block h-full rounded-full bg-accent transition-all duration-300"
                          style={{ width: `${Math.max(2, watchPercent)}%` }}
                        />
                      </span>
                    </>
                  ) : isPlayed ? (
                    <span className="relative z-10 flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-foreground">
                      <RotateCcw size={15} />
                      <span>Watch again</span>
                    </span>
                  ) : (
                    <span className="relative z-10 flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-background">
                      <Play size={15} fill="currentColor" />
                      <span>Play</span>
                    </span>
                  )}
                </button>
              )}

              <div className="flex items-center gap-2">
                <Button
                  isIconOnly
                  variant="ghost"
                  onPress={() => watchMutation.mutate({ itemId: activeEpisode?.id ?? item.id, played: !isPlayed })}
                  isDisabled={watchMutation.isPending || clearWatchMutation.isPending}
                  aria-label={isPlayed ? "Mark as unwatched" : "Mark as watched"}
                  className="rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md hover:bg-surface-secondary shadow-2xs"
                >
                  {isPlayed ? <CheckCircle2 size={16} className="text-accent" /> : <Eye size={16} />}
                </Button>

                <Button
                  isIconOnly
                  variant="ghost"
                  onPress={toggleWatchlist}
                  aria-label={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                  className={cx(
                    "rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md hover:bg-surface-secondary shadow-2xs",
                    inWatchlist && "text-accent bg-surface-secondary",
                  )}
                >
                  <Bookmark size={16} fill={inWatchlist ? "currentColor" : "none"} />
                </Button>

                <Button
                  isIconOnly
                  variant="ghost"
                  onPress={toggleFavorite}
                  aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  className={cx(
                    "rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md hover:bg-surface-secondary shadow-2xs",
                    isFavorite && "text-warning bg-surface-secondary",
                  )}
                >
                  <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                </Button>

                {trailer ? (
                  <Button
                    isIconOnly
                    variant="ghost"
                    onPress={() => setTrailerOpen(true)}
                    aria-label="Watch trailer"
                    className="rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md hover:bg-surface-secondary shadow-2xs"
                  >
                    <Video size={16} />
                  </Button>
                ) : (
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label="Collection"
                    className="rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md hover:bg-surface-secondary shadow-2xs"
                  >
                    <FolderPlus size={16} />
                  </Button>
                )}

                <Dropdown>
                  <Dropdown.Trigger
                    aria-label="More options"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/80 text-foreground backdrop-blur-md transition-all hover:bg-surface-secondary active:scale-95 shadow-2xs"
                  >
                    <MoreHorizontal size={16} />
                  </Dropdown.Trigger>
                  <Dropdown.Popover placement="bottom start">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === "fix-match") setFixMatchOpen(true);
                        else if (key === "refresh") refreshMutation.mutate();
                        else if (key === "clear-watch") clearWatchMutation.mutate(item.id);
                        else if (key === "delete") setDeleteOpen(true);
                      }}
                    >
                      {item.kind !== "episode" && (
                        <Dropdown.Item id="fix-match" textValue="Fix TMDB match">
                          <Wrench size={14} className="shrink-0 text-muted" />
                          <span>Fix TMDB match</span>
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
                      <Dropdown.Section>
                        <Dropdown.Item
                          id="delete"
                          textValue="Remove title and files"
                          className="text-danger-soft-foreground"
                        >
                          <Trash2 size={14} className="shrink-0" />
                          <span>Remove title and files</span>
                        </Dropdown.Item>
                      </Dropdown.Section>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>

              <PlayerEngineChip />
            </div>

            <div className="flex flex-col justify-end space-y-3 pb-1">
              <h2 className="font-sans text-xl sm:text-2xl font-bold tracking-tight text-foreground drop-shadow-sm">
                {item.kind === "series" && activeEpisode ? (
                  <>
                    {episodeDisplayTitle(activeEpisode.name, activeEpisode.episodeNumber ?? 1)}
                  </>
                ) : (
                  metadata?.tagline || item.name
                )}
              </h2>

              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-xs text-muted">
                {item.kind === "series" && activeEpisode && (
                  <span className="font-semibold text-foreground">
                    Episode {activeEpisode.episodeNumber ?? 1}
                  </span>
                )}
                {displayRuntime && (
                  <span className="font-medium text-foreground/85">{displayRuntime} min</span>
                )}
                {displayDate && (
                  <span className="text-muted">{displayDate}</span>
                )}
                {displayCert && (
                  <span className="rounded-md border border-border bg-surface-secondary/70 px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                    {displayCert}
                  </span>
                )}
                <span className="rounded-md border border-border bg-surface-secondary/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                  {resolutionBadge}
                </span>
                {displayGenres && (
                  <span className="text-muted">{displayGenres}</span>
                )}
              </div>

              {displayOverview && (
                <p className="max-w-2xl text-xs sm:text-sm leading-relaxed text-muted line-clamp-3 sm:line-clamp-4">
                  {displayOverview}
                </p>
              )}

              {/* TMDB user score, the only rating the server actually stores. */}
              {tmdbScore !== null && (
                <div className="flex items-center gap-1.5 font-bold text-xs" title="TMDB User Score">
                  <span className="rounded-xs bg-[#01b4e4] px-1 py-0.5 text-[9px] font-black uppercase text-black leading-none">
                    TMDB
                  </span>
                  <span className="text-foreground font-semibold tabular-nums">{tmdbScore}%</span>
                </div>
              )}
            </div>
          </div>

          {refreshMutation.isError && (
            <p className="mt-2.5 text-xs text-danger-soft-foreground">{refreshMutation.error.message}</p>
          )}
          {refreshMutation.isSuccess && (
            <p className="mt-2.5 text-xs text-success-soft-foreground">Metadata refreshed from TMDB.</p>
          )}
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-10">
          {item.overview && (
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
                Synopsis
              </h2>
              <p className="mt-3 max-w-[75ch] text-base leading-relaxed text-muted">
                {item.overview}
              </p>
            </div>
          )}

          {/* Series: seasons & episodes (PRD 10.3) */}
          {item.kind === "series" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-foreground">Episodes</h2>
                  <span className="text-xs text-muted">
                    {filteredEpisodes.length} {filteredEpisodes.length === 1 ? "episode" : "episodes"}
                  </span>
                </div>

                {seasonList.length > 1 && (
                  <Select
                    aria-label="Season"
                    selectedKey={String(selectedSeason)}
                    onSelectionChange={(key) => setSelectedSeason(Number(key))}
                    className="min-w-40"
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {seasonList.map((s) => (
                          <ListBox.Item
                            key={s.number}
                            id={String(s.number)}
                            textValue={s.name || `Season ${s.number}`}
                          >
                            {s.name || `Season ${s.number}`}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
              </div>

              {filteredEpisodes.length > 0 ? (
                <div className="space-y-2.5">
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
                          "transition-all duration-150 ease-out hover:border-border hover:bg-surface-tertiary/80 active:scale-[0.99]",
                          played ? "border-border/40 opacity-80 hover:opacity-100" : "border-border/70",
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
                              state: { playerFromTitle: true },
                            });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-lg"
                        >
                          <div className="hidden sm:flex w-6 shrink-0 justify-center font-display text-xs font-semibold tabular-nums text-muted/70 transition-colors group-hover:text-foreground">
                            {String(epNum).padStart(2, "0")}
                          </div>

                          <div className="relative aspect-video w-24 min-[400px]:w-32 sm:w-40 md:w-44 shrink-0 overflow-hidden rounded-lg bg-surface-secondary border border-border/50">
                            {ep.poster || ep.backdrop ? (
                              <img
                                src={artworkUrl(ep.poster ?? ep.backdrop) ?? ""}
                                alt={displayTitle}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center p-2 font-display text-[10px] text-muted text-center bg-gradient-to-t from-black/60 to-transparent">
                                <span className="line-clamp-2">{displayTitle}</span>
                              </div>
                            )}

                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-2xs transition-opacity duration-150 group-hover:opacity-100">
                              <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white text-black shadow-md transition-transform duration-150 group-hover:scale-105 active:scale-95">
                                <Play size={14} className="ml-0.5" fill="currentColor" />
                              </div>
                            </div>

                            {ep.runtime && (
                              <div className="absolute bottom-1 right-1 rounded-md bg-black/80 px-1 py-0.2 text-[9px] font-semibold text-white/90">
                                {ep.runtime}m
                              </div>
                            )}

                            {ep.watch && ep.watch.percent > 0 && (
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60 overflow-hidden">
                                <div
                                  className="h-full bg-accent"
                                  style={{ width: `${Math.min(100, Math.max(2, ep.watch.percent))}%` }}
                                />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 py-0.5">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-xs sm:text-sm font-semibold text-foreground transition-colors group-hover:text-foreground">
                                {displayTitle}
                              </h3>
                              {ep.runtime && (
                                <span className="hidden sm:inline-block shrink-0 text-[11px] font-medium text-muted/80">
                                  · {ep.runtime} min
                                </span>
                              )}
                            </div>

                            {ep.overview ? (
                              <p className="mt-1 line-clamp-1 min-[420px]:line-clamp-2 text-[11px] sm:text-xs leading-relaxed text-muted">
                                {ep.overview}
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] text-muted/60 italic">
                                No description available.
                              </p>
                            )}

                            <div className="mt-1 text-[11px] font-medium text-muted">
                              Episode {epNum}
                            </div>
                          </div>
                        </button>

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
                                ? "text-muted hover:bg-accent/10"
                                : "text-muted hover:text-foreground hover:bg-surface-secondary",
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
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-all hover:bg-danger/10 hover:text-danger-soft-foreground active:scale-95 disabled:opacity-50"
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
                <p className="py-4 text-sm text-muted">
                  No individual episode records indexed for this season yet.
                </p>
              )}
            </div>
          )}

        </div>

        {(cast?.length || file) && (
          <aside className="h-fit space-y-6">
            {cast && cast.length > 0 && (
              <section className="space-y-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
                    Top Cast
                  </h2>
                  {cast.length > 6 && (
                    <button
                      onClick={() => setCastExpanded((v) => !v)}
                      className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
                    >
                      {castExpanded ? "Show Less" : `View All (${cast.length})`}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {(castExpanded ? cast : cast.slice(0, 6)).map((c) => (
                    <Link
                      key={c.id}
                      to="/person/$personId"
                      params={{ personId: String(c.id) }}
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-background/50 p-2.5 transition-colors hover:border-border hover:bg-surface-secondary"
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-secondary">
                        {c.photo ? (
                          <img
                            src={artworkUrl(c.photo) ?? ""}
                            alt={c.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-muted">
                            {c.name[0]}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 inline-block align-top">
                        <p className="truncate text-xs font-semibold text-foreground">{c.name}</p>
                        {c.character && (
                          <p className="truncate text-[11px] text-muted">{c.character}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {file && <section className="h-fit space-y-6 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
              <h3 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-muted">
                Media Details
              </h3>
              <dl className="space-y-2.5 text-xs">
                {file.width && file.height && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Resolution</dt>
                    <dd className="font-medium text-foreground">
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
                    <dt className="text-muted">Video Codec</dt>
                    <dd className="font-medium uppercase text-foreground">
                      {file.videoCodec} {file.videoProfile ? `(${file.videoProfile})` : ""}
                    </dd>
                  </div>
                )}

                {file.container && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Container</dt>
                    <dd className="font-medium uppercase text-foreground">{file.container}</dd>
                  </div>
                )}

                {file.audio && file.audio.length > 0 && (
                  <div className="flex items-baseline justify-between gap-6">
                    <dt className="shrink-0 text-muted">Audio</dt>
                    <dd className="text-right font-medium text-foreground">
                      {file.audio
                        .map((a) => [a.codec.toUpperCase(), a.language].filter(Boolean).join(" · "))
                        .join(", ")}
                    </dd>
                  </div>
                )}

                {file.subtitleCount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Subtitles</dt>
                    <dd className="font-medium text-foreground">{file.subtitleCount} tracks</dd>
                  </div>
                )}

                {file.size > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">File Size</dt>
                    <dd className="font-medium tabular-nums text-foreground">
                      {(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                    </dd>
                  </div>
                )}

                {file.duration && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Duration</dt>
                    <dd className="font-medium tabular-nums text-foreground">{Math.round(file.duration / 60)} min</dd>
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
                <Button
                  variant="ghost"
                  onPress={() => setDeleteOpen(false)}
                  isDisabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onPress={() => deleteMutation.mutate()}
                  isDisabled={deleteMutation.isPending}
                >
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
