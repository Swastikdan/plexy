/// Fullscreen Cinema Player using Video.js 10 and Plexy playback engine.
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, SkipForward } from "lucide-react";

import { VideoPlayer, Video } from "@videojs/react/video";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { VideoSkin } from "@/components/videojs/video/skin";
import { api, type Playability, type SubtitleTrack } from "../../client";
import { probeBrowserCaps } from "@plexy/api-client";
import { queries } from "../../queries";
import { useIsFullscreen } from "../../lib/use-fullscreen";

function WatchRoute() {
  const { fileId } = useParams({ from: Route.id });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously probe browser capabilities so query is enabled immediately on mount (prevents deadlock)
  const [caps] = useState<string>(() => JSON.stringify(probeBrowserCaps()));
  const [title, setTitle] = useState<string | null>(null);
  const [knownDuration, setKnownDuration] = useState<number | null>(null);
  const [restartAt, setRestartAt] = useState<{ fileId: number; seconds: number } | null>(null);
  const autoAdvanceRef = useRef(false);

  // Audio track and subtitle sync state
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number>(0);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const appliedSubtitleOffsetRef = useRef<number>(0);

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

  // Fetch complete player manifest
  const hasInitializedAudioRef = useRef(false);
  useEffect(() => {
    hasInitializedAudioRef.current = false;
    setSelectedAudioIndex(0);
    setSubtitleOffset(0);
    appliedSubtitleOffsetRef.current = 0;
    setRestartAt(null);
    setKnownDuration(null);
    setTitle(null);
  }, [fileId]);

  const play = useQuery({
    queryKey: ["play", fileId, caps],
    queryFn: async () => {
      const manifest = await api.play(Number(fileId), JSON.parse(caps));
      if (manifest.title) {
        setTitle(manifest.subtitle ? `${manifest.title} · ${manifest.subtitle}` : manifest.title);
      }
      if (manifest.duration) {
        setKnownDuration(manifest.duration);
      }
      return manifest;
    },
    enabled: !!caps,
  });

  // Set default audio track from manifest once on initial load
  useEffect(() => {
    if (!hasInitializedAudioRef.current && play.data?.audioTracks && play.data.audioTracks.length > 0) {
      hasInitializedAudioRef.current = true;
      const preferredIdx = play.data.selectedAudioIndex ?? -1;
      const defaultIdx = play.data.audioTracks.findIndex((t: any) => t.isDefault);
      setSelectedAudioIndex(Number.isInteger(preferredIdx) && preferredIdx >= 0
        ? preferredIdx
        : defaultIdx >= 0 ? defaultIdx : 0);
    }
  }, [play.data?.audioTracks, play.data?.selectedAudioIndex]);

  // Subtitle tracks
  const tracksQuery = useQuery({ ...queries.subtitles(Number(fileId)), enabled: !!caps });
  const tracks = (tracksQuery.data?.tracks ?? []) as (SubtitleTrack & { isDefault?: boolean })[];

  const resumeAt =
    play.data?.watch && !play.data.watch.played && play.data.watch.position > 15
      ? play.data.watch.position
      : 0;

  const streamStart =
    (play.data?.path === "hls" && selectedAudioIndex === (play.data.selectedAudioIndex ?? 0))
      || (play.data?.path === "direct" && selectedAudioIndex === 0)
      ? 0
      : restartAt?.fileId === Number(fileId)
        ? restartAt.seconds
        : resumeAt;

  const effectivePath = useMemo(() => {
    if (!play.data || play.data.path === "unsupported") return null;
    // If original direct play, but user selected an alternate audio track, remux to preserve choice
    if (play.data.path === "direct" && selectedAudioIndex > 0) return "remux";
    // Prepared HLS bundles contain the preferred language selected at prepare
    // time. Use the normal conversion path if the viewer chooses another track.
    if (play.data.path === "hls" && selectedAudioIndex !== (play.data.selectedAudioIndex ?? 0)) return "transcode";
    return play.data.path;
  }, [play.data, selectedAudioIndex]);

  const streamUrl = useMemo(() => {
    if (!effectivePath) return null;
    return api.streamUrl(Number(fileId), effectivePath, streamStart || undefined, selectedAudioIndex);
  }, [fileId, effectivePath, streamStart, selectedAudioIndex]);

  // Fast trickplay track URL for scrub previews
  const trickplayTrackUrl = useMemo(() => {
    if (!play.data || play.data.path === "unsupported") return null;
    return api.trickplayTrackUrl(Number(fileId));
  }, [fileId, play.data]);

  // Preload all trickplay sprite sheets into browser cache immediately on player load
  useEffect(() => {
    const sprites = play.data?.trickplay?.sprites;
    if (sprites && sprites.length > 0) {
      for (const url of sprites) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [play.data?.trickplay?.sprites]);

  // Immediate loading state feedback on stream changes
  useEffect(() => {
    if (!streamUrl) return;
    setIsBuffering(true);
    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    };
  }, [streamUrl]);

  const isHls = Boolean(streamUrl && streamUrl.includes(".m3u8"));
  const duration = knownDuration ?? play.data?.watch?.duration ?? undefined;

  const isFullscreen = useIsFullscreen();
  const isElectronMac =
    typeof window !== "undefined" &&
    (Boolean(window.electronAPI?.isElectron) || /Electron/i.test(navigator.userAgent)) &&
    (window.electronAPI?.platform === "darwin" || /Mac/i.test(navigator.userAgent));
  const needsMacOffset = isElectronMac && !isFullscreen;

  // Converted fragmented MP4 streams report duration as data arrives.
  // Define source-timeline properties so seeking and duration stay in sync.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || effectivePath === "direct") return;

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
        set: (sourceTime: number) => {
          if (Math.abs(sourceTime - (streamStart + currentTimeDescriptor.get!.call(video))) > 2) {
            setRestartAt({ fileId: Number(fileId), seconds: sourceTime });
          } else {
            currentTimeDescriptor.set!.call(video, Math.max(0, sourceTime - streamStart));
          }
        },
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

    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("timeupdate"));
    video.dispatchEvent(new Event("seekablechange"));

    return () => {
      Reflect.deleteProperty(video, "duration");
      Reflect.deleteProperty(video, "currentTime");
      Reflect.deleteProperty(video, "seekable");
    };
  }, [streamUrl, streamStart, duration, effectivePath, fileId]);

  // Subtitle Synchronization Adjustment Engine
  const handleAdjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffset((prev) => Number((prev + delta).toFixed(2)));
  }, []);

  const handleResetSubtitleOffset = useCallback(() => {
    setSubtitleOffset(0);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const diff = subtitleOffset - appliedSubtitleOffsetRef.current;
    if (Math.abs(diff) < 0.001) return;
    appliedSubtitleOffsetRef.current = subtitleOffset;

    if (video.textTracks) {
      for (let t = 0; t < video.textTracks.length; t++) {
        const track = video.textTracks[t];
        // Shift cues for subtitle/captions tracks only (preserve metadata tracks like trickplay)
        if (track.kind === "subtitles" || track.kind === "captions") {
          if (track.cues) {
            for (let c = 0; c < track.cues.length; c++) {
              const cue = track.cues[c];
              cue.startTime += diff;
              cue.endTime += diff;
            }
          }
        }
      }
    }
  }, [subtitleOffset]);

  // Ensure freshly loaded subtitle tracks receive current offset
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTrackLoad = () => {
      if (appliedSubtitleOffsetRef.current === 0 || !video.textTracks) return;
      const currentOffset = appliedSubtitleOffsetRef.current;
      for (let t = 0; t < video.textTracks.length; t++) {
        const track = video.textTracks[t];
        if (track.kind === "subtitles" || track.kind === "captions") {
          const trackExt = track as any;
          if (track.cues && track.cues.length > 0 && !trackExt.__plexy_offset_applied) {
            trackExt.__plexy_offset_applied = true;
            for (let c = 0; c < track.cues.length; c++) {
              const cue = track.cues[c];
              cue.startTime += currentOffset;
              cue.endTime += currentOffset;
            }
          }
        }
      }
    };

    const trackElements = video.querySelectorAll("track");
    trackElements.forEach((el) => el.addEventListener("load", onTrackLoad));
    return () => {
      trackElements.forEach((el) => el.removeEventListener("load", onTrackLoad));
    };
  }, [tracks, fileId]);

  // Audio track switching handler
  const handleSelectAudioTrack = useCallback((index: number) => {
    if (index === selectedAudioIndex) return;
    const currentPos = videoRef.current?.currentTime ?? streamStart;
    setSelectedAudioIndex(index);
    setRestartAt({ fileId: Number(fileId), seconds: currentPos });
  }, [fileId, selectedAudioIndex, streamStart]);

  // Resume position callback
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLMediaElement>) => {
    const v = e.currentTarget;
    if (autoAdvanceRef.current) {
      void v.play().then(() => {
        autoAdvanceRef.current = false;
      }).catch(() => {});
    }
    const resumePos = play.data?.watch?.position ?? 0;
    if (resumePos > 15 && !play.data?.watch?.played) {
      if ((effectivePath === "direct" || effectivePath === "hls") && Math.abs(v.currentTime - resumePos) > 3) {
        v.currentTime = resumePos;
      }
    }
  }, [effectivePath, play.data?.watch]);

  const handleEnded = useCallback(() => {
    const next = play.data?.nextFileId;
    if (!next) return;
    autoAdvanceRef.current = true;
    void navigate({ to: "/watch/$fileId", params: { fileId: String(next) } });
  }, [navigate, play.data?.nextFileId]);

  const playNextEpisode = useCallback(() => {
    const next = play.data?.nextFileId;
    if (next) void navigate({ to: "/watch/$fileId", params: { fileId: String(next) } });
  }, [navigate, play.data?.nextFileId]);

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
      className="fixed inset-0 z-50 flex flex-col bg-black select-none overflow-hidden"
    >
      {/* Top Header Bar — reserves space for macOS traffic light buttons when windowed; moves flush left when fullscreen */}
      <div
        style={{
          paddingLeft: needsMacOffset ? "88px" : undefined,
        }}
        className={`absolute top-0 inset-x-0 z-30 flex h-20 items-center gap-4 px-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent transition-[opacity,padding] duration-300 ${
          controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={() => void navigate({ to: "/" })}
          aria-label="Back"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-display text-base sm:text-lg font-bold text-white drop-shadow truncate">
          {title ?? ""}
        </h1>
      </div>

      {/* Main Video View / Video.js 10 */}
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
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <VideoPlayer>
              <VideoSkin
                className="w-full h-full max-w-full max-h-full aspect-video shadow-2xl"
                serverAudioTracks={play.data?.audioTracks}
                selectedAudioIndex={selectedAudioIndex}
                onSelectAudioTrack={handleSelectAudioTrack}
                subtitleOffset={subtitleOffset}
                onAdjustSubtitleOffset={handleAdjustSubtitleOffset}
                onResetSubtitleOffset={handleResetSubtitleOffset}
              >
                {streamUrl && (
                  isHls ? (
                    <HlsJsVideo
                      key={streamUrl}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={hideBuffering}
                      onEnded={handleEnded}
                      onTimeUpdate={hideBuffering}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={hideBuffering}
                      className="h-full w-full object-contain"
                    >
                      {trickplayTrackUrl && (
                        <track
                          kind="metadata"
                          label="thumbnails"
                          src={trickplayTrackUrl}
                          default
                        />
                      )}
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
                    </HlsJsVideo>
                  ) : (
                    <Video
                      key={streamUrl}
                      ref={(el: HTMLVideoElement | null) => {
                        videoRef.current = el;
                      }}
                      src={streamUrl}
                      autoPlay
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={handleLoadedMetadata}
                      onLoadedData={hideBuffering}
                      onEnded={handleEnded}
                      onTimeUpdate={hideBuffering}
                      onPlay={hideBuffering}
                      onWaiting={showBufferingAfterDelay}
                      onStalled={showBufferingAfterDelay}
                      onCanPlay={hideBuffering}
                      onPlaying={hideBuffering}
                      onError={hideBuffering}
                      className="h-full w-full object-contain"
                    >
                      {trickplayTrackUrl && (
                        <track
                          kind="metadata"
                          label="thumbnails"
                          src={trickplayTrackUrl}
                          default
                        />
                      )}
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
                    </Video>
                  )
                )}
              </VideoSkin>
            </VideoPlayer>

            {/* Next Episode — lives outside VideoSkin/VideoPlayer so skin overlays never block pointer events */}
            {play.data?.nextFileId && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  playNextEpisode();
                }}
                aria-label="Play next episode"
                title="Next Episode"
                className={`absolute right-5 top-5 z-50 inline-flex h-10 items-center gap-2 rounded-lg bg-black/70 px-4 text-sm font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-white transition-opacity duration-300 ${
                  controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
              >
                <SkipForward size={16} />
                <span>Next Episode</span>
              </button>
            )}

            {isBuffering && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25 text-white"
              >
                <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
              </div>
            )}
          </div>
        )}
      </div>

      <ProgressReporter
        bridge={{
          play: play.data,
          fileId: Number(fileId),
          queryClient,
          streamStart,
          duration,
        }}
      />
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
    const video = document.querySelector("video");
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
