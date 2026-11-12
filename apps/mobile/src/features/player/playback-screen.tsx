import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as Orientation from "expo-screen-orientation";
import {
isPictureInPictureSupported,
useVideoPlayer,
VideoView,
} from "expo-video";
import React,{ useCallback,useEffect,useRef,useState } from "react";
import {
Animated,
AppState,
BackHandler,
Easing,
PanResponder,
Pressable,
ScrollView,
StatusBar,
StyleSheet,
Text,
View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localSegments } from "../../../../../packages/local-library/src/library";
import { useClient } from "../../core/client/client-provider";
import type {
ItemCard,
Playability,
SkipSegments,
} from "../../core/library/catalog-api";
import { useReducedMotion } from "../../shared/hooks/use-reduced-motion";
import { cn } from "../../shared/lib/cn";
import { colors,fonts,timeLabel } from "../../shared/theme";
import { ListVideo,Lock,SkipBack,Unlock } from "../../shared/ui/icons";
import { Notice } from "../../shared/ui/notice";
import { Label } from "../../shared/ui/text";
import { LocalThumbnail } from "./components/local-thumbnail";
import { PlayerControl } from "./components/player-control";
import { PlayerDrawer } from "./components/player-drawer";
import {
IconAudio,
IconBack,
IconClose,
IconFitState,
IconForward,
IconFullscreen,
IconNext,
IconPause,
IconPip,
IconPlay,
IconRewind,
IconSettings,
IconSubtitles,
} from "./components/player-icons";
import { PlayerLoading } from "./components/player-loading";
import { usePlayerOrientation } from "./hooks/use-player-orientation";
import { bufferOptionsForDuration } from "./lib/player-buffer";
import {
clampZoom,
DOUBLE_TAP_MS,
doubleTapSeek,
pinchZoom,
SEEK_SECONDS,
shouldShowPlayerLoading,
type PlayerTap,
} from "./lib/player-interactions";
import { parseVtt,subtitleText,type Cue } from "./lib/subtitles";

interface SourceChoice {
  path: string;
  audio: number;
  start: number;
  maxHeight?: number;
  uri?: string;
  revision: number;
}

