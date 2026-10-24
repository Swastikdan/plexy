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
  Sparkles,
  PlayCircle,
  ArrowLeft,
} from "lucide-react";
import { queries } from "../../queries";
import { api, probeBrowserCaps, type TitleDetail } from "../../client";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TrailerModal } from "../../components/trailer-modal";
import { FixMatchModal } from "../../components/fix-match-modal";
import { cx } from "../../components/ui/button";

// Capabilities do not change during a session; probing once keeps hover
// prefetches free of layout work.
const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

function TitleRoute() {
  const { itemId } = useParams({ from: Route.id });
  const id = Number(itemId);
  const { data, isLoading, isError, refetch } = useQuery(queries.title(id));

  if (isLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-6 sm:px-8">
        <div className="aspect-[21/9] max-h-[500px] w-full animate-pulse rounded-[var(--radius-hero)] bg-surface" />
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
      <DetailView detail={data} itemId={id} onRefresh={() => refetch()} />
    </main>
  );
}

export const Route = createFileRoute("/title/$itemId")({ component: TitleRoute });

function DetailView({
  detail,
  itemId,
  onRefresh,
}: {
  detail: TitleDetail;
  itemId: number;
  onRefresh: () => void;
}) {
  const { item, metadata, cast, trailer, seasons, episodes, file, logo, unmatched, matchReason } = detail;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [fixMatchOpen, setFixMatchOpen] = useState(false);

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

  // Watch state mutation
  const markWatchedMutation = useMutation({
    mutationFn: (watched: boolean) => api.markWatched(item.id, watched),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title", item.id] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });

  // Metadata refresh mutation
  const refreshMutation = useMutation({
    mutationFn: () => api.refreshItem(item.id),
    onSuccess: () => {
      onRefresh();
      queryClient.invalidateQueries({ queryKey: ["home"] });
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
      <section className="relative overflow-hidden rounded-[var(--radius-hero)] border border-line/60 bg-surface">
        <div className="relative aspect-[16/9] max-h-[540px] w-full sm:aspect-[21/9]">
          <img
            src={item.backdrop ?? item.poster ?? ""}
            alt=""
            fetchPriority="high"
            loading="eager"
            decoding="async"
            className="h-full w-full object-cover object-top"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/50 to-transparent"
            aria-hidden
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/70 to-transparent"
            aria-hidden
          />
        </div>

        <div className="absolute bottom-0 left-0 max-w-3xl p-6 sm:p-12">
          {item.kind === "episode" && item.parentId && (
            <Link
              to="/title/$itemId"
              params={{ itemId: String(item.parentId) }}
              className="mb-3 inline-flex items-center gap-1.5 rounded-none bg-black/70 px-3 py-1 text-xs font-semibold text-white/90 transition-colors hover:bg-black/85 hover:text-white"
            >
              <ArrowLeft size={13} />
              Back to {item.parentTitle || "Series"}
            </Link>
          )}

          {logo ? (
            <img
              src={logo}
              alt={item.name}
              className="mb-4 max-h-20 max-w-[340px] object-contain"
            />
          ) : (
            <h1 className="font-display text-3xl font-black leading-tight text-ink sm:text-5xl">
              {item.name}
            </h1>
          )}

          {metadata?.tagline && (
            <p className="mt-2 max-w-[60ch] text-sm italic text-ink-muted">{metadata.tagline}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-ink-muted">
            {item.year && <span className="font-medium text-ink">{item.year}</span>}
            {item.kind === "episode" && item.seasonNumber != null && item.episodeNumber != null && (
              <span className="rounded bg-canvas/60 px-2 py-0.5 text-xs font-bold text-ink">
                S{item.seasonNumber} E{item.episodeNumber}
              </span>
            )}
            {metadata?.runtime && <span>{metadata.runtime} min</span>}
            {metadata?.certification && (
              <span className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-bold text-ink">
                {metadata.certification}
              </span>
            )}
            {item.rating && (
              <span className="flex items-center gap-1 font-semibold text-amber">
                ★ {item.rating.toFixed(1)}
              </span>
            )}
            {metadata?.genres.slice(0, 4).map((g) => (
              <span
                key={g}
              className="rounded-none bg-canvas/70 px-2.5 py-0.5 text-xs text-ink"
              >
                {g}
              </span>
            ))}
          </div>

          {/* Unmatched / review notice */}
          {unmatched && item.kind !== "episode" && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
              <Sparkles size={18} className="shrink-0" />
              <span>
                Not identified yet{matchReason ? `: ${matchReason}` : ""}.
              </span>
              <Button
                variant="brand"
                onClick={() => setFixMatchOpen(true)}
                className="ml-auto h-8 px-3 text-xs font-semibold"
              >
                Fix Match
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {(file || (item.kind === "series" && episodes && episodes.length > 0)) && (
              <Button
                variant="primary"
                onClick={handlePrimaryPlay}
                onPointerEnter={() => prefetchPlay(primaryFileId)}
                onFocus={() => prefetchPlay(primaryFileId)}
                className="h-11 px-6 text-sm font-bold"
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
                className="h-11 px-4 text-sm font-semibold"
              >
                <Video size={18} />
                Trailer
              </Button>
            )}

            <Button
              variant="secondary"
              onClick={() => markWatchedMutation.mutate(!isPlayed)}
              disabled={markWatchedMutation.isPending}
              className="h-11 px-4 text-sm font-semibold"
              title={isPlayed ? "Mark as unwatched" : "Mark as watched"}
            >
              {isPlayed ? (
                <>
                  <CheckCircle2 size={18} className="text-brand-text" />
                  Watched
                </>
              ) : (
                <>
                  <Circle size={18} />
                  Mark Watched
                </>
              )}
            </Button>

            {item.kind !== "episode" && (
              <Button
                variant="ghost"
                onClick={() => setFixMatchOpen(true)}
                className="h-11 px-4 text-sm text-ink-muted hover:text-ink"
                title="Search and assign the correct TMDB match"
              >
                <Wrench size={16} />
                Fix Match
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || unmatched}
              className="h-11 px-4 text-sm text-ink-muted hover:text-ink"
              title={unmatched ? "Match this title first, then refresh metadata" : "Refresh metadata"}
            >
              <RotateCw size={16} className={refreshMutation.isPending ? "animate-spin" : ""} />
            </Button>
          </div>

          {refreshMutation.isError && (
            <p className="mt-3 text-sm text-red-400">{refreshMutation.error.message}</p>
          )}
          {refreshMutation.isSuccess && (
            <p className="mt-3 text-sm text-ink-muted">Metadata refreshed from TMDB.</p>
          )}
        </div>
      </section>

      {/* Main grid: synopsis / episodes / cast on the left, technical specs on the right */}
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
                <div className="space-y-3">
                  {filteredEpisodes.map((ep, idx) => {
                    const epNum = ep.episodeNumber ?? idx + 1;
                    const displayTitle = ep.name.replace(/^S\d+E\d+\s*[·\-:]\s*/i, "");
                    const targetFileId = ep.fileId ?? ep.id;

                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onPointerEnter={() => prefetchPlay(targetFileId)}
                        onFocus={() => prefetchPlay(targetFileId)}
                        onClick={() => {
                          navigate({
                            to: "/watch/$fileId",
                            params: { fileId: String(targetFileId) },
                          });
                        }}
                        className="group flex w-full flex-col items-start gap-4 rounded-xl border border-line/60 bg-surface p-4 text-left transition-[border-color,background-color] hover:border-line hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand sm:flex-row sm:items-center"
                      >
                        {/* Episode number */}
                        <div className="hidden w-8 shrink-0 justify-center font-display text-xl font-bold text-ink-muted transition-colors group-hover:text-ink sm:flex">
                          {epNum}
                        </div>

                        {/* Episode thumbnail */}
                        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:w-56">
                          {ep.poster ? (
                            <img
                              src={ep.poster}
                              alt={displayTitle}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center font-display text-xs text-ink-muted bg-gradient-to-t from-black/60 to-transparent">
                              <span>Episode {epNum}</span>
                            </div>
                          )}

                          {/* Play affordance */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <div className="flex h-11 w-11 items-center justify-center rounded-none bg-white text-black transition-transform group-hover:scale-110">
                              <Play size={20} className="ml-0.5" fill="currentColor" />
                            </div>
                          </div>

                          {/* Duration tag */}
                          {ep.runtime && (
                            <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {ep.runtime}m
                            </div>
                          )}

                          {/* Watch progress */}
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
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="truncate text-base font-semibold text-ink transition-colors group-hover:text-ink">
                              <span className="mr-2 font-bold text-ink-muted sm:hidden">{epNum}.</span>
                              {displayTitle}
                            </h3>
                            {ep.runtime && (
                              <span className="hidden shrink-0 text-xs font-medium text-ink-muted sm:inline-block">
                                {ep.runtime} min
                              </span>
                            )}
                          </div>

                          {ep.overview ? (
                            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">
                              {ep.overview}
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-ink-muted">
                              No episode description available.
                            </p>
                          )}
                        </div>
                      </button>
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

          {/* Cast */}
          {cast && cast.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                  Top Cast
                </h2>
                {cast.length > 6 && (
                  <button
                    onClick={() => setCastExpanded((v) => !v)}
                    className="text-xs text-ink-muted transition-colors hover:text-ink"
                  >
                    {castExpanded ? "Show Less" : `View All (${cast.length})`}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(castExpanded ? cast : cast.slice(0, 6)).map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface p-2.5"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-none bg-surface-2">
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
            </div>
          )}
        </div>

        {/* Right column: technical media details (PRD 5.6, 10.3) */}
        {file && (
          <aside className="h-fit space-y-6 rounded-2xl border border-line bg-surface p-6">
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
    </div>
  );
}
