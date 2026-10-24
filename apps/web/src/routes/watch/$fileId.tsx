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
import { api, type Playability } from "../../client";
import { probeBrowserCaps } from "@plexy/api-client";
import { queries } from "../../queries";

const BRAND_ACCENT = "#3b7df9";

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

  // Synchronously probe browser capabilities so the manifest request can start
  // immediately on mount.
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [restartAt, setRestartAt] = useState<{ fileId: number; seconds: number } | null>(null);

  // One request carries the play path, title, resume point, next episode and
  // subtitle tracks. The old flow chained three requests before the first byte
  // of video could be requested, which is what made opening a title feel slow.
  const manifest = useQuery(queries.play(Number(fileId), caps));
  const play = { data: manifest.data };
  const title = manifest.data?.title || null;
  const knownDuration = manifest.data?.duration ?? null;
  const nextFileId = manifest.data?.nextFileId ?? null;
  const tracks = manifest.data?.tracks ?? [];
  // Sidecar labels are human-readable filenames (spaces, dots, apostrophes),
  // so they must be encoded before becoming part of the track URL.
  const subtitleUrl = (track: string) =>
    `/api/subtitles/${fileId}/${encodeURIComponent(track.endsWith(".vtt") ? track : `${track}.vtt`)}`;

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
    // Buffered-ahead visualization in the scrubber rail: shows how much of the
    // timeline has already loaded, so fast-forwarding is an informed move.
    if (timeRange && !timeRange.querySelector("media-buffered-progress-bar")) {
      const buffered = document.createElement("media-buffered-progress-bar");
      buffered.slot = "buffered";
      timeRange.append(buffered);
    }

    const timeDisplay = root.querySelector(".time-bar media-time-display");
    if (timeDisplay) {
      timeDisplay.removeAttribute("remaining");
      timeDisplay.setAttribute("showduration", "");
      timeDisplay.setAttribute("notoggle", "");
    }

    const noSubtitles = manifest.isSuccess && tracks.length === 0;
    let style = root.getElementById("plexy-player-overrides") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "plexy-player-overrides";
      root.append(style);
    }
    style.textContent = `media-loading-indicator { display: none; }
      media-buffered-progress-bar {
        --media-range-track-background: rgba(255, 255, 255, 0.16);
        --media-progress-bar-border-radius: 4px;
        color: rgba(255, 255, 255, 0.22);
      }
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
          background: #1f1f23;
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
  }, [fileId, play.data?.path, tracks.length, manifest.isSuccess]);

  // Warm the next episode's manifest while the current one plays, so hitting
  // Next Episode starts instantly.
  useEffect(() => {
    if (!nextFileId || !caps) return;
    void queryClient.prefetchQuery(queries.play(nextFileId, caps));
  }, [nextFileId, caps, queryClient]);

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
    const onPointerUp = () => {
      // Finish the scrub on any pointer release. If the pointer leaves the
      // timeline (or the window) before release, waiting for a pointerup that
      // targets the range leaves `isScrubbingRef` stuck and swallows the next
      // arrow/seek request.
      if (!isScrubbingRef.current) return;
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

    // Arrow keys must always seek by a fixed step. Without this, the focused
    // native range input handles them as 1% of the file (which can jump most
    // of the way to the end); unfocused they are handled by Media Chrome at
    // 10 seconds. Intercepting here keeps both cases identical.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented) return;

      const path = event.composedPath();
      // Leave volume sliders and open menus/dialogs to their own controls.
      const usesArrow = path.some((target) => {
        if (!(target instanceof Element) || target.localName === "media-time-range") return false;
        const keys = (target as Element & { keysUsed?: unknown }).keysUsed;
        return Array.isArray(keys) && keys.includes(event.key);
      });
      if (usesArrow) return;

      const video = videoRef.current;
      if (!video) return;

      const total = duration ?? (Number.isFinite(video.duration) ? video.duration : null);
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const step = event.key === "ArrowRight" ? 10 : -10;
      let seekTo = Math.max(0, current + step);
      if (total != null && Number.isFinite(total)) {
        seekTo = Math.min(seekTo, Math.max(0, total - 0.25));
      }

      event.preventDefault();
      event.stopPropagation();
      if (Math.abs(seekTo - current) < 0.05) return;

      if (play.data?.path && play.data.path !== "direct") {
        setRestartAt({ fileId: Number(fileId), seconds: seekTo });
        return;
      }
      try {
        video.currentTime = seekTo;
      } catch {
        // Ignore seeks that arrive before the browser can satisfy them.
      }
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("mediaseekrequest", onSeekRequest, true);
    container.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("mediaseekrequest", onSeekRequest, true);
      container.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [fileId, play.data?.path, streamStart, duration]);

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
            className="inline-flex h-10 w-10 items-center justify-center rounded-none bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-display text-base sm:text-lg font-bold text-white drop-shadow">
              {title ?? "Loading title…"}
            </h1>
            {manifest.data?.subtitle && (
              <p className="text-xs text-white/60">{manifest.data.subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {nextFileId && (
            <button
              onClick={() =>
                navigate({ to: "/watch/$fileId", params: { fileId: String(nextFileId) } })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/25"
              title="Next Episode"
            >
              <SkipForward size={15} />
              <span>Next Episode</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Video View / Sutro Theme */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full p-0">
        {play.data?.path === "unsupported" ? (
          <div className="max-w-md rounded-2xl border border-surface/50 bg-[#161618] p-6 text-center text-white z-20 shadow-2xl">
            <p className="font-display text-lg font-bold">Unsupported Format</p>
            <p className="mt-2 text-sm text-white/60">{play.data.reason}</p>
            <button
              onClick={() => void navigate({ to: "/" })}
              className="mt-6 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
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
                ["--media-accent-color" as any]: BRAND_ACCENT,
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
                  preload="auto"
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
                      src={subtitleUrl(t.track)}
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
                  preload="auto"
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
                      src={subtitleUrl(t.track)}
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
                aria-label="Loading video"
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25 text-white"
              >
                <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
                <span className="sr-only">Loading video</span>
              </div>
            )}
          </div>
        ) : (
          <div
            role="status"
            aria-label="Preparing stream"
            className="text-center text-white/60"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-brand" />
            <span className="sr-only">Preparing stream</span>
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
