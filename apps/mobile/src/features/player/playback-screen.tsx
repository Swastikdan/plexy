import { useCastPlayback } from "./hooks/use-cast-playback";
import { useSleepTimer, type PlaybackSleepTimer } from "./hooks/use-sleep-timer";
import { useResource } from "@/core/resources/use-resource";
import { updateNativePlayer } from "./lib/native-player";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import React, { useLayoutEffect , useCallback, useEffect, useRef, useState } from "react";
import Reanimated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { triggerHaptic } from "@/shared/lib/haptics";
import { ArrowLeft, Play, Pause, SlidersHorizontal, PictureInPicture, Maximize, Crop, MoveHorizontal , Lock, Unlock } from "@/shared/ui/icons";
import { useKeepAwake } from "expo-keep-awake";
import {
  isPictureInPictureSupported,
  useVideoPlayer,
  VideoView,
  type AudioTrack,
  type VideoPlayer,
} from "expo-video";
import {
  Animated,
  AppState,
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localSegments } from "@plexy/local-library/library";
import { nativeMedia } from "@/core/native-media/bridge";
import { useClient } from "@/core/client/client-provider";
import type { ShowTrackPreferences } from "@/core/client/preferences";
import type {
  ItemCard,
  Playability,
} from "@/core/library/catalog-api";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { cn } from "@/shared/lib/cn";
import {
  findLanguageTrack,
  languageTag,
  mediaLanguageName,
} from "@/shared/lib/media-language";
import { easings, timeLabel } from "@/shared/theme";
import { Notice } from "@/shared/ui/notice";
import { LocalThumbnail } from "./components/local-thumbnail";
import { SubtitleSearch } from "./components/subtitle-search";
import { AudioPanel } from "./components/audio-panel";
import { BottomToolbar } from "./components/bottom-toolbar";
import { PlayerControl } from "./components/player-control";
import { PlayerDrawer } from "./components/player-drawer";
import { PlayerGestureHud } from "./components/player-gesture-hud";
import { IconSeekBack, IconSeekForward } from "./components/player-icons";
import { PlayerLoading } from "./components/player-loading";
import { SeekSideOverlay } from "./components/seek-side-overlay";
import { SpeedPanel } from "./components/speed-panel";
import { TimelineBar } from "./components/timeline-bar";
import { usePlayerControls } from "./hooks/use-player-controls";
import { usePlayerGestures } from "./hooks/use-player-gestures";
import { bufferOptionsForDuration } from "./lib/player-buffer";
import {
  HOLD_TO_BOOST_MS,
  SEEK_BURST_MS,
  seekLanded,
  shouldShowPlayerLoading,
} from "./lib/player-interactions";
import { usePlayerSubtitles } from "./hooks/use-player-subtitles";

interface SourceChoice {
  path: string;
  audio: number;
  start: number;
  maxHeight?: number;
  uri?: string;
  autoplay?: boolean;
  revision: number;
}

