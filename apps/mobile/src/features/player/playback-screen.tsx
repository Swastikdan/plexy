import { useKeepAwake } from "expo-keep-awake";
import * as Orientation from "expo-screen-orientation";
import {
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
useWindowDimensions,
View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localSegments } from "@plexy/local-library/library";
import { useClient } from "@/core/client/client-provider";
import type {
ItemCard,
Playability,
SkipSegments,
} from "@/core/library/catalog-api";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { cn } from "@/shared/lib/cn";
import { timeLabel } from "@/shared/theme";
import { Lock,Unlock } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { Label } from "@/shared/ui/text";
import { LocalThumbnail } from "./components/local-thumbnail";
import { AudioPanel } from "./components/audio-panel";
import { BottomToolbar } from "./components/bottom-toolbar";
import { PlayerControl } from "./components/player-control";
import { PlayerDrawer } from "./components/player-drawer";
import { PlayerGestureHud } from "./components/player-gesture-hud";
import {
IconBack,
IconPause,
IconPlay,
IconSettings,
IconSeekBack,
IconSeekForward,
} from "./components/player-icons";
import { PlayerLoading } from "./components/player-loading";
import { SpeedPanel } from "./components/speed-panel";
import { TimelineBar } from "./components/timeline-bar";
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

/** A rounded end-of-episode pill ("Next Episode", "Watch credits"). */
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
}: {
  initial: Playability;
  back: () => void;
  next: (id: number) => void;
}) {
  useKeepAwake();
  const { api, platform, preferences, updatePreferences, progress } =
    useClient();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
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
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<
    "settings" | "quality" | "episodes" | null
  >(null);
  const [speedPanel, setSpeedPanel] = useState(false);
  const [audioPanel, setAudioPanel] = useState(false);
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
  // Zoom is a plain two-finger pinch on the video; brightness and volume are
  // vertical drags on the left / right half of the screen.
  const [brightness, setBrightness] = useState(1);
  const [volume, setVolume] = useState(1);
  const [adjusting, setAdjusting] = useState<
    "brightness" | "volume" | null
  >(null);
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const hasLoadedRef = useRef(hasLoaded);
  hasLoadedRef.current = hasLoaded;
  const screenRef = useRef({ w: win.width, h: win.height });
  screenRef.current = { w: win.width, h: win.height };
  const initialPinchDist = useRef<number | null>(null);
  const initialZoom = useRef(1);
  const gestureMode = useRef<"pinch" | "av" | null>(null);
  const avCandidate = useRef<{ x: number; y: number } | null>(null);
  const avStart = useRef<{
    side: "left" | "right";
    y: number;
    level: number;
  } | null>(null);
  const finishGesture = () => {
    gestureMode.current = null;
    avCandidate.current = null;
    avStart.current = null;
    initialPinchDist.current = null;
    gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
    setAdjusting(null);
  };
  const videoGestures = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) return true;
        if (touches.length !== 1) return false;
        // Brightness/volume drags need a loaded video.
        if (!hasLoadedRef.current) return false;
        const touch = touches[0]!;
        if (!avCandidate.current) {
          avCandidate.current = { x: touch.pageX, y: touch.pageY };
          return false;
        }
        const dx = touch.pageX - avCandidate.current.x;
        const dy = touch.pageY - avCandidate.current.y;
        if (Math.hypot(dx, dy) < 16) return false;
        if (Math.abs(dy) <= Math.abs(dx) * 1.2) {
          // Not a vertical drag: forget this origin so the next drag starts fresh.
          avCandidate.current = null;
          return false;
        }
        return true;
      },
      onPanResponderGrant: (evt) => {
        cancelPendingTap();
        gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          gestureMode.current = "pinch";
          const t0 = touches[0]!;
          const t1 = touches[1]!;
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          initialPinchDist.current = Math.hypot(dx, dy);
          initialZoom.current = zoomRef.current;
          return;
        }
        const touch = touches[0]!;
        const side =
          evt.nativeEvent.locationX < viewportWidth.current / 2
            ? "left"
            : "right";
        gestureMode.current = "av";
        avStart.current = {
          side,
          y: touch.pageY,
          level: side === "left" ? brightnessRef.current : volumeRef.current,
        };
        setAdjusting(side === "left" ? "brightness" : "volume");
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (gestureMode.current === "pinch") {
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
          return;
        }
        if (gestureMode.current === "av" && avStart.current && touches.length === 1) {
          const dy = avStart.current.y - touches[0]!.pageY;
          const delta = dy / (screenRef.current.h * 0.55);
          if (avStart.current.side === "left") {
            setBrightness(
              Math.min(1, Math.max(0.2, avStart.current.level + delta)),
            );
          } else {
            setVolume(Math.min(1, Math.max(0, avStart.current.level + delta)));
          }
        }
      },
      onPanResponderRelease: finishGesture,
      onPanResponderTerminate: finishGesture,
    }),
  ).current;
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
  const lastInteraction = useRef(Date.now());
  const chosenStart = useRef(0);
  const initialized = useRef(false);
  const scrubTargetRef = useRef<number | null>(null);
  const scrubCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const chromeIn = useRef(new Animated.Value(1)).current;
  const player = useVideoPlayer(null, (instance) => {
    instance.bufferOptions = bufferOptionsForDuration(initial.duration || 0);
    instance.timeUpdateEventInterval = 0.5;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
  });
  useEffect(() => {
    player.bufferOptions = bufferOptionsForDuration(duration);
  }, [player, duration]);
  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);
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
    setSpeedPanel(false);
    setAudioPanel(false);
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
  const activeSkip = Object.entries(validatedSkips).find(
    ([, segment]) =>
      segment && position >= segment.start && position < segment.end,
  );
  const skipLabel = activeSkip?.[0] === "outro" ? "credits" : activeSkip?.[0];
  // While the credits roll the next-episode countdown already runs, Netflix
  // style; "Watch credits" cancels it and keeps playing.
  const creditsPhase =
    !ended &&
    activeSkip?.[0] === "outro" &&
    scrub == null &&
    status !== "loading";
  const creditsPills =
    creditsPhase &&
    preferences.autoNext &&
    !!manifest.nextFileId &&
    !autoNextCancelled;
  useEffect(() => {
    if (creditsPhase) setCountdown(10);
  }, [creditsPhase]);
  useEffect(() => {
    if (
      (!ended && !creditsPhase) ||
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
    creditsPhase,
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
        !speedPanel &&
        !audioPanel &&
        scrub == null &&
        Date.now() - lastInteraction.current > 6000
      )
        setVisible(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [menu, speedPanel, audioPanel, scrub, status]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        save();
        if (!pip.current) player.pause();
      } else reveal();
    });
    return () => sub.remove();
  }, [player, save]);
  usePlayerOrientation(() =>
    setMessage("The device could not change screen orientation."),
  );
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
  }, [menu, speedPanel, audioPanel, back, save, player]);
  const togglePlay = () => {
    reveal();
    if (ended) seek(0);
    player.playing ? player.pause() : player.play();
  };
  const previewTime = scrub ?? position;

  const text = subtitleText(cues, position, preferences.subtitleOffset);
  const show =
    visible || !!menu || speedPanel || audioPanel || resume || ended || !!error;
  // Progress ratio helpers
  const openingVideo = shouldShowPlayerLoading(
    status,
    hasLoaded,
    scrub != null,
  );
  const bufferedRatio = duration ? Math.min(1, bufferedPosition / duration) : 0;
  const progressRatio = duration ? Math.min(1, previewTime / duration) : 0;
  // Track geometry of TimelineBar (row inset 24 + 52px labels + 12px gaps) so
  // the scrub preview can track the thumb position.
  const trackLeft = 24 + 52 + 12;
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
  // Fade the full chrome in the moment playback becomes live.
  useEffect(() => {
    if (hasLoaded) {
      chromeIn.setValue(0);
      Animated.timing(chromeIn, {
        toValue: 1,
        duration: reduceMotion ? 0 : 220,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: true,
      }).start();
    }
  }, [hasLoaded, reduceMotion]);
  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const videoViewProps = {
    ref: video,
    player,
    surfaceType: "textureView" as const,
    fullscreenOptions: { enable: false },
    allowsPictureInPicture: true,
    startsPictureInPictureAutomatically: false,
    onPictureInPictureStart: () => {
      pip.current = true;
    },
    onPictureInPictureStop: () => {
      pip.current = false;
      reveal();
    },
    contentFit: fitMode,
  };
  return (
    <View className="flex-1 bg-black">
      <StatusBar hidden barStyle="light-content" />

      {/* ── Video ── */}
      <View
        className="absolute inset-0"
        {...(!locked ? videoGestures.panHandlers : {})}
      >
        <VideoView
          {...videoViewProps}
          nativeControls={false}
          style={[
            StyleSheet.absoluteFill,
            zoom !== 1 && { transform: [{ scale: zoom }] },
          ]}
        />

        {/* In-app brightness dimming (left-half drag) */}
        <View
          pointerEvents="none"
          className="absolute inset-0 bg-black"
          style={{ opacity: (1 - brightness) * 0.9 }}
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

      {/* ── Player chrome (landscape only) ── */}
      {show && !locked && (
        <Animated.View
          className="absolute inset-0"
          pointerEvents="box-none"
          style={{ opacity: chromeIn }}
        >
          {/* Bottom seek bar (hidden while loading or the end pills show) */}
          {!openingVideo && !ended && !creditsPills && (
            <TimelineBar
              duration={duration}
              value={previewTime}
              buffered={bufferedPosition}
              scrubbing={scrub != null}
              seekStep={SEEK_SECONDS}
              bottom={Math.max(insets.bottom, 8) + 52}
              onScrub={(target) => {
                reveal();
                setScrub(target);
              }}
              onCommit={(target) => seek(target)}
            />
          )}

          {/* Trick-play scrub preview above the seek bar, tracking the thumb */}
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
              <LocalThumbnail
                key={manifest.fileId}
                player={player}
                time={scrub}
                fileId={manifest.fileId}
                width={200}
                height={113}
              />
              <View className="rounded-[6px] border border-white/20 bg-black/85 px-2 py-[3px]">
                <Text className="text-[11px] font-archivo-bold text-white">
                  {timeLabel(scrub)}
                </Text>
              </View>
            </View>
          )}

          {/* Bottom toolbar: Speed / Lock / Episodes / Audio & Subtitles / Next Ep. */}
          {!openingVideo && !ended && !creditsPills && (
            <BottomToolbar
              speed={preferences.playbackRate}
              bottom={Math.max(insets.bottom, 8) + 10}
              onSpeed={() => setSpeedPanel(true)}
              onLock={lockScreen}
              showEpisodes={isTvShow && sortedEpisodes.length > 0}
              onEpisodes={() => setMenu("episodes")}
              onAudioSubtitles={() => setAudioPanel(true)}
              showNext={!!manifest.nextFileId}
              onNext={() => {
                if (manifest.nextFileId) next(manifest.nextFileId);
              }}
            />
          )}

          {/* Title, top-center */}
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

          {/* Back — top-left (available while loading too) */}
          <View
            className="absolute"
            style={{
              left: Math.max(insets.left, 10) + 12,
              top: Math.max(insets.top, 10) + 8,
            }}
          >
            <PlayerControl onPress={exit} size={42} bg="rgba(0,0,0,0.4)">
              <IconBack size={20} />
            </PlayerControl>
          </View>

          {/* Player settings — top-right */}
          <View
            className="absolute"
            style={{
              right: Math.max(insets.right, 10) + 12,
              top: Math.max(insets.top, 10) + 8,
            }}
          >
            <PlayerControl
              onPress={() => setMenu("settings")}
              size={42}
              bg="rgba(0,0,0,0.4)"
              active={menu === "settings"}
            >
              {({ focused }) => (
                <IconSettings
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

          {/* Center transport: seek back / play-pause / seek forward */}
          <Animated.View
            className="absolute left-0 right-0 flex-row items-center justify-center gap-10"
            style={{ top: 0, bottom: 0, opacity: controlsOpacity }}
            pointerEvents={openingVideo || ended ? "none" : "box-none"}
            accessibilityElementsHidden={openingVideo || ended}
            importantForAccessibility={
              openingVideo || ended ? "no-hide-descendants" : "auto"
            }
          >
            <PlayerControl
              onPress={() => seek(currentPosition.current - SEEK_SECONDS)}
              size={56}
              bg="transparent"
              accessibilityLabel={`Back ${SEEK_SECONDS} seconds`}
            >
              <IconSeekBack size={28} />
            </PlayerControl>

            <Pressable
              onPress={togglePlay}
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
                <IconPause size={44} color="#ffffff" />
              ) : (
                <IconPlay size={46} color="#ffffff" />
              )}
            </Pressable>

            <PlayerControl
              onPress={() => seek(currentPosition.current + SEEK_SECONDS)}
              size={56}
              bg="transparent"
              accessibilityLabel={`Forward ${SEEK_SECONDS} seconds`}
            >
              <IconSeekForward size={28} />
            </PlayerControl>
          </Animated.View>

          {/* Brightness / volume edge indicators — only while adjusting */}
          {!openingVideo && !ended && (
            <PlayerGestureHud
              brightness={brightness}
              volume={volume}
              adjusting={adjusting}
            />
          )}

          {/* Error / message strips */}
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

          {/* Close removed: exit is the back button (top-left); player
              settings live at the top-right. */}
        </Animated.View>
      )}

      {/* End-of-episode pills, bottom-right: Watch credits / Play again + Next Episode */}
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
          {manifest.nextFileId && (
            <EndPill
              label="Next Episode"
              variant="light"
              fill={
                preferences.autoNext && !autoNextCancelled
                  ? 1 - countdown / 10
                  : undefined
              }
              onPress={() => next(manifest.nextFileId!)}
            />
          )}
          {ended &&
            preferences.autoNext &&
            !autoNextCancelled &&
            manifest.nextFileId && (
              <EndPill
                label="Cancel"
                variant="ghost"
                onPress={() => setAutoNextCancelled(true)}
              />
            )}
        </View>
      )}

      {/* Skip segment pill — right side, above the bottom rows */}
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

      {/* ── Resume prompt ── */}
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
                setChoice((old) => ({ ...old, start: initialResume }));
                setResume(false);
                setStarted(true);
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
                setChoice((old) => ({ ...old, start: 0 }));
                setResume(false);
                setStarted(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Start from beginning"
              className="rounded-[14px] bg-white/[0.14] border border-white/20 px-5 py-4 active:opacity-85"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text className="text-white/95 font-archivo-medium text-[15px]">
                Start from beginning
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* ── Right-side drawer (settings / episodes) ── */}
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
        pip={pip}
        video={video}
        setMessage={setMessage}
        subVertical={subVertical}
        setSubVertical={setSubVertical}
      />

      {/* ── Speed picker ── */}
      <SpeedPanel
        visible={speedPanel && !locked}
        rate={preferences.playbackRate}
        onClose={() => setSpeedPanel(false)}
        onSelect={(rate) => {
          player.playbackRate = rate;
          updatePreferences({ playbackRate: rate });
          setSpeedPanel(false);
          showFitToast(`${rate}× speed`);
        }}
      />

      {/* ── Audio & Subtitles picker ── */}
      <AudioPanel
        visible={audioPanel && !locked}
        onClose={() => setAudioPanel(false)}
        player={player}
        nativeAudio={nativeAudio}
        subtitle={subtitle}
        serverTracks={manifest.tracks}
        nativeSubtitles={nativeSubtitles}
        canAddSubtitleFile={Boolean(platform.local?.pickSubtitle)}
        onPickAudio={(track) => {
          player.audioTrack = track;
          setAudioPanel(false);
        }}
        onPickSubtitle={(value) => {
          setSubtitle(value);
          if (!value) {
            updatePreferences({ autoSubtitles: false });
          } else {
            updatePreferences({ autoSubtitles: true });
            const server = manifest.tracks?.find((t) => t.track === value);
            if (server) {
              updatePreferences({ subtitleLanguage: server.language || "" });
            }
          }
          setAudioPanel(false);
        }}
        onAddSubtitleFile={() => {
          void platform
            .local!.pickSubtitle!(manifest.fileId)
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
              setSubtitle(track.track);
              updatePreferences({ autoSubtitles: true });
              setAudioPanel(false);
            })
            .catch(() =>
              setMessage(
                "Could not add this subtitle file. Choose an SRT or VTT file.",
              ),
            );
        }}
      />
    </View>
  );
}
