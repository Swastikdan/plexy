import { ArrowLeft, Play, Pause, SlidersHorizontal } from "@/shared/ui/icons";
import { useKeepAwake } from "expo-keep-awake";
import * as Orientation from "expo-screen-orientation";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  Pressable,
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
import { Lock, Unlock } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { Label } from "@/shared/ui/text";
import { LocalThumbnail } from "./components/local-thumbnail";
import { AudioPanel } from "./components/audio-panel";
import { BottomToolbar } from "./components/bottom-toolbar";
import { PlayerControl } from "./components/player-control";
import { PlayerDrawer } from "./components/player-drawer";
import { PlayerGestureHud } from "./components/player-gesture-hud";
import { IconSeekBack, IconSeekForward } from "./components/player-icons";
import { PlayerLoading } from "./components/player-loading";
import { SpeedPanel } from "./components/speed-panel";
import { TimelineBar } from "./components/timeline-bar";
import { usePlayerControls } from "./hooks/use-player-controls";
import { usePlayerGestures } from "./hooks/use-player-gestures";
import { usePlayerOrientation } from "./hooks/use-player-orientation";
import { bufferOptionsForDuration } from "./lib/player-buffer";
import {
  SEEK_SECONDS,
  shouldShowPlayerLoading,
} from "./lib/player-interactions";
import { usePlayerSubtitles } from "./hooks/use-player-subtitles";

interface SourceChoice {
  path: string;
  audio: number;
  start: number;
  maxHeight?: number;
  uri?: string;
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
}: {
  initial: Playability;
  back: () => void;
  next: (id: number) => void;
}) {
  useKeepAwake();
  const { api, runtime, preferences, updatePreferences, progress } =
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
  const resumeBackdropOpacity = useRef(new Animated.Value(0)).current;
  const resumeCardOpacity = useRef(new Animated.Value(0)).current;
  const resumeCardScale = useRef(new Animated.Value(0.94)).current;
  const [skips, setSkips] = useState<SkipSegments>({
    intro: null,
    recap: null,
    outro: null,
  });
  const [scrub, setScrub] = useState<number | null>(null);
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
  } = usePlayerControls({ playing, status, scrub });
  const {
    fitMode,
    zoom,
    applyFit,
    brightness,
    volume,
    adjusting,
    videoGestures,
    viewportWidth,
    onTap,
    fitToast,
    toastOpacity,
    toastScale,
    showFitToast,
  } = usePlayerGestures({
    hasLoaded,
    height: win.height,
    locked,
    reduceMotion,
    seekBy: (seconds) => seek(currentPosition.current + seconds),
    toggleControls,
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
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [autoNextCancelled, setAutoNextCancelled] = useState(false);
  const [nativeAudio, setNativeAudio] = useState<
    typeof player.availableAudioTracks
  >([]);
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
  const lastSaved = useRef(0);
  const chosenStart = useRef(0);
  const initialized = useRef(false);
  const chromeIn = useRef(new Animated.Value(1)).current;
  const player = useVideoPlayer(null, (instance) => {
    instance.bufferOptions = bufferOptionsForDuration(initial.duration || 0);
    instance.timeUpdateEventInterval = 0.5;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
  });
  const {
    subtitle,
    setSubtitle,
    nativeSubtitles,
    subVertical,
    setSubVertical,
    loadSubtitleTracks,
    text,
  } = usePlayerSubtitles({
    initial,
    fileId: manifest.fileId,
    player,
    position,
    onError: setMessage,
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
  const seek = (seconds: number) => {
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
        setNativeAudio(e.availableAudioTracks);
        loadSubtitleTracks(e.availableSubtitleTracks);
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

  const show =
    visible || !!menu || speedPanel || audioPanel || resume || ended || !!error;
  const openingVideo = shouldShowPlayerLoading(
    status,
    hasLoaded,
    scrub != null,
  );
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
        <View
          pointerEvents="none"
          className="absolute inset-0 bg-black"
          style={{ opacity: (1 - brightness) * 0.9 }}
        />

        {openingVideo && <PlayerLoading />}
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
              viewportWidth.current = event.nativeEvent.layout.width;
            }}
            onPress={onTap}
            className="absolute inset-0"
          />
        </View>
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
      {show && !locked && (
        <Animated.View
          className="absolute inset-0"
          pointerEvents="box-none"
          style={{ opacity: chromeIn }}
        >
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
            <PlayerControl onPress={exit} size={42} bg="rgba(0,0,0,0.4)">
              <ArrowLeft strokeWidth={2.2} color="#ffffff" size={20} />
            </PlayerControl>
          </View>
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
                <Pause fill="#ffffff" size={44} color="#ffffff" />
              ) : (
                <Play fill="#ffffff" size={46} color="#ffffff" />
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
          {!openingVideo && !ended && (
            <PlayerGestureHud
              brightness={brightness}
              volume={volume}
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
      <PlayerDrawer
        menu={menu}
        setMenu={setMenu}
        sortedEpisodes={sortedEpisodes}
        reveal={reveal}
        insets={insets}
        manifest={manifest}
        next={next}
        picture={{
          fitMode,
          applyFit,
          zoom,
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
          player.playbackRate = rate;
          updatePreferences({ playbackRate: rate });
        }}
      />
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
      <AudioPanel
        visible={audioPanel && !locked}
        onClose={() => setAudioPanel(false)}
        player={player}
        nativeAudio={nativeAudio}
        subtitle={subtitle}
        serverTracks={manifest.tracks}
        nativeSubtitles={nativeSubtitles}
        canAddSubtitleFile={Boolean(runtime.pickSubtitle)}
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