function EndPill({
  label,
  onPress,
  variant,
  fill,
}: {
  label: string;
  onPress: () => void;
  variant: "dark" | "light" | "ghost";
  fill?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={cn(
        "min-w-[150px] items-center justify-center overflow-hidden rounded-full px-6 py-3",
        variant === "light"
          ? "bg-white"
          : variant === "dark"
            ? "bg-white/20"
            : "border border-white/30 bg-transparent",
      )}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {fill != null && (
        <View
          pointerEvents="none"
          className="absolute left-0 top-0 bottom-0 bg-black/[0.12]"
          style={{ width: `${Math.round(fill * 100)}%` }}
        />
      )}
      <Text
        pointerEvents="none"
        className={cn(
          "text-[14px] font-archivo-bold",
          variant === "light" ? "text-black" : "text-white/95",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PlaybackScreen({
  initial,
  back,
  next,
  onlineNext,
  onNextOnline,
  externalSource,
  addExternalToLibrary,
  sharedSleepTimer,
}: {
  initial: Playability;
  back: () => void;
  next: (id: number) => void;
  /** A missing next episode that should continue on the online source. */
  onlineNext?: { season: number; episode: number; title: string } | null;
  onNextOnline?: () => void;
  externalSource?: string;
  addExternalToLibrary?: () => void;
  sharedSleepTimer?: PlaybackSleepTimer;
}) {
  useKeepAwake();
  const { api, runtime, preferences, updatePreferences, progress } =
    useClient();
  const showKey =
    initial.mediaType === "tv" && initial.parentItemId != null
      ? `local-${initial.parentItemId}`
      : null;
  const showTracks = showKey ? preferences.showTrackPreferences[showKey] : undefined;
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [subtitleSearch, setSubtitleSearch] = useState(false);
  const [manifest, setManifest] = useState(initial);
  const [choice, setChoice] = useState<SourceChoice>({
    path: initial.path,
    audio: initial.selectedAudioIndex || 0,
    start: 0,
    revision: 0,
  });
  const initialResume =
    initial.watch && !initial.watch.played && initial.watch.position > 15
      ? initial.watch.position
      : 0;
  const [resume, setResume] = useState(initialResume > 0);
  const awaitingResume = useRef(initialResume > 0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(
    initial.duration || initial.watch?.duration || 0,
  );
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("loading");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [bufferedPosition, setBufferedPosition] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const remux = useRef<{ id: string; originalPosition: number; target?: number; resume?: boolean } | null>(null);
  const originalUri = externalSource ?? (manifest.path === "unsupported" ? "" : api.stream(manifest.fileId));
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const [resumeBackdropOpacity] = React.useState(() => new Animated.Value(0));
  const [resumeCardOpacity] = React.useState(() => new Animated.Value(0));
  const [resumeCardScale] = React.useState(() => new Animated.Value(0.94));
  const skipResource = useResource(() => externalSource ? Promise.resolve(null) : api.skips(manifest.fileId), [api, manifest.fileId, externalSource]);
  const skips = skipResource.value;
  const [scrub, setScrub] = useState<number | null>(null);
  const [scrubCancelling, setScrubCancelling] = useState(false);
  const [seekNotice, setSeekNotice] = useState<{
    seconds: number;
    id: number;
  } | null>(null);
  const seekNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boosting, setBoosting] = useState(false);
  const boostRef = useRef(false);
  const boostHold = useRef<{ start: () => void; end: () => void }>({
    start: () => {},
    end: () => {},
  });
  const onHoldStart = useEventCallback(() => boostHold.current.start());
  const onHoldEnd = useEventCallback(() => boostHold.current.end());
  const {
    visible,
    setVisible,
    menu,
    setMenu,
    speedPanel,
    setSpeedPanel,
    audioPanel,
    setAudioPanel,
    locked,
    lockedRef,
    unlockHint,
    reveal,
    lockScreen,
    unlockScreen,
    showUnlockHint,
    lastInteraction,
    toggleControls,
    touchControls,
  } = usePlayerControls({ playing, status, scrub });
  const playerRef = useRef<VideoPlayer | null>(null);
  const {
    fitMode,
    zoomStyle,
    brightnessStyle,
    brightnessValue,
    volumeValue,
    applyFit,
    adjusting,
    videoGestures,
    setViewportWidth,
    onTap,
    onHoldStart: beginHold,
    onHoldEnd: finishHold,
    fitToast,
    toastOpacity,
    toastScale,
    showFitToast,
  } = usePlayerGestures({
    hasLoaded,
    height: win.height,
    locked,
    reduceMotion,
    seekBy: (seconds) => seekWithFeedback(seconds),
    seekSeconds: preferences.seekSeconds,
    toggleControls,
    controlsVisible: visible,
    enabled: !locked && !resume && !menu && !speedPanel && !audioPanel,
    onVolumeChange: (level) => {
      if (playerRef.current) playerRef.current.volume = level;
    },
    onHoldStart,
    onHoldEnd,
  });
  const isTvShow = Boolean(
    manifest.parentItemId ||
    manifest.seasonNumber != null ||
    manifest.episodeNumber != null ||
    manifest.episodes?.length,
  );
  const [episodesList, setEpisodesList] = useState<ItemCard[]>(
    manifest.episodes || [],
  );
  useEffect(() => {
    if (manifest.episodes?.length) {
      return;
    }
    const parentId = manifest.parentPublicId || manifest.parentItemId;
    if (parentId) {
      let live = true;
      api
        .detail(parentId)
        .then((detail) => {
          if (live && detail?.episodes?.length) {
            setEpisodesList(detail.episodes);
          }
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }
  }, [api, manifest.episodes, manifest.parentPublicId, manifest.parentItemId]);
  const sortedEpisodes = React.useMemo(() => {
    return [...(manifest.episodes?.length ? manifest.episodes : episodesList)].sort((a, b) => {
      const sDiff = (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1);
      if (sDiff !== 0) return sDiff;
      return (a.episodeNumber ?? 1) - (b.episodeNumber ?? 1);
    });
  }, [episodesList, manifest.episodes]);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [autoNextCancelled, setAutoNextCancelled] = useState(false);
  const [nativeAudio, setNativeAudio] = useState<
    typeof player.availableAudioTracks
  >([]);
  const sessionAudio = useRef<AudioTrack | null>(null);
  const expectedUri = useRef("");

  const video = useRef<VideoView>(null);
  const offset = useRef(0);
  const currentPosition = useRef(0);
  const pendingSeek = useRef<{ target: number; until: number } | null>(null);
  const seekWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekUnsupported = useRef(false);
  const scrubRef = useRef(scrub);
  useLayoutEffect(() => { scrubRef.current = scrub; }, [scrub]);
  const durationRef = useRef(duration);
  useLayoutEffect(() => { durationRef.current = duration; }, [duration]);
  const autoSkipEnd = useRef(-1);
  const mounted = useRef(true);
  const pip = useRef(false);
  const preferencesRef = useRef(preferences);
  useLayoutEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  const lastSaved = useRef(0);
  const chosenStart = useRef(0);
  const autoplay = useRef(true);
  const initialized = useRef(false);
  const [chromeIn] = React.useState(() => new Animated.Value(1));
  const player = useVideoPlayer(null, (instance) => {
    instance.bufferOptions = bufferOptionsForDuration(initial.duration || 0);
    instance.timeUpdateEventInterval = 0.5;
    // Background play keeps audio running with a media notification; without
    // it, Expo pauses when the view is not entering PiP.
    instance.staysActiveInBackground = preferencesRef.current.backgroundPlay;
    instance.showNowPlayingNotification = preferencesRef.current.backgroundPlay;
    instance.keepScreenOnWhilePlaying = true;
  });
  const {
    subtitle,
    pickSubtitle,
    resetSubtitle,
    nativeSubtitles,
    subVertical,
    setSubVertical,
    loadSubtitleTracks,
    text,
  } = usePlayerSubtitles({
    manifest,
    player,
    position,
    onError: setMessage,
    showLanguage: showTracks?.subtitleLanguage,
  });
  const loadAudioTracks = useEventCallback((tracks: AudioTrack[]) => {
    setNativeAudio(tracks);
    const manual = sessionAudio.current;
    const selected =
      (manual && tracks.find((track) => track.id === manual.id)) ||
      findLanguageTrack(tracks, showTracks?.audioLanguage, preferences.audioLanguage);
    if (selected) updateNativePlayer(player, "audioTrack", selected);
  });
  const updateShowTracks = (override?: ShowTrackPreferences) => {
    if (!showKey) return;
    const next = { ...preferences.showTrackPreferences };
    if (override) next[showKey] = override;
    else delete next[showKey];
    updatePreferences({ showTrackPreferences: next });
  };
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  useEffect(() => {
    updateNativePlayer(player, "bufferOptions", bufferOptionsForDuration(duration));
  }, [player, duration]);
  const startBoost = useEventCallback(() => {
    if (boostRef.current || !player.playing || ended) return;
    boostRef.current = true;
    try {
      updateNativePlayer(player, "playbackRate", 2);
    } catch {
      boostRef.current = false;
      return;
    }
    setBoosting(true);
    triggerHaptic("light");
  });
  const endBoost = useEventCallback(() => {
    if (!boostRef.current) return;
    boostRef.current = false;
    try {
      updateNativePlayer(
        player,
        "playbackRate",
        preferencesRef.current.playbackRate,
      );
    } catch {
      /* The player was released while the hold was active. */
    }
    setBoosting(false);
  });
  useLayoutEffect(() => {
    boostHold.current = { start: startBoost, end: endBoost };
  }, [startBoost, endBoost]);
  useEffect(() => {
    if (ended) endBoost();
  }, [ended, endBoost]);
  useEffect(() => () => endBoost(), [endBoost]);
  const save = useCallback(
    (completed = false, sync = false) => {
      if (!manifest.itemId || !initialized.current || pendingSeek.current || awaitingResume.current || remux.current?.resume) return;
      const length = durationRef.current;
      void progress
        .record({
          itemId: manifest.itemId,
          position: currentPosition.current,
          duration: length || undefined,
          played:
            completed ||
            (length > 0 && currentPosition.current >= length * 0.95),
          updatedAt: Date.now(),
        })
        .then(() => (sync ? progress.flush(api) : undefined))
        .catch(() => {});
    },
    [api, manifest.itemId, progress],
  );
  const castEnded = useRef(false);
  const endCastSleepTimer = useRef<() => void>(() => {});
  const cast = useCastPlayback(
    (state, first) => {
      if (first) {
        castEnded.current = false;
        player.pause();
        setAutoNextCancelled(true);
        setMessage("Playing on TV.");
      }
      currentPosition.current = state.position;
      setPosition(state.position);
      setPlaying(Boolean(state.playing));
      if (state.finished) {
        if (castEnded.current) return;
        castEnded.current = true;
        save(true, true);
        endCastSleepTimer.current();
        setEnded(true);
      } else if (Date.now() - lastSaved.current > 5000) {
        castEnded.current = false;
        lastSaved.current = Date.now();
        save();
      }
    },
    () => {
      updateNativePlayer(player, "currentTime", currentPosition.current);
      setPlaying(false);
      setMessage("Casting ended. Press play to continue here.");
    },
    setMessage,
  );
  const casting = cast.activeRef;
  const sleepPaused = useRef(false);
  const sleep = useSleepTimer(() => {
    sleepPaused.current = true;
    if (casting.current) cast.command("pause");
    else player.pause();
    setAutoNextCancelled(true);
    save(false, true);
    setMessage("Sleep timer ended.");
  }, sharedSleepTimer);
  const finishSleepTimer = sleep.finish;
  useLayoutEffect(() => { endCastSleepTimer.current = finishSleepTimer; }, [finishSleepTimer]);
  const seekBurst = useRef({ seconds: 0, at: 0 });
  const releaseOptimizedCopy = useEventCallback(() => {
    if (!remux.current) return;
    nativeMedia?.releasePlaybackRemux?.(remux.current.id);
    remux.current = null;
  });
  const prepareOptimizedCopy = useEventCallback(async (target?: number, resumePlayback: boolean = false) => {
    const media = nativeMedia;
    if (!media?.createPlaybackRemux || !media.preparePlaybackRemux ||
        !media.releasePlaybackRemux || !/^(file|content):\/\//.test(originalUri)) {
      if (target !== undefined) setMessage("Seeking is unavailable for this video on this device.");
      return;
    }
    seekUnsupported.current = true;
    setOptimizing(true);
    try {
      const job = {
        id: media.createPlaybackRemux(),
        originalPosition: currentPosition.current,
        target,
        resume: resumePlayback,
      };
      remux.current = job;
      const uri = await media.preparePlaybackRemux(job.id, originalUri);
      if (!mounted.current || remux.current !== job) return;
      if (casting.current || (job.target === undefined && player.duration > 0 && player.currentTime >= player.duration)) {
        releaseOptimizedCopy();
        return;
      }
      job.originalPosition = currentPosition.current;
      save(false, true);
      const start = job.target ?? job.originalPosition;
      const shouldPlay = job.resume || player.playing;
      job.resume = false;
      job.target = undefined;
      setChoice((old) => ({ ...old, uri, start, autoplay: shouldPlay }));
      reveal();
      setMessage("Using an optimized version for seeking. Embedded subtitles may be unavailable.");
    } catch {
      if (!mounted.current) return;
      const failed = remux.current;
      releaseOptimizedCopy();
      if (failed?.target !== undefined) {
        setMessage("Couldn’t prepare a seekable copy. Playing the original version.");
      }
      if (failed?.resume && !sleepPaused.current) player.play();
    } finally {
      if (mounted.current) setOptimizing(false);
    }
  });
  const restoreOriginal = useEventCallback(() => {
    if (!choice.uri || !remux.current) return false;
    const start = remux.current.originalPosition;
    seekUnsupported.current = true;
    releaseOptimizedCopy();
    setChoice((old) => ({ ...old, uri: undefined, start, revision: old.revision + 1 }));
    setMessage("Couldn’t play the optimized version. Returning to the original.");
    return true;
  });
  // Some containers (notably Matroska files without a usable cue index) make
  // ExoPlayer snap back to the start instead of honouring a seek. Check where
  // the player actually landed before preparing an indexed copy.
  const verifySeek = useEventCallback((target: number, attempt: number) => {
    const check = (nextAttempt: number) => {
      if (seekWatchdog.current) clearTimeout(seekWatchdog.current);
      seekWatchdog.current = setTimeout(() => {
        seekWatchdog.current = null;
        if (!mounted.current || casting.current) return;
        let actual = 0;
        try {
          actual = player.currentTime;
        } catch {
          return;
        }
        if (seekLanded(target, actual)) {
          pendingSeek.current = null;
          currentPosition.current = actual;
          setPosition(actual);
          try {
            updateNativePlayer(player, "seekTolerance", {
              toleranceBefore: 0.5,
              toleranceAfter: 0.5,
            });
          } catch {
            /* The player was released while the check was pending. */
          }
          return;
        }
        if (nextAttempt === 0) {
          try {
            updateNativePlayer(player, "seekTolerance", {
              toleranceBefore: 3,
              toleranceAfter: 3,
            });
          } catch {
            /* Fall through to the retry below. */
          }
          pendingSeek.current = { target, until: Date.now() + 4000 };
          updateNativePlayer(player, "currentTime", target);
          check(1);
          return;
        }
        pendingSeek.current = null;
        currentPosition.current = actual;
        setPosition(actual);
        if (!seekUnsupported.current && !choice.uri && !remux.current) {
          seekUnsupported.current = true;
          void prepareOptimizedCopy(target);
        } else {
          setMessage("This video could not seek to the requested position.");
        }
      }, nextAttempt === 0 ? 1800 : 2200);
    };
    check(attempt);
  });
  const seek = useEventCallback((seconds: number) => {
    const target = Math.max(
      0,
      Math.min(duration || Number.MAX_SAFE_INTEGER, seconds),
    );
    setScrub(null);
    setScrubCancelling(false);
    setEnded(false);
    setCountdown(10);
    setAutoNextCancelled(false);
    reveal();
    if (casting.current) {
      cast.command("seek", target);
      return;
    }
    if (remux.current && !choice.uri) {
      remux.current.target = target;
      return;
    }
    if (!initialized.current) return;
    pendingSeek.current = { target, until: Date.now() + 4000 };
    updateNativePlayer(player, "currentTime", target);
    currentPosition.current = target;
    setPosition(target);
    verifySeek(target, 0);
  });
  const startPlayback = useEventCallback((start: number) => {
    awaitingResume.current = false;
    setResume(false);
    reveal();
    if (!initialized.current) {
      chosenStart.current = start;
      autoplay.current = true;
      return;
    }
    if (start > 0 && remux.current && !choice.uri) {
      remux.current.target = start;
      remux.current.resume = true;
      return;
    }
    if (start > 0) seek(start);
    if (!sleepPaused.current) player.play();
  });
  const seekWithFeedback = useEventCallback((seconds: number) => {
    const now = Date.now();
    const previous = seekBurst.current;
    const repeated =
      now - previous.at < SEEK_BURST_MS &&
      Math.sign(previous.seconds) === Math.sign(seconds);
    const total = repeated ? previous.seconds + seconds : seconds;
    seekBurst.current = { seconds: total, at: now };
    seek((remux.current?.target ?? currentPosition.current) + seconds);
    triggerHaptic("light");
    setSeekNotice({ seconds: total, id: now });
    if (seekNoticeTimer.current) clearTimeout(seekNoticeTimer.current);
    seekNoticeTimer.current = setTimeout(
      () => setSeekNotice(null),
      SEEK_BURST_MS,
    );
  });
  useEffect(
    () => () => {
      if (seekNoticeTimer.current) clearTimeout(seekNoticeTimer.current);
      if (seekWatchdog.current) clearTimeout(seekWatchdog.current);
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseOptimizedCopy();
    };
  }, [releaseOptimizedCopy]);
  useEffect(() => {
    const subs = [
      player.addListener("timeUpdate", (e) => {
        if (!initialized.current || casting.current) return;
        const value = offset.current + e.currentTime;
        setBufferedPosition(Math.max(0, e.bufferedPosition));
        if (scrubRef.current != null) return;
        const pending = pendingSeek.current;
        if (pending && Date.now() < pending.until && !seekLanded(pending.target, value)) return;
        if (pending && seekLanded(pending.target, value)) {
          pendingSeek.current = null;
          if (seekWatchdog.current) {
            clearTimeout(seekWatchdog.current);
            seekWatchdog.current = null;
          }
        } else {
          pendingSeek.current = null;
        }
        currentPosition.current = value;
        setPosition(value);
        if (Date.now() - lastSaved.current > 5000) {
          lastSaved.current = Date.now();
          save();
        }
      }),
      player.addListener("playingChange", (e) => {
        if (casting.current) return;
        setPlaying(e.isPlaying);
        if (!e.isPlaying) {
          endBoost();
          save(false, true);
        }
      }),
      player.addListener("statusChange", (e) => {
        setStatus(e.status);
        if (e.status === "loading" || e.status === "error") endBoost();
        if (e.status === "loading" && initialized.current) {
          touchControls();
          setVisible(true);
        }
        if (e.status === "error") {
          if (restoreOriginal()) return;
          setError(
            "This device could not play the original file. Its video, audio or container format may be unsupported.",
          );
          setVisible(true);
        }
      }),
      player.addListener("sourceLoad", (e) => {
        if (
          !mounted.current ||
          (typeof e.videoSource === "object" &&
            e.videoSource?.uri !== expectedUri.current)
        )
          return;
        setHasLoaded(true);
        loadAudioTracks(e.availableAudioTracks);
        loadSubtitleTracks(e.availableSubtitleTracks);
        // A source can be reloaded while a seek is in flight (for example after
        // a decoder restart). Keep the requested target instead of falling back
        // to the initial resume point and looking like playback restarted.
        const pending = pendingSeek.current;
        const start =
          pending && Date.now() < pending.until
            ? pending.target
            : chosenStart.current;
        const shouldPrepare = !initialized.current && expectedUri.current === originalUri &&
          !seekUnsupported.current && e.isSeekable === false && e.availableVideoTracks.length > 0;
        if (shouldPrepare) void prepareOptimizedCopy(start > 0 ? start : undefined, start > 0);
        const queuedResume = start > 0 && Boolean(remux.current?.resume);
        const value = queuedResume ? 0 : Math.max(0, start - offset.current);
        if (!initialized.current && start > 0 && !queuedResume) {
          pendingSeek.current = { target: start, until: Date.now() + 4000 };
          verifySeek(start, seekUnsupported.current ? 1 : 0);
        }
        updateNativePlayer(player, "currentTime", value);
        currentPosition.current = queuedResume ? 0 : start;
        setPosition(currentPosition.current);
        if (!durationRef.current && e.duration > 0) setDuration(e.duration);
        initialized.current = true;
        setEnded(false);
        updateNativePlayer(player, "playbackRate", preferencesRef.current.playbackRate);
        if (!awaitingResume.current && !queuedResume && !sleepPaused.current && autoplay.current) player.play();
        else player.pause();
      }),
      player.addListener("playToEnd", () => {
        if (!initialized.current || casting.current) return;
        finishSleepTimer();
        if (currentPosition.current <= 10) return;
        save(true, true);
        setEnded(true);
        setVisible(true);
      }),
    ];
    return () => {
      save(false, true);
      subs.forEach((s) => s.remove());
    };
  }, [player, save, lastInteraction, loadAudioTracks, loadSubtitleTracks, setVisible, touchControls, endBoost, finishSleepTimer, casting, restoreOriginal, verifySeek, prepareOptimizedCopy, originalUri]);
  const [previousChoice, setPreviousChoice] = useState(choice);
  if (previousChoice !== choice) {
    setPreviousChoice(choice);
    setError("");
    setStatus("loading");
    setHasLoaded(false);
    setBufferedPosition(0);
  }
  useEffect(() => {
    if (choice.path === "unsupported") return;
    let live = true;
    initialized.current = false;
    pendingSeek.current = null;
    if (choice.uri) seekUnsupported.current = false;
    if (seekWatchdog.current) {
      clearTimeout(seekWatchdog.current);
      seekWatchdog.current = null;
    }
    try {
      updateNativePlayer(player, "seekTolerance", {
        toleranceBefore: 0.5,
        toleranceAfter: 0.5,
      });
    } catch {
      /* The player is being recreated. */
    }
    offset.current = 0;
    chosenStart.current = choice.start;
    autoplay.current = choice.autoplay ?? true;
    const uri = choice.uri ?? originalUri;
    expectedUri.current = uri;
    void player
      .replaceAsync({
        uri,
        contentType: "auto",
        metadata: {
          title: manifest.title || "Plexy",
          artist: manifest.subtitle || undefined,
        },
      })
      .catch(() => {
        if (live && !restoreOriginal())
          setError(
            "Could not open this local video. Check file access, then retry.",
          );
      });
    return () => {
      live = false;
    };
  }, [choice, originalUri, manifest.title, manifest.subtitle, player, restoreOriginal]);
  useEffect(() => { autoSkipEnd.current = -1; }, [manifest.fileId]);
  const validatedSkips = React.useMemo(() => localSegments(skips ?? { intro: null, recap: null, outro: null }, duration || null), [skips, duration]);
  useEffect(() => {
    const active = Object.values(validatedSkips).find(
      (segment) =>
        segment && position >= segment.start && position < segment.end,
    );
    if (
      scrub == null &&
      status !== "loading" &&
      !resume &&
      preferences.autoSkip &&
      active &&
      active.end !== autoSkipEnd.current
    ) {
      autoSkipEnd.current = active.end;
      seek(active.end);
    }
  }, [position, preferences.autoSkip, validatedSkips, scrub, status, resume, seek]);
  const activeSkip = Object.entries(validatedSkips).find(
    ([, segment]) =>
      segment && position >= segment.start && position < segment.end,
  );
  const skipLabel = activeSkip?.[0] === "outro" ? "credits" : activeSkip?.[0];
  const hasNextEpisode = Boolean(manifest.nextFileId || onlineNext);
  const playNextEpisode = useEventCallback(() => {
    save(false, true);
    // Prefer the online episode when the local next file skips a gap.
    if (onlineNext) {
      onNextOnline?.();
      return;
    }
    if (manifest.nextFileId) next(manifest.nextFileId);
  });
  // While the credits roll the next-episode countdown already runs, Netflix
  // style; "Watch credits" cancels it and keeps playing.
  const creditsPhase =
    !ended &&
    activeSkip?.[0] === "outro" &&
    scrub == null &&
    status !== "loading";
  const canAutoNext = hasNextEpisode && (sleep.choice === "off" || !onlineNext);
  const creditsPills =
    creditsPhase &&
    preferences.autoNext &&
    sleep.choice !== "end" &&
    !cast.active &&
    canAutoNext &&
    !autoNextCancelled;
  const [previousCreditsPhase, setPreviousCreditsPhase] = useState(creditsPhase);
  if (previousCreditsPhase !== creditsPhase) {
    setPreviousCreditsPhase(creditsPhase);
    if (creditsPhase) setCountdown(10);
  }
  useEffect(() => {
    if (
      (!ended && !creditsPhase) ||
      !preferences.autoNext ||
      autoNextCancelled ||
      sleep.choice === "end" ||
      cast.active ||
      !canAutoNext
    )
      return;
    const timer = setTimeout(() => {
      if (countdown <= 1) playNextEpisode();
      else setCountdown((n) => n - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    ended,
    creditsPhase,
    preferences.autoNext,
    autoNextCancelled,
    sleep.choice,
    cast.active,
    canAutoNext,
    countdown,
    playNextEpisode,
  ]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        endBoost();
        save(false, true);
        // Expo handles background pausing natively. Pausing here races Android's
        // home-gesture PiP transition, whose start callback can arrive later.
        // Unless background play is on, playback stops when the native view
        // is not entering PiP (for example when the device locks).
      } else reveal();
    });
    return () => sub.remove();
  }, [player, save, reveal, endBoost]);
  const exit = useEventCallback(() => {
    save(false, true);
    player.pause();
    back();
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (lockedRef.current) {
        unlockScreen();
        return true;
      }
      if (speedPanel) {
        setSpeedPanel(false);
        return true;
      }
      if (audioPanel) {
        setAudioPanel(false);
        return true;
      }
      if (menu) {
        setMenu(null);
        return true;
      }
      exit();
      return true;
    });
    return () => sub.remove();
  }, [menu, speedPanel, audioPanel, exit, lockedRef, unlockScreen, setAudioPanel, setSpeedPanel, setMenu]);
  const togglePlay = () => {
    sleepPaused.current = false;
    reveal();
    if (ended) seek(0);
    if (casting.current) cast.command(playing ? "pause" : "play");
    else if (player.playing) player.pause();
    else player.play();
  };
  const previewTime = scrub ?? position;
  const chapters = React.useMemo(
    () => [...(manifest.chapters ?? [])].sort((a, b) => a.start - b.start),
    [manifest.chapters],
  );
  const scrubChapter = React.useMemo(() => {
    if (scrub == null || chapters.length === 0) return null;
    let current = null;
    for (const chapter of chapters) {
      if (chapter.start <= scrub) current = chapter;
      else break;
    }
    return current;
  }, [scrub, chapters]);

  const show =
    !resume && (visible || !!menu || speedPanel || audioPanel || ended || !!error);
  const openingVideo = shouldShowPlayerLoading(
    status,
    hasLoaded,
    scrub != null,
  );
  // Track geometry of TimelineBar (row inset 24 + 52px labels + 12px gaps) so
  // the scrub preview can track the thumb position.
  const trackWidth = Math.max(60, win.width - 176);
  const scrubRatio = duration
    ? Math.min(1, Math.max(0, (scrub ?? 0) / duration))
    : 0;
  const chromeTitle = (() => {
    if (manifest.seasonNumber != null && manifest.episodeNumber != null) {
      const cleaned = (manifest.subtitle || "")
        .replace(
          /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
          "",
        )
        .trim();
      return `S${manifest.seasonNumber}:E${manifest.episodeNumber}${
        cleaned ? ` "${cleaned}"` : ""
      }`;
    }
    return manifest.title || "Plexy";
  })();

  useEffect(() => {
    if (resume) {
      resumeBackdropOpacity.setValue(0);
      resumeCardOpacity.setValue(0);
      resumeCardScale.setValue(0.94);
      Animated.parallel([
        Animated.timing(resumeBackdropOpacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : 200,
          easing: easings.out,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(reduceMotion ? 0 : 60),
          Animated.parallel([
            Animated.timing(resumeCardOpacity, {
              toValue: 1,
              duration: reduceMotion ? 0 : 240,
              easing: easings.out,
              useNativeDriver: true,
            }),
            Animated.timing(resumeCardScale, {
              toValue: 1,
              duration: reduceMotion ? 0 : 240,
              easing: easings.out,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    }
  }, [resume, reduceMotion, resumeBackdropOpacity, resumeCardOpacity, resumeCardScale]);
  useEffect(() => {
    if (hasLoaded) {
      chromeIn.setValue(0);
      Animated.timing(chromeIn, {
        toValue: 1,
        duration: reduceMotion ? 0 : 220,
        easing: easings.out,
        useNativeDriver: true,
      }).start();
    }
  }, [hasLoaded, reduceMotion, chromeIn]);
  const videoViewProps = {
    ref: video,
    player,
    surfaceType: "textureView" as const,
    fullscreenOptions: { enable: false },
    allowsPictureInPicture: true,
    // Arm the system home gesture only for active playback. Keeping this false
    // while paused or finished prevents the app shrinking into an idle PiP.
    startsPictureInPictureAutomatically:
      playing && hasLoaded && !ended && isPictureInPictureSupported(),
    onPictureInPictureStart: () => {
      pip.current = true;
    },
    onPictureInPictureStop: () => {
      pip.current = false;
      reveal();
    },
    contentFit: fitMode,
    subtitleFontSize: preferences.subtitleSize,
  };
  return (
    <View className="flex-1 bg-black">
      <StatusBar hidden barStyle="light-content" />
      <GestureDetector gesture={videoGestures}>
      <View collapsable={false} className="absolute inset-0">
        <Reanimated.View
          style={[StyleSheet.absoluteFill, zoomStyle]}
        >
          <VideoView
            {...videoViewProps}
            nativeControls={false}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>
        <Reanimated.View
          pointerEvents="none"
          className="absolute inset-0 bg-black"
          style={brightnessStyle}
        />

        {openingVideo && !resume && <PlayerLoading />}
        {(optimizing || (choice.uri && visible)) && (
          <View
            pointerEvents="none"
            className="absolute self-center rounded-full bg-black/80 px-4 py-2"
            style={{ top: Math.max(insets.top, 10) + 36 }}
          >
            <Text className="text-[13px] text-white" accessibilityLiveRegion="polite">
              {optimizing ? "Preparing optimized version…" : "Optimized version"}
            </Text>
          </View>
        )}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 50,
            alignSelf: "center",
            backgroundColor: "rgba(10, 10, 14, 0.9)",
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 22,
            borderWidth: 1.2,
            borderColor: "rgba(255, 255, 255, 0.25)",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 8,
            elevation: 8,
            zIndex: 999,
            opacity: toastOpacity,
            transform: [{ scale: toastScale }],
          }}
        >
          <Text className="text-white text-[14px] font-archivo-bold tracking-[0.2px]">
            {fitToast ?? ""}
          </Text>
        </Animated.View>
        <View className="absolute inset-0" collapsable={false}>
          <Pressable
            accessible={false}
            focusable={false}
            onLayout={(event) => {
              setViewportWidth(event.nativeEvent.layout.width);
            }}
            onPress={onTap}
            onLongPress={beginHold}
            delayLongPress={HOLD_TO_BOOST_MS}
            onPressOut={finishHold}
            className="absolute inset-0"
          />
        </View>
        {seekNotice && !locked && (
          <SeekSideOverlay
            key={seekNotice.id}
            seconds={seekNotice.seconds}
          />
        )}
        {boosting && (
          <View
            pointerEvents="none"
            className="absolute top-24 self-center rounded-full border border-white/20 bg-black/70 px-4 py-2"
          >
            <Text className="font-archivo-bold text-white">2× speed</Text>
          </View>
        )}
        {locked && (
          <>
            <Pressable
              className="absolute inset-0"
              onPress={showUnlockHint}
              accessibilityRole="button"
              accessibilityLabel="Screen locked. Tap to show the unlock button."
            />
            {unlockHint && (
              <View
                className="absolute inset-0 items-center justify-center"
                pointerEvents="box-none"
              >
                <Pressable
                  onPress={unlockScreen}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock screen"
                  className="flex-row items-center gap-2 rounded-full bg-white/[0.94] px-5 py-3 active:opacity-80"
                >
                  <Unlock size={18} color="#000000" strokeWidth={2.4} />
                  <Text className="text-black text-[15px] font-bold">
                    Tap to unlock
                  </Text>
                </Pressable>
              </View>
            )}
            <View
              className="absolute top-5 right-5 h-8 w-8 items-center justify-center rounded-[16px] bg-white/10 border border-white/[0.18]"
              pointerEvents="none"
            >
              <Lock size={13} color="rgba(255,255,255,0.7)" strokeWidth={2.2} />
            </View>
          </>
        )}
        {!!text && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: "6%",
              right: "6%",
              top: `${show && subVertical > 60 ? Math.min(subVertical, 65) : subVertical}%`,
              alignItems: "center",
              transform: [{ translateY: subVertical > 50 ? -24 : 0 }],
            }}
          >
            <Text
              style={{
                fontSize: preferences.subtitleSize,
                lineHeight: preferences.subtitleSize * 1.35,
                color: "#fff",
                backgroundColor: "rgba(0,0,0,0.8)",
                paddingHorizontal: 8,
                textAlign: "center",
              }}
            >
              {text}
            </Text>
          </View>
        )}
      </View>
      </GestureDetector>
      {show && !locked && (
        <Animated.View
          className="absolute inset-0"
          pointerEvents="box-none"
          style={{ opacity: chromeIn }}
          onTouchStart={() => { touchControls(); }}
          onTouchEnd={() => { touchControls(); }}
        >
          <LinearGradient pointerEvents="none" colors={["transparent", "rgba(0,0,0,0.88)"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 170 }} />
          {!openingVideo && !ended && !creditsPills && (
            <TimelineBar
              duration={duration}
              value={previewTime}
              buffered={bufferedPosition}
              scrubbing={scrub != null}
              chapters={chapters}
              seekStep={preferences.seekSeconds}
              bottom={Math.max(insets.bottom, 8) + 52}
              onScrub={(target, cancelling) => {
                reveal();
                setScrub(target);
                setScrubCancelling(cancelling);
              }}
              onCommit={(target) => {
                setScrubCancelling(false);
                seek(target);
              }}
              onCancel={() => {
                setScrub(null);
                setScrubCancelling(false);
                reveal();
              }}
            />
          )}
          {!openingVideo && scrub != null && !ended && !creditsPills && (
            <View
              pointerEvents="none"
              className="absolute items-center gap-1.5"
              style={{
                left: Math.max(
                  106,
                  Math.min(
                    win.width - 106,
                    24 + 52 + 12 + scrubRatio * trackWidth,
                  ),
                ),
                bottom: Math.max(insets.bottom, 8) + 100,
                transform: [{ translateX: -100 }],
              }}
            >
              {!externalSource && !cast.active ? <LocalThumbnail
                key={manifest.fileId}
                player={player}
                time={scrub}
                fileId={manifest.fileId}
                width={200}
                height={113}
              /> : null}
              <View className="max-w-[260px] rounded-[6px] border border-white/20 bg-black/85 px-2 py-[3px]">
                <Text
                  numberOfLines={1}
                  className="text-[11px] font-archivo-bold text-white"
                >
                  {scrubCancelling
                    ? "Release to cancel"
                    : `${timeLabel(scrub)}${scrubChapter?.label ? ` · ${scrubChapter.label}` : ""}`}
                </Text>
              </View>
            </View>
          )}
          {!openingVideo && !ended && !creditsPills && (
            <BottomToolbar
              speed={preferences.playbackRate}
              bottom={Math.max(insets.bottom, 8) + 10}
              onSpeed={() => setSpeedPanel(true)}
              onLock={lockScreen}
              showEpisodes={isTvShow && sortedEpisodes.length > 0}
              onEpisodes={() => setMenu("episodes")}
              onAudioSubtitles={() => setAudioPanel(true)}
              showNext={hasNextEpisode}
              onNext={playNextEpisode}
            />
          )}
          {!openingVideo && !ended && (
            <View
              pointerEvents="none"
              className="absolute left-0 right-0 items-center"
              style={{ top: Math.max(insets.top, 10) + 10 }}
            >
              <Text
                numberOfLines={1}
                className="max-w-[55%] text-center text-[15px] font-archivo-bold text-white/95"
              >
                {chromeTitle}
              </Text>
            </View>
          )}
          <View
            className="absolute"
            style={{
              left: Math.max(insets.left, 10) + 12,
              top: Math.max(insets.top, 10) + 8,
            }}
          >
            <PlayerControl accessibilityLabel="Close player" onPress={exit} size={48} bg="rgba(0,0,0,0.4)">
              <ArrowLeft strokeWidth={2.2} color="#ffffff" size={20} />
            </PlayerControl>
          </View>
          <View
            className="absolute flex-row items-center gap-2"
            style={{
              right: Math.max(insets.right, 10) + 12,
              top: Math.max(insets.top, 10) + 8,
            }}
          >
            <PlayerControl accessibilityLabel={`Video fit: ${fitMode}. Change fit`} size={48} bg="rgba(0,0,0,0.4)" onPress={() => {
              const modes = ["contain", "cover", "fill"] as const;
              const mode = modes[(modes.indexOf(fitMode) + 1) % modes.length]!;
              applyFit(mode, 1);
              showFitToast(mode === "contain" ? "Best fit" : mode === "cover" ? "Crop" : "Stretch");
            }}>
              {fitMode === "cover" ? <Crop size={22} color="#fff" /> : fitMode === "fill" ? <MoveHorizontal size={22} color="#fff" /> : <Maximize size={22} color="#fff" />}
            </PlayerControl>
            {isPictureInPictureSupported() && <PlayerControl accessibilityLabel="Picture in picture" size={48} bg="rgba(0,0,0,0.4)" onPress={() => {
              void video.current?.startPictureInPicture().catch(() => setMessage("Picture in picture is unavailable on this device."));
            }}><PictureInPicture size={22} color="#fff" /></PlayerControl>}
            <PlayerControl
              accessibilityLabel="Player settings"
              onPress={() => setMenu("settings")}
              size={48}
              bg="rgba(0,0,0,0.4)"
              active={menu === "settings"}
            >
              {({ focused }) => (
                <SlidersHorizontal
                  strokeWidth={2}
                  size={20}
                  color={
                    menu === "settings"
                      ? "#000000"
                      : focused
                        ? "#ffffff"
                        : "rgba(255,255,255,0.9)"
                  }
                />
              )}
            </PlayerControl>
          </View>
          <Animated.View
            className="absolute left-0 right-0 flex-row items-center justify-center gap-10"
            style={{ top: 0, bottom: 0 }}
            pointerEvents={openingVideo || ended ? "none" : "box-none"}
            accessibilityElementsHidden={openingVideo || ended}
            importantForAccessibility={
              openingVideo || ended ? "no-hide-descendants" : "auto"
            }
          >
            <PlayerControl
              onPress={() => seekWithFeedback(-preferences.seekSeconds)}
              size={56}
              bg="transparent"
              accessibilityLabel={`Back ${preferences.seekSeconds} seconds`}
            >
              <IconSeekBack size={28} seconds={preferences.seekSeconds} />
            </PlayerControl>

            <Pressable
              onPress={() => { triggerHaptic("light"); togglePlay(); }}
              accessibilityRole="button"
              accessibilityLabel={playing ? "Pause" : "Play"}
              hitSlop={14}
              className="p-3"
              style={({ pressed }) => ({
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              })}
            >
              {playing ? (
                <Pause fill="#ffffff" size={44} color="#ffffff" />
              ) : (
                <Play fill="#ffffff" size={46} color="#ffffff" />
              )}
            </Pressable>

            <PlayerControl
              onPress={() => seekWithFeedback(preferences.seekSeconds)}
              size={56}
              bg="transparent"
              accessibilityLabel={`Forward ${preferences.seekSeconds} seconds`}
            >
              <IconSeekForward size={28} seconds={preferences.seekSeconds} />
            </PlayerControl>
          </Animated.View>
          {!openingVideo && !ended && (
            <PlayerGestureHud
              brightness={brightnessValue}
              volume={volumeValue}
              adjusting={adjusting}
            />
          )}
          {(!!error || choice.path === "unsupported") && (
            <View
              className="absolute left-16 right-16 items-center"
              style={{ top: Math.max(insets.top, 10) + 56 }}
              pointerEvents="box-none"
            >
              <Notice
                message={error || manifest.reason}
                retry={() =>
                  setChoice((old) => ({
                    ...old,
                    start: currentPosition.current,
                    revision: old.revision + 1,
                  }))
                }
              />
            </View>
          )}
          {!!message && (
            <View
              className="absolute left-16 right-16 items-center"
              style={{ bottom: Math.max(insets.bottom, 10) + 116 }}
              pointerEvents="none"
            >
              <Text className="text-center text-[13px] text-white/85">
                {message}
              </Text>
            </View>
          )}
        </Animated.View>
      )}
      {(ended || creditsPills) && (
        <View
          className="absolute flex-row items-end gap-3"
          style={{
            right: Math.max(insets.right, 10) + 24,
            bottom: Math.max(insets.bottom, 8) + 16,
          }}
          pointerEvents="box-none"
        >
          {ended ? (
            <EndPill
              label="Play again"
              variant="dark"
              onPress={() => seek(0)}
            />
          ) : (
            <EndPill
              label="Watch credits"
              variant="dark"
              onPress={() => setAutoNextCancelled(true)}
            />
          )}
          {hasNextEpisode && (
            <EndPill
              label="Next Episode"
              variant="light"
              fill={
                preferences.autoNext && !autoNextCancelled
                  ? 1 - countdown / 10
                  : undefined
              }
              onPress={playNextEpisode}
            />
          )}
          {ended &&
            preferences.autoNext &&
            !autoNextCancelled &&
            hasNextEpisode && (
              <EndPill
                label="Cancel"
                variant="ghost"
                onPress={() => setAutoNextCancelled(true)}
              />
            )}
        </View>
      )}
      {!locked &&
        activeSkip &&
        !creditsPills &&
        scrub == null &&
        status !== "loading" &&
        !resume &&
        !menu &&
        !speedPanel &&
        !audioPanel &&
        !ended && (
          <View
            className="absolute"
            style={{
              right: Math.max(insets.right, 10) + 40,
              bottom: Math.max(insets.bottom, 8) + 116,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Skip ${skipLabel}`}
              onPress={() => seek(activeSkip[1]!.end)}
              className="rounded-full bg-white/[0.92] px-[18px] py-[10px] active:opacity-85"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Text className="text-black font-bold text-[14px]">
                Skip {skipLabel}
              </Text>
            </Pressable>
          </View>
        )}
      {resume && (
        <Animated.View
          className="absolute inset-0 items-center justify-center bg-black/[0.72] p-6 z-[100]"
          style={{ opacity: resumeBackdropOpacity }}
        >
          <Animated.View
            className="flex-row items-stretch justify-center gap-3"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.6,
              shadowRadius: 16,
              elevation: 10,
              opacity: resumeCardOpacity,
              transform: [{ scale: resumeCardScale }],
            }}
          >
            <Pressable
              onPress={() => {
                triggerHaptic("light");
                startPlayback(initialResume);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Continue watching from ${timeLabel(initialResume)}`}
              className="rounded-[14px] bg-white px-5 py-4 active:opacity-85"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text className="text-black font-archivo-bold text-[15px]">
                Continue watching ({timeLabel(initialResume)})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                triggerHaptic("light");
                startPlayback(0);
              }}
              accessibilityRole="button"
              accessibilityLabel="Start from beginning"
              className="rounded-[14px] bg-white/20 border border-white/40 px-5 py-4 active:opacity-85"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text className="text-white font-archivo-medium text-[15px]">
                Start from beginning
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}
      <PlayerDrawer
        menu={menu}
        sleep={sleep}
        extraActions={[
          ...(addExternalToLibrary ? [{ label: "Add to library", onPress: addExternalToLibrary }] : []),
          ...(cast.available && !optimizing ? [cast.active
            ? { label: "Stop casting", onPress: () => cast.command("stop") }
            : { label: "Cast to TV", onPress: () => {
              try {
                cast.start(externalSource ?? api.stream(manifest.fileId), manifest.title ?? "Plexy", currentPosition.current);
              } catch {
                setMessage("This video couldn’t be opened for casting.");
              }
            } }] : []),
        ]}
        setMenu={setMenu}
        sortedEpisodes={sortedEpisodes}
        reveal={reveal}
        insets={insets}
        manifest={manifest}
        next={next}
        picture={{
          fitMode,
          applyFit,
          startPictureInPicture: () => {
            pip.current = true;
            void video.current?.startPictureInPicture().catch(() => {
              pip.current = false;
              setMessage("Picture in picture is unavailable on this device.");
            });
          },
        }}
        subtitles={{ position: subVertical, setPosition: setSubVertical }}
        setPlaybackRate={(rate) => {
          updateNativePlayer(player, "playbackRate", rate);
          updatePreferences({ playbackRate: rate });
        }}
      />
      <SpeedPanel
        visible={speedPanel && !locked}
        rate={preferences.playbackRate}
        onClose={() => setSpeedPanel(false)}
        onSelect={(rate) => {
          updateNativePlayer(player, "playbackRate", rate);
          updatePreferences({ playbackRate: rate });
          setSpeedPanel(false);
          showFitToast(`${rate}× speed`);
        }}
      />
      <AudioPanel
        visible={audioPanel && !locked}
        onClose={() => setAudioPanel(false)}
        player={player}
        nativeAudio={nativeAudio}
        subtitle={subtitle}
        serverTracks={manifest.tracks}
        nativeSubtitles={nativeSubtitles}
        canAddSubtitleFile={Boolean(!externalSource && runtime.pickSubtitle)}
        onSearchSubtitles={!externalSource && runtime.saveSubtitle ? () => {
          setAudioPanel(false);
          setSubtitleSearch(true);
        } : undefined}
        canRememberShow={Boolean(showKey)}
        showOverrideLabel={showTracks && [
          showTracks.audioLanguage && `Audio · ${mediaLanguageName(showTracks.audioLanguage) ?? showTracks.audioLanguage}`,
          showTracks.subtitleLanguage === null
            ? "Subtitles off"
            : showTracks.subtitleLanguage && `Subtitles · ${mediaLanguageName(showTracks.subtitleLanguage) ?? showTracks.subtitleLanguage}`,
        ].filter(Boolean).join("  /  ")}
        onClearShowOverride={() => {
          updateShowTracks();
          sessionAudio.current = null;
          const track = findLanguageTrack(nativeAudio, preferences.audioLanguage) ??
            nativeAudio.find((entry) => entry.isDefault) ??
            nativeAudio[0];
          if (track) updateNativePlayer(player, "audioTrack", track);
          resetSubtitle();
          setAudioPanel(false);
        }}
        onPickAudio={(track, remember) => {
          sessionAudio.current = track;
          updateNativePlayer(player, "audioTrack", track);
          if (remember) {
            const audioLanguage = languageTag(track.language);
            if (audioLanguage) updateShowTracks({ ...showTracks, audioLanguage });
            else setMessage("This audio track has no language to save for the show.");
          }
          setAudioPanel(false);
        }}
        onPickSubtitle={(value, remember) => {
          pickSubtitle(value);
          if (remember) {
            const track = value?.startsWith("native:")
              ? nativeSubtitles.find((entry) => `native:${entry.id}` === value)
              : manifest.tracks?.find((entry) => entry.track === value);
            const subtitleLanguage = value === null ? null : languageTag(track?.language);
            if (subtitleLanguage !== undefined) updateShowTracks({ ...showTracks, subtitleLanguage });
            else setMessage("This subtitle track has no language to save for the show.");
          }
          setAudioPanel(false);
        }}
        onAddSubtitleFile={() => {
          void runtime.pickSubtitle!(manifest.fileId)
            .then((track) => {
              if (!track) return;
              setManifest((current) => ({
                ...current,
                tracks: [
                  ...(current.tracks || []).filter(
                    (t) => t.track !== track.track,
                  ),
                  track,
                ],
              }));
              pickSubtitle(track.track);
              setAudioPanel(false);
            })
            .catch(() =>
              setMessage(
                "Could not add this subtitle file. Choose an SRT or VTT file.",
              ),
            );
        }}
      />
      {subtitleSearch && runtime.saveSubtitle ? (
        <SubtitleSearch
          file={manifest}
          language={showTracks?.subtitleLanguage || preferences.subtitleLanguage}
          close={() => setSubtitleSearch(false)}
          save={async (result, content) => {
            const track = await runtime.saveSubtitle!(manifest.fileId, result.name, result.language, content);
            setManifest((current) => ({ ...current, tracks: [...(current.tracks ?? []), track] }));
            pickSubtitle(track.track);
            setSubtitleSearch(false);
          }}
        />
      ) : null}
    </View>
  );
}