export function PlaybackScreen({
  initial,
  back,
  next,
}: {
  initial: Playability;
  back: () => void;
  next: (id: number) => void;
}) {
  useKeepAwake();
  const { api, platform, preferences, updatePreferences, progress } =
    useClient();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
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
  const [started, setStarted] = useState(!initialResume);
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
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const [fullscreen, setFullscreen] = useState(true);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<
    "settings" | "audio" | "captions" | "quality" | "episodes" | null
  >(null);
  const drawerAnim = useRef(new Animated.Value(560)).current;
  const resumeBackdropOpacity = useRef(new Animated.Value(0)).current;
  const resumeCardOpacity = useRef(new Animated.Value(0)).current;
  const resumeCardScale = useRef(new Animated.Value(0.94)).current;
  useEffect(() => {
    if (menu != null) {
      if (reduceMotion) {
        Animated.timing(drawerAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.spring(drawerAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 32,
          stiffness: 320,
          mass: 1,
        }).start();
      }
    } else {
      Animated.timing(drawerAnim, {
        toValue: 560,
        duration: reduceMotion ? 0 : 180,
        easing: Easing.bezier(0.32, 0, 1, 1),
        useNativeDriver: true,
      }).start();
    }
  }, [menu, reduceMotion]);
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
      setEpisodesList(manifest.episodes);
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
    return [...episodesList].sort((a, b) => {
      const sDiff = (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1);
      if (sDiff !== 0) return sDiff;
      return (a.episodeNumber ?? 1) - (b.episodeNumber ?? 1);
    });
  }, [episodesList]);
  const currentEpIndex = sortedEpisodes.findIndex(
    (ep) =>
      ep.fileId === manifest.fileId ||
      ep.id === manifest.itemId ||
      (ep.seasonNumber === manifest.seasonNumber &&
        ep.episodeNumber === manifest.episodeNumber),
  );
  const episodesScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (menu === "episodes" && currentEpIndex > 0) {
      const timer = setTimeout(() => {
        episodesScrollRef.current?.scrollTo({
          y: Math.max(0, currentEpIndex * 68),
          animated: false,
        });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [menu, currentEpIndex]);
  const [subtitle, setSubtitle] = useState<string | null>(() =>
    preferences.autoSubtitles
      ? initial.tracks?.find((t) => t.language === preferences.subtitleLanguage)
          ?.track ||
        initial.tracks?.find((t) => t.isDefault)?.track ||
        null
      : null,
  );
  const [cues, setCues] = useState<Cue[]>([]);
  const [skips, setSkips] = useState<SkipSegments>({
    intro: null,
    recap: null,
    outro: null,
  });
  const [scrub, setScrub] = useState<number | null>(null);
  const [timelineFocus, setTimelineFocus] = useState(false);
  const [] = useState<number | undefined>();
  const timeline = useRef<View>(null);
  type FitMode = "contain" | "cover" | "fill";
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<PlayerTap | null>(null);
  const gestureBlockedUntil = useRef(0);
  const viewportWidth = useRef(1);
  const cancelPendingTap = () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null;
    lastTap.current = null;
  };
  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );
  const [fitToast, setFitToast] = useState<string | null>(null);
  const toastTimeout = useRef<any>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastScale = useRef(new Animated.Value(0.88)).current;
  // Screen lock: controls ignore input until the viewer unlocks.
  const [locked, setLocked] = useState(false);
  const [unlockHint, setUnlockHint] = useState(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFitToast = (label: string) => {
    setFitToast(label);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setFitToast(null), 1800);
  };
  useEffect(() => {
    if (fitToast) {
      toastOpacity.setValue(0);
      toastScale.setValue(0.88);
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : 160,
          easing: Easing.bezier(0.23, 1, 0.32, 1),
          useNativeDriver: true,
        }),
        Animated.timing(toastScale, {
          toValue: 1,
          duration: reduceMotion ? 0 : 160,
          easing: Easing.bezier(0.23, 1, 0.32, 1),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 120,
        easing: Easing.bezier(0.32, 0, 1, 1),
        useNativeDriver: true,
      }).start();
    }
  }, [fitToast, reduceMotion]);
  const applyFit = (mode: FitMode, scale: number) => {
    setFitMode(mode);
    const nextZoom = clampZoom(scale);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    showFitToast(
      scale === 1
        ? mode === "contain"
          ? "Best fit"
          : mode === "cover"
            ? "Crop to fill"
            : "Stretch to fill"
        : `${Math.round(scale * 100)}% zoom`,
    );
  };
  const FIT_PRESETS: Array<{
    mode: FitMode;
    zoom: number;
    label: string;
  }> = [
    { mode: "contain", zoom: 1, label: "Best fit" },
    { mode: "contain", zoom: 1.05, label: "105% zoom" },
    { mode: "contain", zoom: 1.2, label: "120% zoom" },
    { mode: "cover", zoom: 1, label: "Crop to fill" },
    { mode: "fill", zoom: 1, label: "Stretch to fill" },
  ];
  const cycleFitMode = () => {
    const currentIndex = FIT_PRESETS.findIndex(
      (preset) => preset.mode === fitMode && preset.zoom === zoom,
    );
    const next = FIT_PRESETS[(currentIndex + 1) % FIT_PRESETS.length]!;
    applyFit(next.mode, next.zoom);
  };
  const initialPinchDist = useRef<number | null>(null);
  const initialZoom = useRef(1);
  const pinchPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (evt) => {
        cancelPendingTap();
        gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const t0 = touches[0]!;
          const t1 = touches[1]!;
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          initialPinchDist.current = Math.hypot(dx, dy);
          initialZoom.current = zoomRef.current;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (
          touches.length >= 2 &&
          initialPinchDist.current &&
          initialPinchDist.current > 0
        ) {
          const t0 = touches[0]!;
          const t1 = touches[1]!;
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          const currentDist = Math.hypot(dx, dy);
          const newZoom = pinchZoom(
            initialZoom.current,
            initialPinchDist.current,
            currentDist,
          );
          zoomRef.current = newZoom;
          setZoom(newZoom);
          showFitToast(`${Math.round(newZoom * 100)}% zoom`);
        }
      },
      onPanResponderRelease: () => {
        initialPinchDist.current = null;
        gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
      },
      onPanResponderTerminate: () => {
        initialPinchDist.current = null;
        gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
      },
    }),
  ).current;
  const [] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [autoNextCancelled, setAutoNextCancelled] = useState(false);
  const [drawerWatchedOverride, setDrawerWatchedOverride] = useState<
    Record<number, boolean>
  >({});
  const toggleDrawerEpWatched = useCallback(
    async (ep: any) => {
      const isPlayed =
        drawerWatchedOverride[ep.id] ??
        (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
      const nextPlayed = !isPlayed;
      setDrawerWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
      try {
        if (nextPlayed) {
          const dur = ep.runtime ? ep.runtime * 60 : ep.watch?.duration || 3600;
          await progress.record({
            itemId: ep.id,
            position: dur,
            duration: dur,
            played: true,
            updatedAt: Date.now(),
          });
        } else {
          await progress.forget(ep.id);
        }
        await api.watched(ep.id, nextPlayed);
      } catch {}
    },
    [api, progress, drawerWatchedOverride],
  );
  const [nativeAudio, setNativeAudio] = useState<
    typeof player.availableAudioTracks
  >([]);
  const [nativeSubtitles, setNativeSubtitles] = useState<
    typeof player.availableSubtitleTracks
  >([]);
  const [subVertical, setSubVertical] = useState<number>(
    preferences.subtitlePosition === "top" ? 12 : 88,
  );
  const [] = useState(1);
  const expectedUri = useRef("");

  const video = useRef<VideoView>(null);
  const offset = useRef(0);
  const currentPosition = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const autoSkipEnd = useRef(-1);
  const mounted = useRef(true);
  const pip = useRef(false);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const playingRef = useRef(false);
  const lastSaved = useRef(0);
  const timelineWidth = useRef(1);
  const lastInteraction = useRef(Date.now());
  const chosenStart = useRef(0);
  const initialized = useRef(false);
  const scrubTargetRef = useRef<number | null>(null);
  const scrubCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const player = useVideoPlayer(null, (instance) => {
    instance.bufferOptions = bufferOptionsForDuration(initial.duration || 0);
    instance.timeUpdateEventInterval = 0.5;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
  });
  useEffect(() => {
    player.bufferOptions = bufferOptionsForDuration(duration);
  }, [player, duration]);
  const save = useCallback(
    (completed = false) => {
      if (!manifest.itemId || !initialized.current) return;
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
        .then(() => progress.flush(api))
        .catch(() => {});
    },
    [api, manifest.itemId, progress],
  );
  const reveal = () => {
    if (lockedRef.current) return;
    lastInteraction.current = Date.now();
    setVisible(true);
  };
  const lockScreen = () => {
    setMenu(null);
    setVisible(false);
    setUnlockHint(false);
    setLocked(true);
  };
  const unlockScreen = () => {
    setLocked(false);
    setUnlockHint(false);
    lastInteraction.current = Date.now();
    setVisible(true);
  };
  const showUnlockHint = () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    setUnlockHint(true);
    unlockTimer.current = setTimeout(() => setUnlockHint(false), 2600);
  };
  const seek = (seconds: number) => {
    if (scrubCommitTimer.current) clearTimeout(scrubCommitTimer.current);
    scrubTargetRef.current = null;
    const target = Math.max(
      0,
      Math.min(duration || Number.MAX_SAFE_INTEGER, seconds),
    );
    setScrub(null);
    setEnded(false);
    setCountdown(10);
    setAutoNextCancelled(false);
    reveal();
    player.currentTime = target;
    currentPosition.current = target;
    setPosition(target);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);
  useEffect(() => {
    const subs = [
      player.addListener("timeUpdate", (e) => {
        if (!initialized.current) return;
        const value = offset.current + e.currentTime;
        setBufferedPosition(Math.max(0, e.bufferedPosition));
        currentPosition.current = value;
        setPosition(value);
        if (Date.now() - lastSaved.current > 10000) {
          lastSaved.current = Date.now();
          save();
        }
      }),
      player.addListener("playingChange", (e) => {
        setPlaying(e.isPlaying);
        playingRef.current = e.isPlaying;
        if (!e.isPlaying) save();
      }),
      player.addListener("statusChange", (e) => {
        setStatus(e.status);
        if (e.status === "loading" && initialized.current) {
          lastInteraction.current = Date.now();
          setVisible(true);
        }
        if (e.status === "error") {
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
        player.subtitleTrack = null;
        setNativeAudio(e.availableAudioTracks);
        setNativeSubtitles(e.availableSubtitleTracks);
        if (preferencesRef.current.autoSubtitles && !initial.tracks?.length) {
          const track = e.availableSubtitleTracks.find(
            (t) => t.language === preferencesRef.current.subtitleLanguage,
          );
          if (track) {
            player.subtitleTrack = track;
            setSubtitle(`native:${track.id}`);
          }
        }
        const value = Math.max(0, chosenStart.current - offset.current);
        player.currentTime = value;
        currentPosition.current = chosenStart.current;
        setPosition(chosenStart.current);
        if (!durationRef.current && e.duration > 0) setDuration(e.duration);
        initialized.current = true;
        setEnded(false);
        player.playbackRate = preferencesRef.current.playbackRate;
        player.play();
      }),
      player.addListener("playToEnd", () => {
        if (!initialized.current || currentPosition.current <= 10) return;
        save(true);
        setEnded(true);
        setVisible(true);
      }),
    ];
    return () => {
      save();
      subs.forEach((s) => s.remove());
    };
  }, [player, save]);
  useEffect(() => {
    if (!started || choice.path === "unsupported") return;
    let live = true;
    setError("");
    setStatus("loading");
    setHasLoaded(false);
    setBufferedPosition(0);
    initialized.current = false;
    offset.current = 0;
    chosenStart.current = choice.start;
    const uri = api.stream(manifest.fileId);
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
        if (live)
          setError(
            "Could not open this local video. Check file access, then retry.",
          );
      });
    return () => {
      live = false;
    };
  }, [api, choice, manifest.fileId, player, started]);
  useEffect(() => {
    let live = true;
    setSkips({ intro: null, recap: null, outro: null });
    autoSkipEnd.current = -1;
    void api
      .skips(manifest.fileId)
      .then((value) => {
        if (live) setSkips(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, manifest.fileId]);
  useEffect(() => {
    const controller = new AbortController();
    setCues([]);
    {
      player.subtitleTrack = subtitle?.startsWith("native:")
        ? nativeSubtitles.find((t) => `native:${t.id}` === subtitle) || null
        : null;
      if (subtitle?.startsWith("native:")) return;
    }
    if (!subtitle) return;
    const encoded = encodeURIComponent(subtitle);
    api
      .text(`/api/subtitles/${manifest.fileId}/${encoded}`, controller.signal)
      .then((text) => {
        const parsed = parseVtt(text);
        setCues(parsed);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        api
          .text(
            `/api/subtitles/${manifest.fileId}/${subtitle}`,
            controller.signal,
          )
          .then((text) => setCues(parseVtt(text)))
          .catch(() => {
            if (!controller.signal.aborted) {
              setMessage("Subtitle track could not be loaded.");
            }
          });
      });
    return () => controller.abort();
  }, [api, manifest.fileId, subtitle, nativeSubtitles]);
  const validatedSkips = localSegments(skips, duration || null);
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
  }, [position, preferences.autoSkip, skips, duration, scrub, status, resume]);
  useEffect(() => {
    if (
      !ended ||
      !preferences.autoNext ||
      autoNextCancelled ||
      !manifest.nextFileId
    )
      return;
    const timer = setTimeout(() => {
      if (countdown <= 1) next(manifest.nextFileId!);
      else setCountdown((n) => n - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    ended,
    preferences.autoNext,
    autoNextCancelled,
    manifest.nextFileId,
    next,
    countdown,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        playingRef.current &&
        status !== "loading" &&
        !menu &&
        scrub == null &&
        !timelineFocus &&
        Date.now() - lastInteraction.current > 6000
      )
        setVisible(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [menu, scrub, timelineFocus, status]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        save();
        if (!pip.current) player.pause();
      } else reveal();
    });
    return () => sub.remove();
  }, [player, save]);
  usePlayerOrientation(fullscreen, () =>
    setMessage("The device could not change screen orientation."),
  );
  useEffect(() => {
    if (error && fullscreen) setFullscreen(false);
  }, [error, fullscreen]);
  const exit = () => {
    save();
    player.pause();
    {
      void Orientation.lockAsync(Orientation.OrientationLock.PORTRAIT).catch(
        () => {},
      );
    }
    back();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (lockedRef.current) {
        unlockScreen();
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
  }, [menu, fullscreen, back, save, player]);
  const togglePlay = () => {
    reveal();
    if (ended) seek(0);
    player.playing ? player.pause() : player.play();
  };
  const activeSkip = Object.entries(validatedSkips).find(
    ([, segment]) =>
      segment && position >= segment.start && position < segment.end,
  );
  const skipLabel = activeSkip?.[0] === "outro" ? "credits" : activeSkip?.[0];
  const previewTime = scrub ?? position;

  const text = subtitleText(cues, position, preferences.subtitleOffset);
  const show = visible || !!menu || resume || ended || !!error;
  const layoutFull = fullscreen;
  // Progress ratio helpers
  const openingVideo = shouldShowPlayerLoading(
    status,
    hasLoaded,
    scrub != null,
  );
  const bufferedRatio = duration ? Math.min(1, bufferedPosition / duration) : 0;
  const progressRatio = duration ? Math.min(1, previewTime / duration) : 0;

  useEffect(() => {
    const shouldHide = openingVideo || scrub != null || ended;
    Animated.timing(controlsOpacity, {
      toValue: shouldHide ? 0 : 1,
      duration: reduceMotion ? 0 : 100,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: true,
    }).start();
  }, [openingVideo, scrub, ended, reduceMotion]);

  useEffect(() => {
    if (resume) {
      resumeBackdropOpacity.setValue(0);
      resumeCardOpacity.setValue(0);
      resumeCardScale.setValue(0.94);
      Animated.parallel([
        Animated.timing(resumeBackdropOpacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : 200,
          easing: Easing.bezier(0.23, 1, 0.32, 1),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(reduceMotion ? 0 : 60),
          Animated.parallel([
            Animated.timing(resumeCardOpacity, {
              toValue: 1,
              duration: reduceMotion ? 0 : 240,
              easing: Easing.bezier(0.23, 1, 0.32, 1),
              useNativeDriver: true,
            }),
            Animated.timing(resumeCardScale, {
              toValue: 1,
              duration: reduceMotion ? 0 : 240,
              easing: Easing.bezier(0.23, 1, 0.32, 1),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    }
  }, [resume, reduceMotion]);
  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <View
      className="flex-1 bg-black"
      style={{ paddingTop: layoutFull ? 0 : insets.top }}
    >
      <StatusBar hidden={layoutFull} barStyle="light-content" />

      {/* ── Video container ── */}
      <View
        className={cn(
          "absolute inset-0",
          !layoutFull && "w-full aspect-[16/9]",
        )}
        {...(!locked ? pinchPanResponder.panHandlers : {})}
      >
        <VideoView
          ref={video}
          player={player}
          nativeControls={false}
          surfaceType="textureView"
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={true}
          startsPictureInPictureAutomatically={false}
          onPictureInPictureStart={() => {
            pip.current = true;
          }}
          onPictureInPictureStop={() => {
            pip.current = false;
            reveal();
          }}
          style={[
            StyleSheet.absoluteFill,
            zoom !== 1 && { transform: [{ scale: zoom }] },
          ]}
          contentFit={fitMode}
        />

        {openingVideo && <PlayerLoading />}

        {/* Fit mode HUD Toast */}
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

        {/* Single tap toggles controls; double tap seeks without changing fit or zoom. */}
        <View
          className="absolute inset-0"
          {...(!locked ? pinchPanResponder.panHandlers : {})}
          collapsable={false}
        >
          <Pressable
            accessible={false}
            focusable={false}
            onLayout={(event) => {
              viewportWidth.current = event.nativeEvent.layout.width;
            }}
            onPress={(event) => {
              const now = Date.now();
              if (now < gestureBlockedUntil.current || locked) return;
              const tap: PlayerTap = {
                time: now,
                side:
                  event.nativeEvent.locationX < viewportWidth.current / 2
                    ? "left"
                    : "right",
              };
              const seconds = doubleTapSeek(lastTap.current, tap);
              if (seconds !== null) {
                cancelPendingTap();
                seek(currentPosition.current + seconds);
                showFitToast(
                  seconds > 0
                    ? `Forward ${SEEK_SECONDS} seconds`
                    : `Back ${SEEK_SECONDS} seconds`,
                );
                return;
              }
              cancelPendingTap();
              lastTap.current = tap;
              tapTimer.current = setTimeout(() => {
                lastTap.current = null;
                tapTimer.current = null;
                lastInteraction.current = Date.now();
                setVisible((current) => !current);
              }, DOUBLE_TAP_MS);
            }}
            className="absolute inset-0"
          />
        </View>

        {/* Screen lock: swallow every touch until the viewer unlocks */}
        {locked && (
          <>
            <Pressable
              className="absolute inset-0"
              onPress={showUnlockHint}
              accessibilityRole="button"
              accessibilityLabel="Screen locked. Tap to show the unlock button."
            />
            {unlockHint && (
              <View className="absolute inset-0 items-center justify-center" pointerEvents="box-none">
                <Pressable
                  onPress={unlockScreen}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock screen"
                  className="flex-row items-center gap-2 rounded-full bg-white/[0.94] px-5 py-3 active:opacity-80"
                >
                  <Unlock size={18} color="#000000" strokeWidth={2.4} />
                  <Text className="text-black text-[15px] font-bold">Tap to unlock</Text>
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

        {/* Subtitle overlay */}
        {!!text && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: "6%",
              right: "6%",
              top: `${subVertical}%`,
              alignItems: "center",
              transform: [{ translateY: subVertical > 50 ? -24 : 0 }],
            }}
          >
            <Label
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
            </Label>
          </View>
        )}
      </View>

      {/* ── Inline (non-fullscreen) title + simple controls ── */}
      {!layoutFull && (
        <View className="flex-1 bg-[#111]">
          {/* Title row */}
          <View className="flex-row items-center gap-3 px-4 pt-3.5 pb-1.5">
            <PlayerControl onPress={exit} size={36} bg="rgba(255,255,255,0.1)">
              <IconBack size={18} />
            </PlayerControl>
            <View className="flex-1">
              <Text
                className="text-white text-[16px] font-bold"
                numberOfLines={1}
              >
                {manifest.title || undefined || "Plexy"}
              </Text>
              {!!manifest.subtitle && (
                <Text
                  className="text-white/60 text-[13px] mt-0.5"
                  numberOfLines={1}
                >
                  {manifest.subtitle}
                </Text>
              )}
            </View>
          </View>

          {/* Inline progress bar */}
          <Pressable
            ref={timeline}
            accessibilityLabel="Playback position"
            accessibilityRole="adjustable"
            accessibilityValue={{
              min: 0,
              max: duration,
              now: position,
              text: timeLabel(position),
            }}
            accessibilityActions={[
              { name: "increment" },
              { name: "decrement" },
            ]}
            onAccessibilityAction={(e) =>
              seek(
                position +
                  (e.nativeEvent.actionName === "increment"
                    ? SEEK_SECONDS
                    : -SEEK_SECONDS),
              )
            }
            onLayout={(e) => {
              timelineWidth.current = e.nativeEvent.layout.width;
            }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(e) => {
              reveal();
              setScrub(
                Math.max(
                  0,
                  Math.min(
                    duration,
                    (e.nativeEvent.locationX / timelineWidth.current) *
                      duration,
                  ),
                ),
              );
            }}
            onResponderMove={(e) => {
              setScrub(
                Math.max(
                  0,
                  Math.min(
                    duration,
                    (e.nativeEvent.locationX / timelineWidth.current) *
                      duration,
                  ),
                ),
              );
            }}
            onResponderRelease={(e) => {
              seek(
                Math.max(
                  0,
                  Math.min(
                    duration,
                    (e.nativeEvent.locationX / timelineWidth.current) *
                      duration,
                  ),
                ),
              );
            }}
            className="px-4 py-2.5"
          >
            {/* Track */}
            <View
              className="rounded-[3px] bg-white/20 overflow-visible"
              style={{ height: scrub != null ? 5 : 3 }}
            >
              <View
                pointerEvents="none"
                className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-white/30"
                style={{ width: `${bufferedRatio * 100}%` }}
              />
              {/* Fill */}
              <View
                className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-white"
                style={{ width: `${progressRatio * 100}%` }}
              />
              {/* Thumb */}
              <View
                className="absolute top-1/2 h-3 w-3 rounded-full bg-white -mt-1.5 -ml-1.5"
                style={{ left: `${progressRatio * 100}%` }}
              />
            </View>
          </Pressable>

          {/* Time labels */}
          <View className="flex-row justify-between px-4">
            <Text className="text-white/70 text-[11px]">
              {timeLabel(previewTime)}
            </Text>
            <Text className="text-white/70 text-[11px]">
              {timeLabel(duration)}
            </Text>
          </View>

          {/* Inline control row */}
          <View className="flex-row items-center gap-1 px-3 py-2.5">
            <PlayerControl onPress={() => seek(position - SEEK_SECONDS)}>
              <IconRewind size={20} />
            </PlayerControl>
            <PlayerControl onPress={togglePlay} size={48} bg="rgba(0,0,0,0.5)">
              {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </PlayerControl>
            <PlayerControl onPress={() => seek(position + SEEK_SECONDS)}>
              <IconForward size={20} />
            </PlayerControl>
            <View className="flex-1" />
            {
              <PlayerControl onPress={() => setFullscreen(true)}>
                <IconFullscreen size={20} />
              </PlayerControl>
            }
          </View>

          {/* Error / message strip */}
          {(!!error || choice.path === "unsupported") && (
            <View className="px-4 pb-3">
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
        </View>
      )}

      {/* ── Fullscreen overlay controls ── */}
      {show && layoutFull && !locked && !openingVideo && (
        <View className="absolute inset-0" pointerEvents="box-none">
          <View
            className="absolute inset-0"
            pointerEvents={menu || resume ? "none" : "box-none"}
            importantForAccessibility={
              menu || resume ? "no-hide-descendants" : "auto"
            }
            aria-hidden={!!(menu || resume)}
          >
            {/* Gradient */}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(0,0,0,0.85)", "transparent", "rgba(0,0,0,0.9)"]}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFill}
            />

            {/* ── TOP BAR ── */}
            <View
              className="flex-row items-center justify-between"
              style={{
                paddingLeft: Math.max(insets.left + 10, 16),
                paddingRight: Math.max(insets.right + 10, 16),
                paddingTop: Math.max(insets.top + 6, 14),
                paddingBottom: 10,
              }}
            >
              {/* Left cluster: Back button + Title */}
              <View className="flex-row items-center flex-1 mr-3">
                <PlayerControl onPress={exit} size={44} bg="rgba(0,0,0,0.45)">
                  {({ focused }) => (
                    <IconBack
                      size={22}
                      color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                    />
                  )}
                </PlayerControl>

                <View className="ml-3 flex-1">
                  <Text
                    className="text-white text-[15px] font-archivo-bold tracking-[-0.2px]"
                    numberOfLines={1}
                  >
                    {manifest.title || undefined || "Plexy"}
                  </Text>
                  {(() => {
                    const raw = manifest.subtitle || "";
                    const cleaned = raw
                      .replace(
                        /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
                        "",
                      )
                      .trim();
                    const isEp = manifest.episodeNumber != null || Boolean(raw);
                    const subLabel = isEp
                      ? manifest.episodeNumber != null
                        ? `Episode ${manifest.episodeNumber}${cleaned ? ` · ${cleaned}` : ""}`
                        : raw
                      : "";
                    return subLabel ? (
                      <Text
                        className="text-white/65 text-[11.5px] font-archivo-regular mt-[1px]"
                        numberOfLines={1}
                      >
                        {subLabel}
                      </Text>
                    ) : null;
                  })()}
                </View>
              </View>

              {/* Lock button on top bar */}
              {
                <PlayerControl
                  onPress={lockScreen}
                  size={44}
                  bg="rgba(0,0,0,0.45)"
                >
                  {({ focused }) => (
                    <Lock
                      size={20}
                      color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                      strokeWidth={2}
                    />
                  )}
                </PlayerControl>
              }

              {/* Top-Right cluster: Quality, Audio, Subtitles, Episodes, Settings */}
              <View className="flex-row items-center gap-2 ml-3">
                <PlayerControl
                  onPress={() => setMenu("audio")}
                  size={44}
                  active={menu === "audio"}
                  bg="rgba(0,0,0,0.45)"
                >
                  {({ focused }) => (
                    <IconAudio
                      size={22}
                      color={
                        menu === "audio"
                          ? "#000000"
                          : focused
                            ? "#ffffff"
                            : "rgba(255,255,255,0.9)"
                      }
                    />
                  )}
                </PlayerControl>

                <PlayerControl
                  onPress={() => setMenu("captions")}
                  size={44}
                  active={Boolean(subtitle)}
                  bg="rgba(0,0,0,0.45)"
                >
                  {({ focused }) => (
                    <IconSubtitles
                      size={22}
                      color={
                        subtitle
                          ? "#000000"
                          : focused
                            ? "#ffffff"
                            : "rgba(255,255,255,0.9)"
                      }
                      active={!!subtitle}
                    />
                  )}
                </PlayerControl>

                {!!manifest.nextFileId && (
                  <PlayerControl
                    onPress={() => next(manifest.nextFileId!)}
                    accessibilityLabel="Next episode"
                    size={44}
                    bg="rgba(0,0,0,0.45)"
                  >
                    {({ focused }) => (
                      <IconNext
                        size={22}
                        color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                      />
                    )}
                  </PlayerControl>
                )}

                {isPictureInPictureSupported() && (
                  <PlayerControl
                    onPress={() => {
                      pip.current = true;
                      void video.current?.startPictureInPicture().catch(() => {
                        pip.current = false;
                        setMessage(
                          "Picture in picture is unavailable on this device.",
                        );
                      });
                    }}
                    size={44}
                    bg="rgba(0,0,0,0.45)"
                  >
                    <IconPip size={22} />
                  </PlayerControl>
                )}

                {
                  <PlayerControl
                    onPress={cycleFitMode}
                    size={44}
                    bg="rgba(0,0,0,0.45)"
                  >
                    <IconFitState mode={fitMode} zoom={zoom} size={20} />
                  </PlayerControl>
                }

                {isTvShow && sortedEpisodes.length > 0 && (
                  <PlayerControl
                    onPress={() => setMenu("episodes")}
                    size={46}
                    active={menu === "episodes"}
                    bg="rgba(0,0,0,0.45)"
                  >
                    {({ focused }) => (
                      <ListVideo
                        size={22}
                        color={
                          menu === "episodes"
                            ? "#000000"
                            : focused
                              ? "#ffffff"
                              : "rgba(255,255,255,0.9)"
                        }
                      />
                    )}
                  </PlayerControl>
                )}

                <PlayerControl
                  onPress={() => setMenu("settings")}
                  size={44}
                  active={menu === "settings"}
                  bg="rgba(0,0,0,0.45)"
                >
                  {({ focused }) => (
                    <IconSettings
                      size={22}
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
            </View>

            {/* ── MIDDLE PLAY CONTROLS ── */}
            <Animated.View
              className="flex-1 items-center justify-center flex-row gap-7"
              style={{ opacity: controlsOpacity }}
              pointerEvents={openingVideo || ended ? "none" : "box-none"}
              accessibilityElementsHidden={openingVideo || ended}
              importantForAccessibility={
                openingVideo || ended ? "no-hide-descendants" : "auto"
              }
            >
              {/* Previous episode (if any) */}
              {!!(manifest as any).previousFileId && (
                <PlayerControl
                  onPress={() => next((manifest as any).previousFileId)}
                  size={48}
                  bg="rgba(0,0,0,0.4)"
                  accessibilityLabel="Previous episode"
                >
                  <SkipBack size={24} color={colors.ink} />
                </PlayerControl>
              )}

              {/* Rewind 30s */}
              <PlayerControl
                onPress={() => seek(position - SEEK_SECONDS)}
                size={54}
                bg="rgba(0,0,0,0.45)"
              >
                <IconRewind size={28} />
              </PlayerControl>

              {/* Play/Pause */}
              <PlayerControl
                onPress={togglePlay}
                size={72}
                active={true}
                activeBg="#ffffff"
                bg={"rgba(0,0,0,0.45)"}
              >
                {({ focused }) => {
                  const darkIcon = true;
                  return playing ? (
                    <IconPause
                      size={30}
                      color={darkIcon ? "#000000" : "#ffffff"}
                    />
                  ) : (
                    <IconPlay
                      size={32}
                      color={darkIcon ? "#000000" : "#ffffff"}
                    />
                  );
                }}
              </PlayerControl>

              {/* Forward 30s */}
              <PlayerControl
                onPress={() => seek(position + SEEK_SECONDS)}
                size={54}
                bg="rgba(0,0,0,0.45)"
              >
                <IconForward size={28} />
              </PlayerControl>
            </Animated.View>

            {/* ── BOTTOM SECTION ── */}
            <View
              className="gap-1.5"
              style={{
                paddingLeft: Math.max(insets.left + 10, 16),
                paddingRight: Math.max(insets.right + 10, 16),
                paddingBottom: Math.max(insets.bottom + 4, 16),
              }}
            >
              {/* Error / messages */}
              {(!!error || choice.path === "unsupported") && (
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
              )}
              {!!message && (
                <View className="flex-row items-center gap-3 mb-1">
                  <Text className="flex-1 text-white/80 text-[13px]">
                    {message}
                  </Text>
                  <PlayerControl
                    onPress={() => setMessage("")}
                    size={32}
                    bg="rgba(255,255,255,0.15)"
                  >
                    <IconClose size={14} />
                  </PlayerControl>
                </View>
              )}

              {/* Ended card */}
              {ended && !resume && (
                <View className="flex-row gap-2.5 self-center mb-2">
                  <Pressable
                    onPress={() => seek(0)}
                    accessibilityRole="button"
                    accessibilityLabel="Play again"
                    className="rounded-full bg-white/15 border border-white/25 px-5 py-2.5 active:opacity-80"
                  >
                    <Text className="text-white/90 font-semibold text-[14px]">Play again</Text>
                  </Pressable>
                  {manifest.nextFileId && (
                    <Pressable
                      onPress={() => next(manifest.nextFileId!)}
                      accessibilityRole="button"
                      accessibilityLabel="Next episode"
                      className="rounded-full bg-white border border-white px-5 py-2.5 active:opacity-80"
                    >
                      <Text className="text-black font-bold text-[14px]">
                        {preferences.autoNext && !autoNextCancelled
                          ? `Next  · ${countdown}s`
                          : "Next episode"}
                      </Text>
                    </Pressable>
                  )}
                  {preferences.autoNext &&
                    !autoNextCancelled &&
                    manifest.nextFileId && (
                      <Pressable
                        onPress={() => setAutoNextCancelled(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel autoplay"
                        className="rounded-full bg-transparent border border-white/25 px-5 py-2.5 active:opacity-70"
                      >
                        <Text className="text-white/90 font-semibold text-[14px]">Cancel</Text>
                      </Pressable>
                    )}
                </View>
              )}

              {/* Scrub trickplay preview & floating time badge */}
              {scrub != null && (
                <View
                  pointerEvents="none"
                  className="absolute items-center w-[120px] gap-1 z-20"
                  style={{
                    bottom: 78,
                    left: `${Math.max(12, Math.min(88, progressRatio * 100))}%`,
                    transform: [{ translateX: -60 }],
                  }}
                >
                  {LocalThumbnail && (
                    <LocalThumbnail
                      key={manifest.fileId}
                      player={player}
                      time={scrub}
                      fileId={manifest.fileId}
                    />
                  )}

                  {/* Floating time bubble like in reference screenshots */}
                  <View className="bg-black/85 px-2 py-[3px] rounded-[6px] border border-white/20">
                    <Text className="text-white text-[11px] font-archivo-bold">
                      {timeLabel(previewTime)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Time row above timeline */}
              <View className="flex-row items-center justify-end mb-1 px-0.5">
                <Text className="text-white/85 text-[12px] font-archivo-medium">
                  {timeLabel(previewTime)} / {timeLabel(duration)}
                </Text>
              </View>

              {/* Progress bar */}
              <View
                ref={timeline}
                collapsable={false}
                {...{}}
                accessibilityLabel="Playback position"
                accessibilityRole="adjustable"
                accessibilityValue={{
                  min: 0,
                  max: duration,
                  now: position,
                  text: timeLabel(position),
                }}
                accessibilityActions={[
                  { name: "increment" },
                  { name: "decrement" },
                ]}
                onAccessibilityAction={(e) =>
                  seek(
                    position +
                      (e.nativeEvent.actionName === "increment"
                        ? SEEK_SECONDS
                        : -SEEK_SECONDS),
                  )
                }
                onFocus={() => {
                  reveal();
                  setTimelineFocus(true);
                }}
                onBlur={() => {
                  setTimelineFocus(false);
                  setScrub(null);
                }}
                onLayout={(e) => {
                  timelineWidth.current = Math.max(
                    1,
                    e.nativeEvent.layout.width,
                  );
                }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderTerminate={() => setScrub(null)}
                onResponderGrant={(e) => {
                  {
                    reveal();
                    const x = Math.max(
                      0,
                      Math.min(timelineWidth.current, e.nativeEvent.locationX),
                    );
                    const target = (x / timelineWidth.current) * duration;
                    setScrub(target);
                  }
                }}
                onResponderMove={(e) => {
                  {
                    const x = Math.max(
                      0,
                      Math.min(timelineWidth.current, e.nativeEvent.locationX),
                    );
                    const target = (x / timelineWidth.current) * duration;
                    setScrub(target);
                  }
                }}
                onResponderRelease={(e) => {
                  {
                    const x = Math.max(
                      0,
                      Math.min(timelineWidth.current, e.nativeEvent.locationX),
                    );
                    const target = (x / timelineWidth.current) * duration;
                    seek(target);
                  }
                }}
                className="py-3"
              >
                {/* Track */}
                <View
                  pointerEvents="none"
                  className="rounded-[3px] bg-white/[0.22] overflow-visible"
                  style={{
                    height: scrub != null ? 6 : 4,
                    borderColor: timelineFocus ? "#ffffff" : "transparent",
                    borderWidth: timelineFocus ? 1.5 : 0,
                  }}
                >
                  {/* Buffered fill */}
                  <View
                    pointerEvents="none"
                    className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-white/30"
                    style={{ width: `${bufferedRatio * 100}%` }}
                  />
                  {/* Playhead fill */}
                  <View
                    pointerEvents="none"
                    className="absolute left-0 top-0 bottom-0 rounded-[3px] bg-white"
                    style={{ width: `${progressRatio * 100}%` }}
                  />
                  {/* Thumb */}
                  <View
                    pointerEvents="none"
                    className="absolute top-1/2 rounded-full bg-white"
                    style={{
                      left: `${progressRatio * 100}%`,
                      width: scrub != null ? 16 : 12,
                      height: scrub != null ? 16 : 12,
                      marginTop: scrub != null ? -8 : -6,
                      marginLeft: scrub != null ? -8 : -6,
                      shadowColor: "#000",
                      shadowOpacity: 0.6,
                      shadowRadius: 3,
                      elevation: 4,
                    }}
                  />
                </View>
              </View>

              {diagnostics && (
                <View className="self-start mt-1.5 rounded-[8px] border border-white/15 bg-black/80 px-3 py-2 gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="w-20 text-white/45 text-[10px] font-bold" style={{ fontFamily: fonts.mono }}>SOURCE</Text>
                    <Text className="text-white text-[11px] font-semibold" style={{ fontFamily: fonts.mono }} numberOfLines={1}>
                      {choice.path.toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="w-20 text-white/45 text-[10px] font-bold" style={{ fontFamily: fonts.mono }}>RESOLUTION</Text>
                    <Text className="text-white text-[11px] font-semibold" style={{ fontFamily: fonts.mono }}>
                      {player.videoTrack?.size.height
                        ? `${player.videoTrack.size.height}p`
                        : "Auto"}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="w-20 text-white/45 text-[10px] font-bold" style={{ fontFamily: fonts.mono }}>BUFFERED</Text>
                    <Text className="text-white text-[11px] font-semibold" style={{ fontFamily: fonts.mono }}>
                      {timeLabel(player.bufferedPosition)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="w-20 text-white/45 text-[10px] font-bold" style={{ fontFamily: fonts.mono }}>AUDIO</Text>
                    <Text className="text-white text-[11px] font-semibold" style={{ fontFamily: fonts.mono }}>
                      Track {choice.audio + 1}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="w-20 text-white/45 text-[10px] font-bold" style={{ fontFamily: fonts.mono }}>STATUS</Text>
                    <Text className="text-[#4ade80] text-[11px] font-semibold" style={{ fontFamily: fonts.mono }}>
                      {status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Skip segment pill (bottom-right) */}
          </View>
        </View>
      )}

      {!locked &&
        activeSkip &&
        scrub == null &&
        status !== "loading" &&
        !resume &&
        !menu &&
        !ended && (
          <View
            className="absolute right-5"
            style={{
              bottom: layoutFull
                ? Math.max(insets.bottom, 16) + (show ? 150 : 32)
                : 92,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Skip ${skipLabel}`}
              onPress={() => seek(activeSkip[1]!.end)}
              className="rounded-full bg-white/[0.92] px-[18px] py-[9px] active:opacity-85"
            >
              <Text className="text-black font-bold text-[14px]">Skip {skipLabel}</Text>
            </Pressable>
          </View>
        )}

      {/* ── Resume prompt ── */}
      {resume && (
        <Animated.View
          className="absolute inset-0 items-center justify-center bg-black/[0.72] p-6 z-[100]"
          style={{ opacity: resumeBackdropOpacity }}
        >
          <Animated.View
            className="items-center gap-2.5 rounded-[18px] border border-white/[0.12] bg-[#121212]/[0.95] p-5 w-[320px] max-w-[90%]"
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
                setChoice((old) => ({ ...old, start: initialResume }));
                setResume(false);
                setStarted(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Continue watching from ${timeLabel(initialResume)}`}
              className="w-full bg-white rounded-[12px] items-center justify-center py-3.5 active:opacity-85"
            >
              <Text className="text-black font-archivo-bold text-[15px]">
                Continue watching ({timeLabel(initialResume)})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setChoice((old) => ({ ...old, start: 0 }));
                setResume(false);
                setStarted(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Start from beginning"
              className="w-full bg-white/[0.12] rounded-[12px] items-center justify-center py-3.5 active:opacity-85"
            >
              <Text className="text-white/90 font-archivo-medium text-[14px]">
                Start from beginning
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setResume(false);
                back();
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel playback"
              className="w-full bg-transparent rounded-[12px] items-center justify-center py-3 active:opacity-70"
            >
              <Text className="text-white/60 font-archivo-medium text-[14px]">
                Cancel
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* ── Right-side drawer menus ── */}
      <PlayerDrawer
        menu={menu}
        setMenu={setMenu}
        drawerAnim={drawerAnim}
        sortedEpisodes={sortedEpisodes}
        reveal={reveal}
        episodesScrollRef={episodesScrollRef}
        insets={insets}
        manifest={manifest}
        drawerWatchedOverride={drawerWatchedOverride}
        next={next}
        toggleDrawerEpWatched={toggleDrawerEpWatched}
        player={player}
        fitMode={fitMode}
        applyFit={applyFit}
        zoom={zoom}
        diagnostics={diagnostics}
        setDiagnostics={setDiagnostics}
        pip={pip}
        video={video}
        setMessage={setMessage}
        nativeAudio={nativeAudio}
        subtitle={subtitle}
        setSubtitle={setSubtitle}
        setManifest={setManifest}
        nativeSubtitles={nativeSubtitles}
        subVertical={subVertical}
        setSubVertical={setSubVertical}
      />
    </View>
  );
}

