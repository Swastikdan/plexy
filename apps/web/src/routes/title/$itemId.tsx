/// Title Detail (PRD 10.3): Movie & Series detail, seasons, episodes, trailer, playability specs, cast & fix match.
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
  Clock,
  Film,
  Tv,
  Sparkles,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import { queries } from "../../queries";
import { api, type ItemCard, type TitleDetail } from "../../client";
import { Button } from "../../components/ui/button";
import { TrailerModal } from "../../components/trailer-modal";
import { FixMatchModal } from "../../components/fix-match-modal";

function TitleRoute() {
  const { itemId } = useParams({ from: Route.id });
  const id = Number(itemId);
  const { data, isLoading, isError, refetch } = useQuery(queries.title(id));

  if (isLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-6 sm:px-8">
        <div className="aspect-[21/9] max-h-[500px] w-full animate-pulse rounded-[var(--radius-hero)] bg-[#1c1c1c]" />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-16 sm:px-8">
        <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
          <h2 className="font-display text-xl font-bold text-white">Title not found</h2>
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

  const filteredEpisodes = episodes
    ? episodes.filter((ep) => {
        if (ep.seasonNumber != null) {
          return ep.seasonNumber === selectedSeason;
        }
        return selectedSeason === 1;
      })
    : [];

  const handlePrimaryPlay = () => {
    if (item.kind === "series" && episodes && episodes.length > 0) {
      const targetEp = filteredEpisodes.find((e) => !e.watch?.played) ?? filteredEpisodes[0] ?? episodes[0];
      const playId = targetEp.fileId ?? targetEp.id;
      if (playId) {
        navigate({ to: "/watch/$fileId", params: { fileId: String(playId) } });
        return;
      }
    }
    const targetFile = file?.fileId ?? item.fileId ?? item.id;
    if (targetFile) {
      navigate({ to: "/watch/$fileId", params: { fileId: String(targetFile) } });
    }
  };

  return (
    <div className="space-y-10">
      {/* Detail Hero Banner */}
      <section className="relative overflow-hidden rounded-[var(--radius-hero)] border border-white/5 bg-[#181818] shadow-2xl">
        <div className="relative aspect-[16/9] max-h-[540px] w-full sm:aspect-[21/9]">
          <img
            src={item.backdrop ?? item.poster ?? ""}
            alt=""
            className="h-full w-full object-cover object-top"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/50 to-transparent"
            aria-hidden
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/70 to-transparent"
            aria-hidden
          />
        </div>

        <div className="absolute bottom-0 left-0 max-w-3xl p-6 sm:p-12">
          {item.kind === "episode" && item.parentId && (
            <Link
              to="/title/$itemId"
              params={{ itemId: String(item.parentId) }}
              className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-md hover:bg-black/80 hover:text-[#E50914] transition-all"
            >
              <ArrowLeft size={13} />
              Back to {item.parentTitle || "Series"}
            </Link>
          )}

          {logo ? (
            <img
              src={logo}
              alt={item.name}
              className="mb-4 max-h-20 max-w-[340px] object-contain drop-shadow-lg"
            />
          ) : (
            <h1 className="font-display text-3xl font-black leading-tight text-white sm:text-5xl drop-shadow-md">
              {item.name}
            </h1>
          )}

          {metadata?.tagline && (
            <p className="mt-2 text-sm italic text-ink-muted">{metadata.tagline}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-ink-muted">
            {item.year && <span className="font-medium text-white">{item.year}</span>}
            {item.kind === "episode" && item.seasonNumber != null && item.episodeNumber != null && (
              <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-bold text-white">
                S{item.seasonNumber} E{item.episodeNumber}
              </span>
            )}
            {metadata?.runtime && <span>{metadata.runtime} min</span>}
            {metadata?.certification && (
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[11px] font-bold text-white">
                {metadata.certification}
              </span>
            )}
            {item.rating && (
              <span className="flex items-center gap-1 font-semibold text-amber-400">
                ★ {item.rating.toFixed(1)}
              </span>
            )}
            {metadata?.genres.slice(0, 4).map((g) => (
              <span
                key={g}
                className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white backdrop-blur-sm"
              >
                {g}
              </span>
            ))}
          </div>

          {/* Unmatched / Review warning notice */}
          {unmatched && item.kind !== "episode" && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
              <Sparkles size={18} className="shrink-0" />
              <span>
                Not identified yet {matchReason ? `— ${matchReason}` : "— Fix match to attach TMDB artwork and details."}
              </span>
              <Button
                variant="amber"
                onClick={() => setFixMatchOpen(true)}
                className="ml-auto h-7 px-3 text-xs"
              >
                Fix Match
              </Button>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {(file || (item.kind === "series" && episodes && episodes.length > 0)) && (
              <Button
                variant="primary"
                onClick={handlePrimaryPlay}
                className="h-11 px-7 text-base font-bold shadow-lg"
              >
                <Play size={18} fill="currentColor" />
                {hasResume ? `Resume (${item.watch?.percent}%)` : "Play"}
              </Button>
            )}

            {trailer && (
              <Button
                variant="secondary"
                onClick={() => setTrailerOpen(true)}
                className="h-11 px-5 text-sm font-semibold"
              >
                <Video size={18} />
                Trailer
              </Button>
            )}

            <Button
              variant="secondary"
              onClick={() => markWatchedMutation.mutate(!isPlayed)}
              disabled={markWatchedMutation.isPending}
              className="h-11 px-4 text-sm"
              title={isPlayed ? "Mark as unwatched" : "Mark as watched"}
            >
              {isPlayed ? (
                <>
                  <CheckCircle2 size={18} className="text-[#E50914]" />
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
                variant="secondary"
                onClick={() => setFixMatchOpen(true)}
                className="h-11 px-4 text-sm"
                title="Search and assign TMDB match"
              >
                <Wrench size={16} />
                Fix Match
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="h-11 px-3 text-ink-muted hover:text-white"
              title="Refresh metadata"
            >
              <RotateCw size={16} className={refreshMutation.isPending ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>
      </section>

      {/* Main Grid: Details / Episodes on Left + Technical Specs on Right */}
      <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
        {/* Left Column: Synopsis, Seasons & Episodes, Cast */}
        <div className="space-y-10 min-w-0">
          {item.overview && (
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                Synopsis
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[#d9d9d9] max-w-[75ch]">
                {item.overview}
              </p>
            </div>
          )}

          {/* TV Shows: Seasons & Episodes (PRD 10.3) */}
          {item.kind === "series" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
                    <Tv size={22} className="text-[#E50914]" />
                    Episodes
                  </h2>
                  <span className="text-xs text-ink-muted">
                    {filteredEpisodes.length} {filteredEpisodes.length === 1 ? "episode" : "episodes"}
                  </span>
                </div>

                {seasonList.length > 0 && (
                  <div className="relative inline-flex items-center">
                    <select
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(Number(e.target.value))}
                      className="cursor-pointer appearance-none rounded-lg border border-white/20 bg-[#242424] px-4 py-2 pr-9 text-sm font-semibold text-white shadow-lg transition-colors hover:border-white/40 hover:bg-[#2c2c2c] focus:outline-none focus:ring-2 focus:ring-[#E50914]"
                    >
                      {seasonList.map((s) => (
                        <option key={s.number} value={s.number} className="bg-[#1f1f1f] text-white py-1">
                          {s.name || `Season ${s.number}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 text-white/70" />
                  </div>
                )}
              </div>

              {filteredEpisodes.length > 0 ? (
                <div className="space-y-4">
                  {filteredEpisodes.map((ep, idx) => {
                    const epNum = ep.episodeNumber ?? idx + 1;
                    const displayTitle = ep.name.replace(/^S\d+E\d+\s*[·\-:]\s*/i, "");
                    const targetFileId = ep.fileId ?? ep.id;

                    return (
                      <div
                        key={ep.id}
                        onClick={() => {
                          navigate({
                            to: "/watch/$fileId",
                            params: { fileId: String(targetFileId) },
                          });
                        }}
                        className="group relative flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-xl border border-white/5 bg-[#181818] p-4 transition-all hover:border-white/20 hover:bg-[#222222] cursor-pointer"
                      >
                        {/* Episode Number */}
                        <div className="hidden sm:flex w-8 shrink-0 items-center justify-center font-display text-xl font-bold text-ink-muted group-hover:text-white transition-colors">
                          {epNum}
                        </div>

                        {/* Episode Thumbnail */}
                        <div className="relative aspect-video w-full sm:w-56 shrink-0 overflow-hidden rounded-lg bg-[#252525] shadow-md">
                          {ep.poster ? (
                            <img
                              src={ep.poster}
                              alt={displayTitle}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center font-display text-xs text-ink-muted bg-gradient-to-t from-black/60 to-transparent">
                              <span>Episode {epNum}</span>
                            </div>
                          )}

                          {/* Play button overlay */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black shadow-xl transition-transform group-hover:scale-110">
                              <Play size={20} className="ml-0.5" fill="black" />
                            </div>
                          </div>

                          {/* Duration tag */}
                          {ep.runtime && (
                            <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                              {ep.runtime}m
                            </div>
                          )}

                          {/* Red Watch progress bar */}
                          {ep.watch && ep.watch.percent > 0 && (
                            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
                              <div
                                className="h-full bg-[#E50914]"
                                style={{ width: `${Math.min(100, Math.max(2, ep.watch.percent))}%` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Episode Info: Title, duration, synopsis */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="font-semibold text-base text-white group-hover:text-[#E50914] transition-colors truncate">
                              <span className="sm:hidden font-bold mr-2 text-ink-muted">{epNum}.</span>
                              {displayTitle}
                            </h3>
                            {ep.runtime && (
                              <span className="hidden sm:inline-block shrink-0 text-xs font-medium text-ink-muted">
                                {ep.runtime} min
                              </span>
                            )}
                          </div>

                          {ep.overview ? (
                            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#a3a3a3]">
                              {ep.overview}
                            </p>
                          ) : (
                            <p className="mt-2 text-xs italic text-ink-muted">
                              No episode description available.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-ink-muted italic py-4">
                  No individual episode records indexed for this season yet.
                </p>
              )}
            </div>
          )}

          {/* Cast & Crew (PRD 10.3) */}
          {cast && cast.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                  Top Cast
                </h2>
                {cast.length > 6 && (
                  <button
                    onClick={() => setCastExpanded((v) => !v)}
                    className="text-xs text-ink-muted hover:text-white transition-colors"
                  >
                    {castExpanded ? "Show Less" : `View All (${cast.length})`}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(castExpanded ? cast : cast.slice(0, 6)).map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#181818] p-2.5"
                  >
                    <div className="h-10 w-10 shrink-0 rounded-full bg-[#2a2a2a] overflow-hidden">
                      {c.photo ? (
                        <img src={c.photo} alt={c.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-xs font-bold text-ink-muted">
                          {c.name[0]}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{c.name}</p>
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

        {/* Right Column: File Information & Playability Verdict (PRD 5.6, 10.3) */}
        {file && (
          <aside className="h-fit rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-xl space-y-6">
            <div>
              <h2 className="font-display text-xs font-bold uppercase tracking-widest text-ink-muted">
                Playback Compatibility
              </h2>
              <div className="mt-3 flex items-center gap-3 rounded-xl p-3 border border-white/10 bg-white/[0.03]">
                <div
                  className={`flex h-3 w-3 shrink-0 rounded-full ${
                    file.likelyPlayPath === "direct"
                      ? "bg-green-500 shadow-green-500/50 shadow-sm"
                      : file.likelyPlayPath === "remux"
                        ? "bg-blue-500 shadow-blue-500/50 shadow-sm"
                        : file.likelyPlayPath === "transcode"
                          ? "bg-amber-500 shadow-amber-500/50 shadow-sm"
                          : "bg-red-500"
                  }`}
                />
                <div>
                  <p className="text-sm font-bold text-white capitalize">
                    {file.likelyPlayPath === "direct"
                      ? "Direct Play"
                      : file.likelyPlayPath === "remux"
                        ? "Container Remux"
                        : file.likelyPlayPath === "transcode"
                          ? "Server Conversion"
                          : "Unsupported"}
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">{file.likelyPlayReason}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-muted mb-3">
                Media Details
              </h3>
              <dl className="space-y-2.5 text-xs">
                {file.width && file.height && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Resolution</dt>
                    <dd className="font-medium text-white">
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
                    <dd className="font-medium text-white uppercase">
                      {file.videoCodec} {file.videoProfile ? `(${file.videoProfile})` : ""}
                    </dd>
                  </div>
                )}

                {file.container && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Container</dt>
                    <dd className="font-medium text-white uppercase">{file.container}</dd>
                  </div>
                )}

                {file.audio && file.audio.length > 0 && (
                  <div className="flex justify-between items-baseline">
                    <dt className="text-ink-muted">Audio</dt>
                    <dd className="font-medium text-white text-right">
                      {file.audio
                        .map((a) => [a.codec.toUpperCase(), a.language].filter(Boolean).join(" · "))
                        .join(", ")}
                    </dd>
                  </div>
                )}

                {file.subtitleCount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtitles</dt>
                    <dd className="font-medium text-white">{file.subtitleCount} tracks</dd>
                  </div>
                )}

                {file.size > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">File Size</dt>
                    <dd className="font-medium text-white">
                      {(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                    </dd>
                  </div>
                )}

                {file.duration && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Duration</dt>
                    <dd className="font-medium text-white">{Math.round(file.duration / 60)} min</dd>
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
