import { LocalThumbnail } from "../components/LocalThumbnail";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as Orientation from "expo-screen-orientation";
import {
  isPictureInPictureSupported,
  useVideoPlayer,
  VideoView,
} from "expo-video";
import {
  ArrowLeft as ArrowLeftIcon,
  AudioLines,
  Check as CheckIcon,
  Crop,
  Film,
  ListVideo,
  Lock,
  Maximize,
  Minus,
  MoveHorizontal,
  Pause as PauseIcon,
  PictureInPicture,
  Play as PlayIcon,
  Plus,
  RotateCcw,
  RotateCw,
  SkipForward,
  SlidersHorizontal,
  Subtitles as SubtitlesIcon,
  Unlock,
  X as XIcon,
  ZoomIn,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  BackHandler,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localSegments } from "../../../../packages/local-library/src/library";
import { Button, Label, Loading, Notice, PosterImage } from "../components/ui";
import type { ItemCard, Playability, SkipSegments } from "../lib/client/api";
import { useClient } from "../lib/client/context";
import { useResource } from "../lib/client/hooks";
import { usePlayerOrientation } from "../lib/client/use-player-orientation";
import { parseVtt, subtitleText, type Cue } from "../lib/client/vtt";
import { fonts, timeLabel } from "../ui/theme";
// ---------------------------------------------------------------------------
// Player Icon components — high-contrast crisp Lucide icons
// ---------------------------------------------------------------------------
function IconBack({
  size = 24,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <ArrowLeftIcon size={size} color={color} strokeWidth={2.2} />;
}
function IconPlay({
  size = 32,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PlayIcon size={size} color={color} fill={color} />;
}
function IconPause({
  size = 30,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PauseIcon size={size} color={color} fill={color} />;
}
function IconRewind({
  size = 30,
  color = "#fff",
  seconds = 10,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  const containerSize = size + 16;
  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <RotateCcw size={size} color={color} strokeWidth={2.2} />
      <Text
        style={{
          position: "absolute",
          fontSize: 10,
          color,
          fontFamily: fonts.bold,
          textAlign: "center",
          top: Math.round(containerSize / 2) - 6,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}
function IconForward({
  size = 30,
  color = "#fff",
  seconds = 10,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  const containerSize = size + 16;
  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <RotateCw size={size} color={color} strokeWidth={2.2} />
      <Text
        style={{
          position: "absolute",
          fontSize: 10,
          color,
          fontFamily: fonts.bold,
          textAlign: "center",
          top: Math.round(containerSize / 2) - 6,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}
function IconPip({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PictureInPicture size={size} color={color} strokeWidth={1.9} />;
}
function IconAudio({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <AudioLines size={size} color={color} strokeWidth={2} />;
}
function IconSubtitles({
  size = 22,
  color = "#fff",
  active = false,
}: {
  size?: number;
  color?: string;
  active?: boolean;
}) {
  return <SubtitlesIcon size={size} color={color} strokeWidth={2} />;
}
function IconSettings({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <SlidersHorizontal size={size} color={color} strokeWidth={2} />;
}
function IconFullscreen({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <Maximize size={size} color={color} strokeWidth={2} />;
}
function IconFitState({
  mode,
  zoom,
  size = 20,
  color = "#fff",
}: {
  mode: "contain" | "cover" | "fill";
  zoom: number;
  size?: number;
  color?: string;
}) {
  if (mode === "cover") {
    return <Crop size={size} color={color} strokeWidth={2.2} />;
  }
  if (mode === "fill") {
    return <MoveHorizontal size={size} color={color} strokeWidth={2.2} />;
  }
  if (zoom === 1.05) {
    return (
      <View
        style={{
          width: size + 6,
          height: size + 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          style={{
            position: "absolute",
            bottom: -2,
            right: -4,
            backgroundColor: "#3b82f6",
            borderRadius: 4,
            paddingHorizontal: 2,
            paddingVertical: 0.5,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 7, fontFamily: fonts.bold }}>
            105
          </Text>
        </View>
      </View>
    );
  }
  if (zoom === 1.2 || zoom > 1) {
    return (
      <View
        style={{
          width: size + 6,
          height: size + 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          style={{
            position: "absolute",
            bottom: -2,
            right: -4,
            backgroundColor: "#8b5cf6",
            borderRadius: 4,
            paddingHorizontal: 2,
            paddingVertical: 0.5,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 7, fontFamily: fonts.bold }}>
            120
          </Text>
        </View>
      </View>
    );
  }
  return <Maximize size={size} color={color} strokeWidth={2.2} />;
}
function IconClose({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <XIcon size={size} color={color} strokeWidth={2.2} />;
}
function IconNext({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <SkipForward size={size} color={color} strokeWidth={2} />;
}
function IconCheck({
  size = 20,
  color = "#ffffff",
}: {
  size?: number;
  color?: string;
}) {
  return <CheckIcon size={size} color={color} strokeWidth={2.5} />;
}
// ---------------------------------------------------------------------------
// Circular control button
// ---------------------------------------------------------------------------
function CircleBtn({
  onPress,
  size = 46,
  bg = "rgba(0,0,0,0.3)",
  children,
  disabled = false,
  active = false,
  activeBg = "#ffffff",
}: {
  onPress: () => void;
  size?: number;
  bg?: string;
  children:
    | React.ReactNode
    | ((props: { focused: boolean }) => React.ReactNode);
  disabled?: boolean;
  active?: boolean;
  activeBg?: string;
  focusId?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: active ? activeBg : bg,
        justifyContent: "center",
        alignItems: "center",
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      {typeof children === "function" ? children({ focused: false }) : children}
    </Pressable>
  );
}
// ---------------------------------------------------------------------------
// PlayerScreen (data loading shell)
// ---------------------------------------------------------------------------
export function PlayerScreen({
  fileId,
  back,
  next,
}: {
  fileId: number;
  back: () => void;
  next: (id: number) => void;
}) {
  const { api, progress } = useClient();
  const resource = useResource(async () => {
    const manifest = await api.play(fileId);
    const pending = manifest.itemId
      ? progress.latest(manifest.itemId)
      : undefined;
    return pending && !pending.synced
      ? {
          ...manifest,
          watch: {
            position: pending.position,
            duration: pending.duration || null,
            played: pending.played,
          },
        }
      : manifest;
  }, [api, fileId]);
  if (resource.loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000000",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Loading />
      </View>
    );
  }
  if (resource.error)
    return (
      <View style={{ padding: 24 }}>
        <Button label="Back" onPress={back} />
        <Notice message={resource.error} retry={resource.retry} />
      </View>
    );
  return (
    resource.value && (
      <Playback key={fileId} initial={resource.value} back={back} next={next} />
    )
  );
}
// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface SourceChoice {
  path: string;
  audio: number;
  start: number;
  maxHeight?: number;
  uri?: string;
  revision: number;
}
// ---------------------------------------------------------------------------
// Playback (main player component)
// ---------------------------------------------------------------------------
function Playback({
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
  useEffect(() => {
    if (menu != null) {
      drawerAnim.setValue(560);
      Animated.timing(drawerAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [menu]);
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
  const [fitToast, setFitToast] = useState<string | null>(null);
  const toastTimeout = useRef<any>(null);
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
  const applyFit = (mode: FitMode, scale: number) => {
    setFitMode(mode);
    setZoom(scale);
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
  const lastTapTime = useRef(0);
  const pinchPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const t0 = touches[0]!;
          const t1 = touches[1]!;
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          initialPinchDist.current = Math.hypot(dx, dy);
          initialZoom.current = zoom;
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
          const scaleFactor = currentDist / initialPinchDist.current;
          const newZoom = Math.min(
            3.0,
            Math.max(
              0.75,
              Math.round(initialZoom.current * scaleFactor * 100) / 100,
            ),
          );
          setZoom(newZoom);
          showFitToast(`${Math.round(newZoom * 100)}% zoom`);
        }
      },
      onPanResponderRelease: () => {
        initialPinchDist.current = null;
      },
      onPanResponderTerminate: () => {
        initialPinchDist.current = null;
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
  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.5;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
  });
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
        !menu &&
        scrub == null &&
        !timelineFocus &&
        Date.now() - lastInteraction.current > 6000
      )
        setVisible(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [menu, scrub, timelineFocus]);
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
  const progressRatio = duration ? Math.min(1, previewTime / duration) : 0;
  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000",
        paddingTop: layoutFull ? 0 : insets.top,
      }}
    >
      <StatusBar hidden={layoutFull} barStyle="light-content" />

      {/* ── Video container ── */}
      <View
        style={
          layoutFull
            ? StyleSheet.absoluteFill
            : { width: "100%", aspectRatio: 16 / 9 }
        }
        {...(!locked ? pinchPanResponder.panHandlers : {})}
      >
        <VideoView
          ref={video}
          player={player}
          nativeControls
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={true}
          startsPictureInPictureAutomatically
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

        {/* Fit mode HUD Toast */}
        {!!fitToast && (
          <View
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
            }}
          >
            <Text
              style={{
                color: "#ffffff",
                fontSize: 14,
                fontFamily: fonts.bold,
                letterSpacing: 0.2,
              }}
            >
              {fitToast}
            </Text>
          </View>
        )}

        {/* Tap-to-toggle controls, pinch-to-zoom & double tap to toggle zoom */}
        <View
          style={StyleSheet.absoluteFill}
          {...(!locked ? pinchPanResponder.panHandlers : {})}
          collapsable
        >
          <Pressable
            accessible
            focusable
            onPress={() => {
              const now = Date.now();
              if (now - lastTapTime.current < 300) {
                if (zoom !== 1) {
                  applyFit("contain", 1);
                } else {
                  applyFit("cover", 1);
                }
                lastTapTime.current = 0;
                return;
              }
              lastTapTime.current = now;
              if (visible) setVisible(false);
              else reveal();
            }}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Screen lock: swallow every touch until the viewer unlocks */}
        {locked && (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={showUnlockHint}
              accessibilityRole="button"
              accessibilityLabel="Screen locked. Tap to show the unlock button."
            />
            {unlockHint && (
              <View style={styles.unlockOverlay} pointerEvents="box-none">
                <Pressable
                  onPress={unlockScreen}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock screen"
                  style={({ pressed }) => [
                    styles.unlockPill,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Unlock size={18} color="#000000" strokeWidth={2.4} />
                  <Text style={styles.unlockPillText}>Tap to unlock</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.lockIndicator} pointerEvents="none">
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
        <View style={{ flex: 1, backgroundColor: "#111" }}>
          {/* Title row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 6,
              gap: 12,
            }}
          >
            <CircleBtn onPress={exit} size={36} bg="rgba(255,255,255,0.1)">
              <IconBack size={18} />
            </CircleBtn>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}
                numberOfLines={1}
              >
                {manifest.title || undefined || "Plexy"}
              </Text>
              {!!manifest.subtitle && (
                <Text
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 13,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {manifest.subtitle}
                </Text>
              )}
            </View>
          </View>

          {/* Inline progress bar */}
          <Pressable
            disabled
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
                  (e.nativeEvent.actionName === "increment" ? 10 : -10),
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
            style={{ paddingHorizontal: 16, paddingVertical: 10 }}
          >
            {/* Track */}
            <View
              style={{
                height: scrub != null ? 5 : 3,
                borderRadius: 3,
                backgroundColor: "rgba(255,255,255,0.2)",
                overflow: "visible",
              }}
            >
              {/* Fill */}
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${progressRatio * 100}%`,
                  backgroundColor: "#fff",
                  borderRadius: 3,
                }}
              />
              {/* Thumb */}
              <View
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${progressRatio * 100}%`,
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: "#fff",
                  marginTop: -6,
                  marginLeft: -6,
                }}
              />
            </View>
          </Pressable>

          {/* Time labels */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
              {timeLabel(previewTime)}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
              {timeLabel(duration)}
            </Text>
          </View>

          {/* Inline control row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
              gap: 4,
            }}
          >
            <CircleBtn onPress={() => seek(position - 10)} disabled>
              <IconRewind size={20} />
            </CircleBtn>
            <CircleBtn
              onPress={togglePlay}
              size={48}
              bg="rgba(0,0,0,0.5)"
              disabled
            >
              {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </CircleBtn>
            <CircleBtn onPress={() => seek(position + 10)} disabled>
              <IconForward size={20} />
            </CircleBtn>
            <View style={{ flex: 1 }} />
            {
              <CircleBtn onPress={() => setFullscreen(true)}>
                <IconFullscreen size={20} />
              </CircleBtn>
            }
          </View>

          {/* Error / message strip */}
          {(!!error || choice.path === "unsupported") && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
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
      {show && layoutFull && !locked && (
        <View style={StyleSheet.absoluteFill}>
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={menu || resume ? "none" : "auto"}
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
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingLeft: Math.max(insets.left + 10, 16),
                paddingRight: Math.max(insets.right + 10, 16),
                paddingTop: Math.max(insets.top + 6, 14),
                paddingBottom: 10,
              }}
            >
              {/* Left cluster: Back button + Title */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                  marginRight: 12,
                }}
              >
                <CircleBtn onPress={exit} size={44} bg="rgba(0,0,0,0.45)">
                  {({ focused }) => (
                    <IconBack
                      size={22}
                      color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                    />
                  )}
                </CircleBtn>

                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text
                    style={{
                      color: "#ffffff",
                      fontSize: 15,
                      fontFamily: fonts.bold,
                      letterSpacing: -0.2,
                    }}
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
                        style={{
                          color: "rgba(255,255,255,0.65)",
                          fontSize: 11.5,
                          fontFamily: fonts.regular,
                          marginTop: 1,
                        }}
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
                <CircleBtn onPress={lockScreen} size={44} bg="rgba(0,0,0,0.45)">
                  {({ focused }) => (
                    <Lock
                      size={20}
                      color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                      strokeWidth={2}
                    />
                  )}
                </CircleBtn>
              }

              {/* Top-Right cluster: Quality, Audio, Subtitles, Episodes, Settings */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginLeft: 12,
                }}
              >
                <CircleBtn
                  onPress={() => setMenu("audio")}
                  disabled
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
                </CircleBtn>

                <CircleBtn
                  onPress={() => setMenu("captions")}
                  disabled
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
                </CircleBtn>

                {!!manifest.nextFileId && (
                  <CircleBtn
                    onPress={() => next(manifest.nextFileId!)}
                    size={44}
                    bg="rgba(0,0,0,0.45)"
                  >
                    {({ focused }) => (
                      <IconNext
                        size={22}
                        color={focused ? "#ffffff" : "rgba(255,255,255,0.9)"}
                      />
                    )}
                  </CircleBtn>
                )}

                {isPictureInPictureSupported() && (
                  <CircleBtn
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
                  </CircleBtn>
                )}

                {
                  <CircleBtn
                    onPress={cycleFitMode}
                    size={44}
                    bg="rgba(0,0,0,0.45)"
                  >
                    <IconFitState mode={fitMode} zoom={zoom} size={20} />
                  </CircleBtn>
                }

                {isTvShow && sortedEpisodes.length > 0 && (
                  <CircleBtn
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
                  </CircleBtn>
                )}

                <CircleBtn
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
                </CircleBtn>
              </View>
            </View>

            {/* ── MIDDLE PLAY CONTROLS ── */}
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                flexDirection: "row",
                gap: 28,
                opacity: status === "loading" || scrub != null || ended ? 0 : 1,
              }}
              pointerEvents={
                status === "loading" || scrub != null || ended
                  ? "none"
                  : "box-none"
              }
              accessibilityElementsHidden={
                status === "loading" || scrub != null || ended
              }
              importantForAccessibility={
                status === "loading" || scrub != null || ended
                  ? "no-hide-descendants"
                  : "auto"
              }
            >
              {/* Previous episode (if any) */}
              {!!(manifest as any).previousFileId && (
                <CircleBtn
                  onPress={() => next((manifest as any).previousFileId)}
                  size={48}
                  bg="rgba(0,0,0,0.4)"
                >
                  <IconBack size={20} />
                </CircleBtn>
              )}

              {/* Rewind 10s */}
              <CircleBtn
                onPress={() => seek(position - 10)}
                size={54}
                bg="rgba(0,0,0,0.45)"
                disabled
              >
                <IconRewind size={28} />
              </CircleBtn>

              {/* Play/Pause */}
              <CircleBtn
                onPress={togglePlay}
                size={72}
                active={true}
                activeBg="#ffffff"
                bg={"rgba(0,0,0,0.45)"}
                disabled
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
              </CircleBtn>

              {/* Forward 10s */}
              <CircleBtn
                onPress={() => seek(position + 10)}
                size={54}
                bg="rgba(0,0,0,0.45)"
                disabled
              >
                <IconForward size={28} />
              </CircleBtn>
            </View>

            {/* ── BOTTOM SECTION ── */}
            <View
              style={{
                paddingLeft: Math.max(insets.left + 10, 16),
                paddingRight: Math.max(insets.right + 10, 16),
                paddingBottom: Math.max(insets.bottom + 4, 16),
                gap: 6,
              }}
            >
              {status === "loading" && scrub == null && (
                <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                  Loading video…
                </Text>
              )}
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
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      color: "rgba(255,255,255,0.8)",
                      fontSize: 13,
                    }}
                  >
                    {message}
                  </Text>
                  <CircleBtn
                    onPress={() => setMessage("")}
                    size={32}
                    bg="rgba(255,255,255,0.15)"
                  >
                    <IconClose size={14} />
                  </CircleBtn>
                </View>
              )}

              {/* Ended card */}
              {ended && !resume && (
                <View
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    alignSelf: "center",
                    marginBottom: 8,
                  }}
                >
                  <Pressable
                    onPress={() => seek(0)}
                    accessibilityRole="button"
                    accessibilityLabel="Play again"
                    style={(s: any) => [
                      styles.endBtn,
                      s.pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={styles.endBtnText}>Play again</Text>
                  </Pressable>
                  {manifest.nextFileId && (
                    <Pressable
                      onPress={() => next(manifest.nextFileId!)}
                      accessibilityRole="button"
                      accessibilityLabel="Next episode"
                      style={(s: any) => [
                        styles.endBtn,
                        styles.endBtnPrimary,
                        s.pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.endBtnText,
                          { color: "#000", fontWeight: "700" },
                        ]}
                      >
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
                        style={(s: any) => [
                          styles.endBtn,
                          s.pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={styles.endBtnText}>Cancel</Text>
                      </Pressable>
                    )}
                </View>
              )}

              {/* Scrub trickplay preview & floating time badge */}
              {scrub != null && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    bottom: 78,
                    left: `${Math.max(12, Math.min(88, progressRatio * 100))}%`,
                    transform: [{ translateX: -60 }],
                    alignItems: "center",
                    width: 120,
                    gap: 4,
                    zIndex: 20,
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
                  <View
                    style={{
                      backgroundColor: "rgba(0,0,0,0.85)",
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.2)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 11,
                        fontFamily: fonts.bold,
                      }}
                    >
                      {timeLabel(previewTime)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Time row above timeline */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  marginBottom: 4,
                  paddingHorizontal: 2,
                }}
              >
                <Text
                  style={{
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 12,
                    fontFamily: fonts.medium,
                  }}
                >
                  {timeLabel(previewTime)} / {timeLabel(duration)}
                </Text>
              </View>

              {/* Progress bar */}
              <View
                ref={timeline}
                collapsable
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
                      (e.nativeEvent.actionName === "increment" ? 10 : -10),
                  )
                }
                onFocus={() => {
                  reveal();
                  setTimelineFocus(true);
                }}
                onBlur={() => {
                  setTimelineFocus(false);
                  if (scrub != null) seek(scrub);
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
                style={{ paddingVertical: 12 }}
              >
                {/* Track */}
                <View
                  pointerEvents="none"
                  style={{
                    height: scrub != null ? 6 : 4,
                    borderRadius: 3,
                    backgroundColor: "rgba(255,255,255,0.22)",
                    overflow: "visible",
                    borderColor: timelineFocus ? "#ffffff" : "transparent",
                    borderWidth: timelineFocus ? 1.5 : 0,
                  }}
                >
                  {/* Buffered fill */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${duration ? Math.min(100, (player.bufferedPosition / duration) * 100) : 0}%`,
                      backgroundColor: "rgba(255,255,255,0.2)",
                      borderRadius: 3,
                    }}
                  />
                  {/* Playhead fill */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${progressRatio * 100}%`,
                      backgroundColor: "#ffffff",
                      borderRadius: 3,
                    }}
                  />
                  {/* Thumb */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${progressRatio * 100}%`,
                      width: scrub != null ? 16 : 12,
                      height: scrub != null ? 16 : 12,
                      borderRadius: 8,
                      backgroundColor: "#fff",
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
                <View style={styles.diagnosticsCard}>
                  <View style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>SOURCE</Text>
                    <Text style={styles.diagnosticsVal} numberOfLines={1}>
                      {choice.path.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>RESOLUTION</Text>
                    <Text style={styles.diagnosticsVal}>
                      {player.videoTrack?.size.height
                        ? `${player.videoTrack.size.height}p`
                        : "Auto"}
                    </Text>
                  </View>
                  <View style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>BUFFERED</Text>
                    <Text style={styles.diagnosticsVal}>
                      {timeLabel(player.bufferedPosition)}
                    </Text>
                  </View>
                  <View style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>AUDIO</Text>
                    <Text style={styles.diagnosticsVal}>
                      Track {choice.audio + 1}
                    </Text>
                  </View>
                  <View style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>STATUS</Text>
                    <Text style={[styles.diagnosticsVal, { color: "#4ade80" }]}>
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
            style={{
              position: "absolute",
              right: 20,
              bottom: layoutFull
                ? Math.max(insets.bottom, 16) + (show ? 150 : 32)
                : 92,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Skip ${skipLabel}`}
              onPress={() => seek(activeSkip[1]!.end)}
              style={({ pressed }) => [
                styles.skipPill,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.skipPillText}>Skip {skipLabel}</Text>
            </Pressable>
          </View>
        )}

      {/* ── Resume prompt ── */}
      {resume && (
        <View
          style={{
            ...StyleSheet.absoluteFill,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.72)",
            padding: 24,
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(18,18,18,0.95)",
              borderRadius: 18,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              padding: 20,
              width: 320,
              maxWidth: "90%",
              alignItems: "center",
              gap: 10,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.6,
              shadowRadius: 16,
              elevation: 10,
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
              style={(s: any) => [
                {
                  width: "100%",
                  paddingVertical: 14,
                  backgroundColor: "#ffffff",
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                },
                s.pressed && { opacity: 0.85 },
              ]}
            >
              <Text
                style={{
                  color: "#000000",
                  fontFamily: fonts.bold,
                  fontSize: 15,
                }}
              >
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
              style={(s: any) => [
                {
                  width: "100%",
                  paddingVertical: 14,
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                },
                s.pressed && { opacity: 0.85 },
              ]}
            >
              <Text
                style={{
                  color: "rgba(255,255,255,0.9)",
                  fontFamily: fonts.medium,
                  fontSize: 14,
                }}
              >
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
              style={(s: any) => [
                {
                  width: "100%",
                  paddingVertical: 12,
                  backgroundColor: "transparent",
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                },
                s.pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontFamily: fonts.medium,
                  fontSize: 14,
                }}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Right-side drawer menus ── */}
      <Modal
        visible={menu != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenu(null)}
        supportedOrientations={["portrait", "landscape"]}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            focusable
            onPress={() => setMenu(null)}
          />
          <Animated.View
            style={[
              styles.sheetContainer,
              { transform: [{ translateX: drawerAnim }] },
            ]}
          >
            <View style={{ flex: 1 }}>
              {/* Title row */}
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitle}>
                  {menu === "captions"
                    ? "Subtitles"
                    : menu === "audio"
                      ? "Audio tracks"
                      : menu === "quality"
                        ? "Video quality"
                        : menu === "episodes"
                          ? `Episodes (${sortedEpisodes.length})`
                          : "Player settings"}
                </Text>
                <Pressable
                  focusable={true}
                  onPress={() => {
                    setMenu(null);
                    reveal();
                  }}
                  style={({ pressed }: any) => [
                    styles.sheetCloseBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Close menu"
                >
                  <IconClose size={18} color="#fff" />
                </Pressable>
              </View>

              {/* Episodes menu */}
              {menu === "episodes" && (
                <ScrollView
                  ref={episodesScrollRef}
                  contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 24),
                  }}
                  showsVerticalScrollIndicator={true}
                >
                  {sortedEpisodes.map((ep, idx) => {
                    const isCurrent =
                      ep.fileId === manifest.fileId ||
                      ep.id === manifest.itemId ||
                      (ep.seasonNumber === manifest.seasonNumber &&
                        ep.episodeNumber === manifest.episodeNumber);
                    const isEpWatched =
                      drawerWatchedOverride[ep.id] ??
                      (progress.latest(ep.id)?.played ||
                        Boolean(ep.watch?.played));
                    const epLabel =
                      ep.seasonNumber != null && ep.episodeNumber != null
                        ? `S${ep.seasonNumber} · E${ep.episodeNumber}`
                        : `Episode ${ep.episodeNumber ?? idx + 1}`;
                    return (
                      <Pressable
                        key={ep.id || `${ep.seasonNumber}-${ep.episodeNumber}`}
                        onPress={() => {
                          if (ep.fileId) {
                            setMenu(null);
                            next(ep.fileId);
                          }
                        }}
                        style={({ pressed }) => [
                          styles.episodeItem,
                          isCurrent && styles.episodeItemCurrent,
                          pressed && { opacity: 0.75 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${epLabel}, ${ep.name}${isCurrent ? ", currently playing" : ""}`}
                      >
                        <View style={styles.episodeThumbContainer}>
                          {ep.still || ep.backdrop || ep.poster ? (
                            <PosterImage
                              source={api.image(
                                ep.still || ep.backdrop || ep.poster,
                              )}
                              style={styles.episodeThumb}
                            />
                          ) : (
                            <View style={styles.episodeThumbFallback}>
                              <Film size={18} color="rgba(255,255,255,0.3)" />
                            </View>
                          )}
                          {isCurrent && (
                            <View style={styles.episodeThumbActiveOverlay}>
                              <PlayIcon
                                size={14}
                                color="#000000"
                                fill="#000000"
                              />
                            </View>
                          )}
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <Text
                              style={[
                                styles.episodeBadge,
                                isCurrent && styles.episodeBadgeCurrent,
                              ]}
                            >
                              {epLabel}
                            </Text>
                            {isCurrent && (
                              <View style={styles.nowPlayingPill}>
                                <Text style={styles.nowPlayingText}>
                                  NOW PLAYING
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.episodeItemTitle,
                              isCurrent && styles.episodeItemTitleCurrent,
                            ]}
                            numberOfLines={2}
                          >
                            {ep.name ||
                              `Episode ${ep.episodeNumber ?? idx + 1}`}
                          </Text>
                          {ep.watch?.duration ? (
                            <Text style={styles.episodeDuration}>
                              {timeLabel(ep.watch.duration)}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => void toggleDrawerEpWatched(ep)}
                          hitSlop={10}
                          style={({ pressed }) => [
                            styles.drawerEpWatchedBtn,
                            isEpWatched && styles.drawerEpWatchedBtnActive,
                            pressed && { opacity: 0.6 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={
                            isEpWatched ? "Mark unwatched" : "Mark watched"
                          }
                        >
                          <IconCheck
                            size={16}
                            color={
                              isEpWatched ? "#22c55e" : "rgba(255,255,255,0.4)"
                            }
                          />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              {menu !== "episodes" && (
                <ScrollView
                  contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 20),
                  }}
                  showsVerticalScrollIndicator
                >
                  {/* Settings menu */}
                  {menu === "settings" && (
                    <>
                      <SheetSection label="Playback" />
                      <SheetChips
                        label="Speed"
                        options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
                          key: String(rate),
                          label: `${rate}×`,
                          active: preferences.playbackRate === rate,
                          onPress: () => {
                            player.playbackRate = rate;
                            updatePreferences({ playbackRate: rate });
                          },
                        }))}
                      />

                      {
                        <>
                          <SheetSection label="Picture" />
                          <SheetChips
                            label="Fit"
                            options={[
                              {
                                key: "contain",
                                label: "Best fit",
                                active: fitMode === "contain",
                                onPress: () => applyFit("contain", zoom),
                              },
                              {
                                key: "cover",
                                label: "Crop",
                                active: fitMode === "cover",
                                onPress: () => applyFit("cover", zoom),
                              },
                              {
                                key: "fill",
                                label: "Stretch",
                                active: fitMode === "fill",
                                onPress: () => applyFit("fill", zoom),
                              },
                            ]}
                          />
                          <SheetChips
                            label="Zoom"
                            options={[1, 1.25, 1.5, 2].map((scale) => ({
                              key: String(scale),
                              label: `${Math.round(scale * 100)}%`,
                              active: zoom === scale,
                              onPress: () => applyFit(fitMode, scale),
                            }))}
                          />
                        </>
                      }

                      <SheetSection label="Player" />
                      <SheetItem
                        label="Playback diagnostics"
                        selected={diagnostics}
                        onPress={() => setDiagnostics((v) => !v)}
                      />
                      {isPictureInPictureSupported() && (
                        <SheetItem
                          label="Picture in picture"
                          onPress={() => {
                            setMenu(null);
                            pip.current = true;
                            void video.current
                              ?.startPictureInPicture()
                              .catch(() => {
                                pip.current = false;
                                setMessage(
                                  "Picture in picture is unavailable on this device.",
                                );
                              });
                          }}
                        />
                      )}
                    </>
                  )}

                  {/* Audio tracks */}
                  {menu === "audio" &&
                    (nativeAudio.length ? (
                      <>
                        <SheetSection label="Tracks" />
                        {nativeAudio.map((track) => (
                          <SheetItem
                            key={track.id}
                            label={
                              track.label ||
                              track.language ||
                              track.id ||
                              "Audio track"
                            }
                            selected={player.audioTrack?.id === track.id}
                            onPress={() => {
                              player.audioTrack = track;
                              setMenu(null);
                            }}
                          />
                        ))}
                      </>
                    ) : (
                      <Text style={styles.sheetEmpty}>
                        This file has a single audio track.
                      </Text>
                    ))}

                  {/* Subtitles */}
                  {menu === "captions" && (
                    <>
                      <SheetSection label="Track" />
                      <SheetItem
                        label="Off"
                        selected={!subtitle}
                        onPress={() => {
                          setSubtitle(null);
                          updatePreferences({ autoSubtitles: false });
                        }}
                      />
                      {manifest.tracks?.map((track) => (
                        <SheetItem
                          key={track.track}
                          label={track.title || track.language || track.track}
                          selected={subtitle === track.track}
                          onPress={() => {
                            setSubtitle(track.track);
                            updatePreferences({
                              autoSubtitles: true,
                              subtitleLanguage: track.language || "",
                            });
                          }}
                        />
                      ))}

                      {platform.local?.pickSubtitle && (
                        <SheetItem
                          label="Add subtitle file"
                          hint="SRT or VTT"
                          onPress={() => {
                            void platform.local!.pickSubtitle!(manifest.fileId)
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
                              })
                              .catch(() =>
                                setMessage(
                                  "Could not add this subtitle file. Choose an SRT or VTT file.",
                                ),
                              );
                          }}
                        />
                      )}
                      {nativeSubtitles.map((track) => (
                        <SheetItem
                          key={`native:${track.id}`}
                          label={
                            track.label ||
                            track.language ||
                            "Embedded subtitles"
                          }
                          selected={subtitle === `native:${track.id}`}
                          onPress={() => {
                            setSubtitle(`native:${track.id}`);
                            updatePreferences({ autoSubtitles: true });
                          }}
                        />
                      ))}

                      <SheetSection label="Timing & appearance" />
                      <SheetChips
                        label={
                          preferences.subtitleOffset === 0
                            ? "Timing"
                            : `Timing ${preferences.subtitleOffset > 0 ? "+" : ""}${preferences.subtitleOffset.toFixed(1)}s`
                        }
                        options={[
                          {
                            key: "earlier",
                            label: "−0.5s",
                            onPress: () =>
                              updatePreferences({
                                subtitleOffset:
                                  preferences.subtitleOffset - 0.5,
                              }),
                          },
                          {
                            key: "reset",
                            label: "Reset",
                            active: preferences.subtitleOffset === 0,
                            onPress: () =>
                              updatePreferences({ subtitleOffset: 0 }),
                          },
                          {
                            key: "later",
                            label: "+0.5s",
                            onPress: () =>
                              updatePreferences({
                                subtitleOffset:
                                  preferences.subtitleOffset + 0.5,
                              }),
                          },
                        ]}
                      />
                      <SheetChips
                        label="Size"
                        options={[18, 22, 28, 34].map((size) => ({
                          key: String(size),
                          label: `${size}`,
                          active: preferences.subtitleSize === size,
                          onPress: () =>
                            updatePreferences({ subtitleSize: size }),
                        }))}
                      />
                      <View style={styles.sheetStepper}>
                        <View>
                          <Text style={styles.sheetChipsLabel}>
                            Vertical Position
                          </Text>
                          <Text style={styles.sheetStepperValue}>
                            {subVertical}%
                          </Text>
                        </View>
                        <View style={styles.sheetStepperButtons}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Move subtitles higher"
                            onPress={() => {
                              const nextVal = Math.max(8, subVertical - 6);
                              setSubVertical(nextVal);
                              updatePreferences({
                                subtitlePosition:
                                  nextVal < 50 ? "top" : "bottom",
                              });
                            }}
                            style={({ pressed }) => [
                              styles.sheetStepperButton,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <Minus
                              size={18}
                              color="#ffffff"
                              strokeWidth={2.4}
                            />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Move subtitles lower"
                            onPress={() => {
                              const nextVal = Math.min(92, subVertical + 6);
                              setSubVertical(nextVal);
                              updatePreferences({
                                subtitlePosition:
                                  nextVal < 50 ? "top" : "bottom",
                              });
                            }}
                            style={({ pressed }) => [
                              styles.sheetStepperButton,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <Plus size={18} color="#ffffff" strokeWidth={2.4} />
                          </Pressable>
                        </View>
                      </View>
                      <SheetChips
                        label="Position Presets"
                        options={[
                          {
                            key: "top",
                            label: "Top (12%)",
                            active: subVertical === 12,
                            onPress: () => {
                              setSubVertical(12);
                              updatePreferences({ subtitlePosition: "top" });
                            },
                          },
                          {
                            key: "center",
                            label: "Center (50%)",
                            active: subVertical === 50,
                            onPress: () => {
                              setSubVertical(50);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                          {
                            key: "lower",
                            label: "Lower (75%)",
                            active: subVertical === 75,
                            onPress: () => {
                              setSubVertical(75);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                          {
                            key: "bottom",
                            label: "Bottom (88%)",
                            active: subVertical === 88,
                            onPress: () => {
                              setSubVertical(88);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                        ]}
                      />
                    </>
                  )}

                  {/* Quality */}
                  {menu === "quality" && (
                    <Text style={styles.sheetEmpty}>
                      Original file quality. No video conversion.
                    </Text>
                  )}
                </ScrollView>
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}
// ---------------------------------------------------------------------------
// SheetItem — full-width list row for bottom sheets
// ---------------------------------------------------------------------------
function SheetItem({
  label,
  hint,
  selected,
  onPress,
  preferred,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress: () => void;
  preferred?: boolean;
}) {
  const [, setFocused] = useState(false);
  return (
    <Pressable
      focusable={true}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.sheetItem,
        selected && styles.sheetItemSelected,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[styles.sheetItemText, selected && styles.sheetItemTextSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {!!hint && (
        <Text style={[styles.sheetItemHint]} numberOfLines={1}>
          {hint}
        </Text>
      )}
      {selected ? (
        <View style={[styles.sheetCheckBadge]}>
          <IconCheck size={15} color="#000000" />
        </View>
      ) : null}
    </Pressable>
  );
}
// ---------------------------------------------------------------------------
// Sheet section label
// ---------------------------------------------------------------------------
function SheetSection({ label }: { label: string }) {
  return (
    <View style={styles.sheetSection}>
      <Text style={styles.sheetSectionText}>{label}</Text>
    </View>
  );
}
// ---------------------------------------------------------------------------
// SheetChips — inline choice row, far easier to scan than one row per value
// ---------------------------------------------------------------------------
type SheetChipOption = {
  key: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};
function SheetChips({
  label,
  options,
}: {
  label: string;
  options: SheetChipOption[];
}) {
  return (
    <View style={styles.sheetChipsBlock}>
      <Text style={styles.sheetChipsLabel}>{label}</Text>
      <View style={styles.sheetChipsRow}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.active }}
            onPress={option.onPress}
            style={({ pressed }) => [
              styles.sheetChip,
              option.active && styles.sheetChipActive,
              pressed && { opacity: 0.72 },
            ]}
          >
            <Text
              style={[
                styles.sheetChipText,
                option.active && styles.sheetChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Skip pill
  skipPill: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  skipPillText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 14,
  },
  // End screen buttons
  endBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  endBtnPrimary: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  endBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontWeight: "600",
    fontSize: 14,
  },
  // Right-side drawer
  sheetBackdrop: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheetContainer: {
    backgroundColor: "#0d0e12",
    width: "48%",
    minWidth: 380,
    maxWidth: 540,
    height: "100%",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  sheetItemSelected: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  sheetItemText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  sheetItemTextSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  sheetItemHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "500",
    marginRight: 10,
  },
  sheetCheckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSection: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 4,
  },
  sheetSectionText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  sheetChipsBlock: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 10,
  },
  sheetChipsLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  sheetChipsRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
  },
  sheetChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sheetChipActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  sheetChipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "600",
  },
  sheetChipTextActive: {
    color: "#000000",
  },
  sheetStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  sheetStepperValue: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  sheetStepperButtons: {
    flexDirection: "row",
    gap: 8,
  },
  sheetStepperButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetEmpty: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  // Episodes drawer
  episodeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  episodeItemCurrent: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderLeftWidth: 3,
    borderLeftColor: "#ffffff",
  },
  episodeBadge: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  episodeBadgeCurrent: {
    color: "#ffffff",
  },
  nowPlayingPill: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  nowPlayingText: {
    color: "#000000",
    fontSize: 9,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
  },
  drawerEpWatchedBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  drawerEpWatchedBtnActive: {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
  },
  episodeItemTitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
  },
  episodeItemTitleCurrent: {
    color: "#ffffff",
    fontWeight: "700",
  },
  episodeDuration: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
  },
  episodeThumbContainer: {
    width: 88,
    height: 50,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginRight: 12,
  },
  episodeThumb: {
    width: 88,
    height: 50,
    borderRadius: 6,
  },
  episodeThumbFallback: {
    width: 88,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  episodeThumbActiveOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Diagnostics HUD
  diagnosticsCard: {
    backgroundColor: "rgba(0,0,0,0.8)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  diagnosticsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  diagnosticsLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.45)",
    width: 80,
  },
  diagnosticsVal: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
  // Screen lock
  unlockOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  unlockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.94)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
  },
  unlockPillText: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "700",
  },
  lockIndicator: {
    position: "absolute",
    top: 20,
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});
