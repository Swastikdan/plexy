/// Fullscreen Netflix-style Player with Sutro Theme (PRD 5.8, 10.4, 10.8).
///
/// Integrates MediaThemeSutro from player.style/sutro/react and HlsVideo from
/// hls-video-element/react with Plexy's backend playability routing.
import { useEffect, useRef, useState, useCallback } from "react";
import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, SkipForward } from "lucide-react";
 
import HlsVideo from "hls-video-element/react";
import { api, type Playability, type SubtitleTrack } from "../../client";
import { probeBrowserCaps } from "@plexy/api-client";
import { queries } from "../../queries";

const MediaThemeSutroWithDuration = MediaThemeSutro as React.ComponentType<
  React.ComponentProps<typeof MediaThemeSutro> & { defaultduration?: number }
>;

function WatchRoute() {
  const { fileId } = useParams({ from: Route.id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<React.ComponentRef<typeof MediaThemeSutro> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isScrubbingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously probe browser capabilities so query is enabled immediately on mount (prevents deadlock)
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [title, setTitle] = useState<string | null>(null);
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const [restartAt, setRestartAt] = useState<{ fileId: number; seconds: number } | null>(null);
  const [nextFileId, setNextFileId] = useState<number | null>(null);

  // Auto-hide top header bar on mouse inactivity
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  const showBufferingAfterDelay = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = setTimeout(() => setIsBuffering(true), 180);
  }, []);

  const hideBuffering = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = null;
    setIsBuffering(false);
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
        setKnownDuration(detail.file?.duration ?? null);
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

  // Keep Sutro's hover time preview and captions control available. Media
  // Chrome hides captions UI when no tracks were discovered, so show an
  // explicit empty state instead of silently removing the subtitle button.
  useEffect(() => {
    const root = themeRef.current?.shadowRoot;
    if (!root) return;

    const timeRange = root.querySelector("media-time-range");
    if (timeRange && !timeRange.querySelector("media-preview-time-display")) {
      const previewTime = document.createElement("media-preview-time-display");
      previewTime.slot = "preview";
      timeRange.append(previewTime);
    }

    const timeDisplay = root.querySelector(".time-bar media-time-display");
    if (timeDisplay) {
      timeDisplay.removeAttribute("remaining");
      timeDisplay.setAttribute("showduration", "");
      timeDisplay.setAttribute("notoggle", "");
    }

    const noSubtitles = tracksQuery.isSuccess && tracks.length === 0;
    let style = root.getElementById("plexy-player-overrides") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "plexy-player-overrides";
      root.append(style);
    }
    style.textContent = `media-loading-indicator { display: none; }
      ${noSubtitles ? `
        media-captions-button:not([mediasubtitleslist]) {
          display: inline-flex !important;
          opacity: 0.55;
        }
        media-captions-button:not([mediasubtitleslist])::after {
          content: "No subtitles available for this file";
          position: absolute;
          right: 0;
          bottom: calc(100% + 10px);
          width: max-content;
          max-width: 220px;
          padding: 6px 9px;
          border-radius: 4px;
          background: #181818;
          color: white;
          font: 12px/1.4 sans-serif;
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        media-captions-button:not([mediasubtitleslist]):is(:hover, :focus-visible)::after {
          opacity: 1;
        }
      ` : ""}`;
  }, [fileId, play.data?.path, tracks.length, tracksQuery.isSuccess]);

  const resumeAt = play.data?.watch && !play.data.watch.played && play.data.watch.position > 15
    ? play.data.watch.position
    : 0;
  const streamStart = play.data?.path === "direct"
    ? 0
    : restartAt?.fileId === Number(fileId)
      ? restartAt.seconds
      : resumeAt;
  const streamUrl = play.data && play.data.path !== "unsupported"
    ? api.streamUrl(Number(fileId), play.data.path, streamStart || undefined)
    : null;

  // A new direct stream or server-side seek starts a fresh media load. Show
  // feedback immediately until playback starts; later stalls are debounced to
  // avoid flashing the spinner during brief network hiccups.
  useEffect(() => {
    if (!streamUrl) return;
    setIsBuffering(true);
    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    };
  }, [streamUrl]);

  const isHls = Boolean(streamUrl && streamUrl.includes(".m3u8"));

  // Converted fragmented MP4 streams report their duration as data arrives.
  // The player should use the scanned source duration from the first frame.
  const duration = knownDuration ?? play.data?.watch?.duration ?? undefined;

  // Media Chrome reads the media element's duration/currentTime/seekable values
  // directly. Present source-timeline values for converted streams, whose MP4
  // timestamps restart at zero after each server-side seek.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || play.data?.path === "direct") return;

    const durationDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "duration");
    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    const seekableDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "seekable");
    if (!durationDescriptor?.get || !currentTimeDescriptor?.get || !currentTimeDescriptor.set || !seekableDescriptor?.get) return;

    Object.defineProperties(video, {
      duration: {
        configurable: true,
        get: () => duration ?? durationDescriptor.get!.call(video),
      },
      currentTime: {
        configurable: true,
        get: () => streamStart + currentTimeDescriptor.get!.call(video),
        set: (sourceTime: number) => currentTimeDescriptor.set!.call(video, Math.max(0, sourceTime - streamStart)),
      },
      seekable: {
        configurable: true,
        get: () => {
          if (duration == null) return seekableDescriptor.get!.call(video);
          return {
            length: 1,
            start(index: number) {
              if (index !== 0) throw new DOMException("Time range index out of bounds", "IndexSizeError");
              return 0;
            },
            end(index: number) {
              if (index !== 0) throw new DOMException("Time range index out of bounds", "IndexSizeError");
              return duration;
            },
          } as TimeRanges;
        },
      },
    });

    // The media element may have emitted loadedmetadata before this effect ran.
    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("timeupdate"));
    video.dispatchEvent(new Event("seekablechange"));

    return () => {
      Reflect.deleteProperty(video, "duration");
      Reflect.deleteProperty(video, "currentTime");
      Reflect.deleteProperty(video, "seekable");
    };
  }, [streamUrl, streamStart, duration, play.data?.path]);

  // media-time-range emits a seek request for every pointer movement. That is
  // smooth for a local seekable file, but causes repeated range/decoder work on
  // streamed conversions. Let the range update its preview while dragging and
  // issue one seek when the pointer is released.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isTimeRangeEvent = (event: Event) =>
      event.composedPath().some(
        (target) => target instanceof Element && target.localName === "media-time-range",
      );

    const onPointerDown = (event: Event) => {
      if (isTimeRangeEvent(event)) {
        isScrubbingRef.current = true;
        pendingSeekRef.current = null;
      }
    };
    const onSeekRequest = (event: Event) => {
      if (play.data?.path === "direct" && !isScrubbingRef.current) return;
      const seekEvent = event as CustomEvent<number>;
      if (Number.isFinite(seekEvent.detail)) pendingSeekRef.current = seekEvent.detail;
      event.stopPropagation();
      if (play.data?.path !== "direct" && !isScrubbingRef.current && Number.isFinite(seekEvent.detail)) {
        setRestartAt({ fileId: Number(fileId), seconds: seekEvent.detail });
      }
    };
    const onPointerUp = (event: Event) => {
      if (!isScrubbingRef.current || !isTimeRangeEvent(event)) return;
      isScrubbingRef.current = false;
      const seekTo = pendingSeekRef.current;
      pendingSeekRef.current = null;
      const video = videoRef.current;
      if (seekTo != null && video) {
        if (play.data?.path && play.data.path !== "direct") {
          // Converted MP4 responses are sequential streams without byte ranges.
          // Restart conversion at the requested source timestamp to make seeking
          // work beyond data that has already reached the browser.
          setRestartAt({ fileId: Number(fileId), seconds: seekTo });
          return;
        }
        try {
          video.currentTime = seekTo;
        } catch {
          // Some in-progress converted streams cannot seek until more data arrives.
        }
      }
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("mediaseekrequest", onSeekRequest, true);
    container.addEventListener("pointerup", onPointerUp, true);
    container.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("mediaseekrequest", onSeekRequest, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      container.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [fileId, play.data?.path, streamStart]);

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
            <MediaThemeSutroWithDuration
              ref={themeRef}
              defaultduration={duration}
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
                  key={streamUrl}
                  ref={(el: any) => { videoRef.current = el; }}
                  slot="media"
                  src={streamUrl}
                  autoplay
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  onWaiting={showBufferingAfterDelay}
                  onStalled={showBufferingAfterDelay}
                  onCanPlay={hideBuffering}
                  onPlaying={hideBuffering}
                  onError={hideBuffering}
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
                  key={streamUrl}
                  ref={(el) => { videoRef.current = el; }}
                  slot="media"
                  src={streamUrl}
                  autoPlay
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  onWaiting={showBufferingAfterDelay}
                  onStalled={showBufferingAfterDelay}
                  onCanPlay={hideBuffering}
                  onPlaying={hideBuffering}
                  onError={hideBuffering}
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
            </MediaThemeSutroWithDuration>
            {isBuffering && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/25 text-white"
              >
                <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
                <span className="text-sm font-medium drop-shadow">Buffering video…</span>
                {play.data?.path && play.data.path !== "direct" && (
                  <span className="-mt-2 text-xs text-white/70">
                    {play.data.path === "transcode"
                      ? "Converting this local file for playback"
                      : "Remuxing this local file for playback"}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-ink-muted">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[#E50914] mx-auto mb-3" />
            <p className="text-sm">Preparing stream…</p>
          </div>
        )}
      </div>

      <ProgressReporter bridge={{
        play: play.data,
        fileId: Number(fileId),
        queryClient,
        streamStart,
        duration,
      }} />
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
    streamStart: number;
    duration: number | null | undefined;
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
        .progress(
          itemId,
          mediaEl.currentTime,
          bridge.duration ?? (mediaEl.duration || null),
          played,
        )
        .then(() => bridge.queryClient.invalidateQueries({ queryKey: ["home"] }));
    };

    const interval = setInterval(() => {
      if (!mediaEl.paused && mediaEl.currentTime > 5) report(false);
    }, 10_000);

    const onPause = () => {
      if (bridge.duration || mediaEl.duration) {
        const duration = bridge.duration ?? mediaEl.duration;
        report(mediaEl.currentTime > duration * 0.9);
      }
    };

    const onLeave = () => {
      if ((bridge.duration || mediaEl.duration) && mediaEl.currentTime > 5) {
        const duration = bridge.duration ?? mediaEl.duration;
        const played = mediaEl.currentTime > duration * 0.9;
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
  }, [itemId, bridge.streamStart, bridge.duration]);

  return null;
}
