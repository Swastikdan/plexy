/// Fullscreen Netflix-style Player with Sutro Theme (PRD 5.8, 10.4, 10.8).
///
/// Integrates MediaThemeSutro from player.style/sutro/react and HlsVideo from
/// hls-video-element/react with Plexy's backend playability routing.
import { useEffect, useRef, useState, useCallback } from "react";
import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, SkipForward } from "lucide-react";
import MediaThemeSutro from "player.style/sutro/react";
import HlsVideo from "hls-video-element/react";
import { api, type Playability, type SubtitleTrack } from "../../client";
import { probeBrowserCaps } from "@plexy/api-client";
import { queries } from "../../queries";

function WatchRoute() {
  const { fileId } = useParams({ from: Route.id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously probe browser capabilities so query is enabled immediately on mount (prevents deadlock)
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [title, setTitle] = useState<string | null>(null);
  const [nextFileId, setNextFileId] = useState<number | null>(null);

  // Auto-hide top header bar on mouse inactivity
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  // Fetch playability routing decision
  const play = useQuery({
    queryKey: ["playability", fileId, caps],
    queryFn: async () => {
      const verdict = await api.playability(Number(fileId), JSON.parse(caps));
      if (verdict.itemId) {
        const detail = await api.title(verdict.itemId);
        setTitle(detail.item.name);
        // If series, check if next episode exists
        if (detail.episodes && detail.episodes.length > 0) {
          const idx = detail.episodes.findIndex((e) => e.id === verdict.itemId);
          if (idx !== -1 && idx < detail.episodes.length - 1) {
            const nextEp = detail.episodes[idx + 1];
            if (nextEp?.id) {
              setNextFileId(nextEp.id);
            }
          }
        }
      }
      return verdict;
    },
    enabled: !!caps,
  });

  // Subtitle tracks
  const tracksQuery = useQuery({ ...queries.subtitles(Number(fileId)), enabled: !!caps });
  const tracks = (tracksQuery.data?.tracks ?? []) as (SubtitleTrack & { isDefault?: boolean })[];

  const streamUrl = play.data && play.data.path !== "unsupported"
    ? api.streamUrl(
        Number(fileId),
        play.data.path,
        play.data.path === "remux" && play.data.watch && !play.data.watch.played && play.data.watch.position > 15
          ? play.data.watch.position
          : undefined,
      )
    : null;

  const isHls = Boolean(streamUrl && streamUrl.includes(".m3u8"));

  // Resume position callback
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const v = e.currentTarget;
    const resumeAt = play.data?.watch?.position ?? 0;
    if (resumeAt > 15 && !play.data?.watch?.played) {
      if (play.data?.path === "direct" && Math.abs(v.currentTime - resumeAt) > 3) {
        v.currentTime = resumeAt;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
      className="fixed inset-0 z-50 flex flex-col bg-black select-none overflow-hidden"
    >
      {/* Top Header Controls */}
      <div
        className={`absolute top-0 inset-x-0 z-30 flex h-20 items-center justify-between px-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
          controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => void navigate({ to: "/" })}
            aria-label="Back"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-display text-base sm:text-lg font-bold text-white drop-shadow">
              {title ?? "Loading title…"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {nextFileId && (
            <button
              onClick={() =>
                navigate({ to: "/watch/$fileId", params: { fileId: String(nextFileId) } })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 transition-colors"
              title="Next Episode"
            >
              <SkipForward size={15} />
              <span>Next Episode</span>
            </button>
          )}

          {play.data && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-md border ${
                play.data.path === "direct"
                  ? "border-green-500/40 bg-green-500/20 text-green-300"
                  : play.data.path === "remux"
                    ? "border-blue-500/40 bg-blue-500/20 text-blue-300"
                    : "border-amber-500/40 bg-amber-500/20 text-amber-300"
              }`}
            >
              {play.data.path === "direct"
                ? "Direct Play"
                : play.data.path === "remux"
                  ? "Remux"
                  : "Transcoding"}
            </span>
          )}
        </div>
      </div>

      {/* Main Video View / Sutro Theme */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full p-0">
        {play.data?.path === "unsupported" ? (
          <div className="max-w-md p-6 text-center rounded-2xl bg-[#181818] border border-white/10 text-white z-20">
            <p className="font-display text-lg font-bold">Unsupported Format</p>
            <p className="mt-2 text-sm text-ink-muted">{play.data.reason}</p>
            <button
              onClick={() => void navigate({ to: "/" })}
              className="mt-6 rounded-lg bg-[#E50914] px-5 py-2 text-sm font-semibold hover:bg-[#b80710] transition-colors"
            >
              Return Home
            </button>
          </div>
        ) : streamUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <MediaThemeSutro
              style={{
                width: "100%",
                maxWidth: "100%",
                maxHeight: "100vh",
                aspectRatio: "16 / 9",
                ["--media-accent-color" as any]: "#E50914",
                ["--media-primary-color" as any]: "#ffffff",
                ["--media-secondary-color" as any]: "rgba(255, 255, 255, 0.75)",
                ["--media-control-background" as any]: "rgba(18, 18, 18, 0.85)",
                ["--media-control-hover-background" as any]: "rgba(35, 35, 35, 0.95)",
                ["--media-font-family" as any]: "inherit",
              } as React.CSSProperties}
              className="w-full h-full max-w-full max-h-full aspect-video shadow-2xl"
            >
              {isHls ? (
                <HlsVideo
                  ref={(el: any) => { videoRef.current = el; }}
                  slot="media"
                  src={streamUrl}
                  autoplay
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  className="h-full w-full object-contain"
                >
                  {tracks.map((t) => (
                    <track
                      key={t.track}
                      label={t.title || t.language || `Track ${t.track}`}
                      kind="subtitles"
                      src={`/api/subtitles/${fileId}/${t.track.endsWith(".vtt") ? t.track : `${t.track}.vtt`}`}
                      srcLang={t.language ?? undefined}
                      default={t.isDefault}
                    />
                  ))}
                </HlsVideo>
              ) : (
                <video
                  ref={(el) => { videoRef.current = el; }}
                  slot="media"
                  src={streamUrl}
                  autoPlay
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  className="h-full w-full object-contain"
                >
                  {tracks.map((t) => (
                    <track
                      key={t.track}
                      label={t.title || t.language || `Track ${t.track}`}
                      kind="subtitles"
                      src={`/api/subtitles/${fileId}/${t.track.endsWith(".vtt") ? t.track : `${t.track}.vtt`}`}
                      srcLang={t.language ?? undefined}
                      default={t.isDefault}
                    />
                  ))}
                </video>
              )}
            </MediaThemeSutro>
          </div>
        ) : (
          <div className="text-center text-ink-muted">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[#E50914] mx-auto mb-3" />
            <p className="text-sm">Preparing stream…</p>
          </div>
        )}
      </div>

      <ProgressReporter bridge={{ play: play.data, fileId: Number(fileId), queryClient }} />
    </div>
  );
}

export const Route = createFileRoute("/watch/$fileId")({ component: WatchRoute });

/**
 * Periodically reports watch position to server every 10s and on pause/close (PRD 5.8).
 */
function ProgressReporter({
  bridge,
}: {
  bridge: {
    play: Playability | undefined;
    fileId: number;
    queryClient: ReturnType<typeof useQueryClient>;
  };
}) {
  const itemId = bridge.play?.itemId ?? null;

  useEffect(() => {
    if (!itemId) return;
    const video = document.querySelector("video") || document.querySelector("hls-video");
    if (!video) return;

    const mediaEl = video as HTMLMediaElement;

    const report = (played: boolean) => {
      void api
        .progress(itemId, mediaEl.currentTime, mediaEl.duration || null, played)
        .then(() => bridge.queryClient.invalidateQueries({ queryKey: ["home"] }));
    };

    const interval = setInterval(() => {
      if (!mediaEl.paused && mediaEl.currentTime > 5) report(false);
    }, 10_000);

    const onPause = () => {
      if (mediaEl.duration) {
        report(mediaEl.currentTime > mediaEl.duration * 0.9);
      }
    };

    const onLeave = () => {
      if (mediaEl.duration && mediaEl.currentTime > 5) {
        const played = mediaEl.currentTime > mediaEl.duration * 0.9;
        report(played);
      }
    };

    mediaEl.addEventListener("pause", onPause);
    window.addEventListener("pagehide", onLeave);

    return () => {
      clearInterval(interval);
      mediaEl.removeEventListener("pause", onPause);
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, [itemId]);

  return null;
}
