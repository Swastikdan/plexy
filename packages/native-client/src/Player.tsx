import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  findNodeHandle,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  VideoView,
  isPictureInPictureSupported,
  useVideoPlayer,
} from "expo-video";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as Orientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  RotateCcw,
  RotateCw,
  AudioLines,
  Subtitles as SubtitlesIcon,
  Cast as CastIcon,
  SkipForward,
  SlidersHorizontal,
  Play as PlayIcon,
  Pause as PauseIcon,
  ArrowLeft as ArrowLeftIcon,
  Maximize,
  Minimize,
  Check as CheckIcon,
  X as XIcon,
  PictureInPicture,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { useClient } from "./context";
import { usePlayerOrientation } from "./use-player-orientation";
import { useResource } from "./hooks";
import { Button, Heading, Label, Loading, Notice } from "./ui";
import { colors, fonts, timeLabel } from "./theme";
import {
  parseHlsVariants,
  parsePreviews,
  parseVtt,
  subtitleText,
  type Cue,
  type Preview,
} from "./vtt";
import type { DownloadEntry } from "./downloads";
import type { Playability, SkipSegments } from "./api";

// ---------------------------------------------------------------------------
// Player Icon components — high-contrast crisp Lucide icons
// ---------------------------------------------------------------------------

function IconBack({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return <ArrowLeftIcon size={size} color={color} strokeWidth={2.2} />;
}

function IconPlay({ size = 32, color = "#fff" }: { size?: number; color?: string }) {
  return <PlayIcon size={size} color={color} fill={color} />;
}

function IconPause({ size = 30, color = "#fff" }: { size?: number; color?: string }) {
  return <PauseIcon size={size} color={color} fill={color} />;
}

function IconRewind({ size = 30, color = "#fff", seconds = 10 }: { size?: number; color?: string; seconds?: number }) {
  const containerSize = size + 16;
  return (
    <View style={{ width: containerSize, height: containerSize, justifyContent: "center", alignItems: "center" }}>
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

function IconForward({ size = 30, color = "#fff", seconds = 10 }: { size?: number; color?: string; seconds?: number }) {
  const containerSize = size + 16;
  return (
    <View style={{ width: containerSize, height: containerSize, justifyContent: "center", alignItems: "center" }}>
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

function IconPip({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <PictureInPicture size={size} color={color} strokeWidth={1.9} />;
}

function IconAudio({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <AudioLines size={size} color={color} strokeWidth={2} />;
}

function IconSubtitles({ size = 22, color = "#fff", active = false }: { size?: number; color?: string; active?: boolean }) {
  return <SubtitlesIcon size={size} color={color} strokeWidth={2} />;
}

function IconSettings({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <SlidersHorizontal size={size} color={color} strokeWidth={2} />;
}

function IconFullscreen({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <Maximize size={size} color={color} strokeWidth={2} />;
}

function IconMinimize({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <Minimize size={size} color={color} strokeWidth={2} />;
}

function IconMoreVert({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <SlidersHorizontal size={size} color={color} strokeWidth={2} />;
}

function IconClose({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <XIcon size={size} color={color} strokeWidth={2.2} />;
}

function IconNext({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return <SkipForward size={size} color={color} strokeWidth={2} />;
}

function IconCheck({ size = 20, color = "#ffffff" }: { size?: number; color?: string }) {
  return <CheckIcon size={size} color={color} strokeWidth={2.5} />;
}

function IconVolume({ size = 22, color = "#fff", muted = false }: { size?: number; color?: string; muted?: boolean }) {
  return muted ? (
    <VolumeX size={size} color={color} strokeWidth={2} />
  ) : (
    <Volume2 size={size} color={color} strokeWidth={2} />
  );
}

// ---------------------------------------------------------------------------
// Circular control button
// ---------------------------------------------------------------------------

function CircleBtn({
  onPress,
  size = 44,
  bg = "rgba(0,0,0,0.3)",
  children,
  disabled = false,
  active = false,
  activeBg = "#ffffff",
  hasTVPreferredFocus = false,
}: {
  onPress: () => void;
  size?: number;
  bg?: string;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  activeBg?: string;
  hasTVPreferredFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const currentBg = active ? activeBg : focused ? "rgba(255,255,255,0.35)" : bg;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: currentBg,
          justifyContent: "center",
          alignItems: "center",
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
          borderWidth: focused && !active ? 2 : 0,
          borderColor: "#ffffff",
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// PlayerScreen (data loading shell)
// ---------------------------------------------------------------------------

export function PlayerScreen({
  fileId,
  offline,
  back,
  next,
}: {
  fileId: number;
  offline?: DownloadEntry;
  back: () => void;
  next: (id: number) => void;
}) {
  const { api, progress } = useClient();
  const resource = useResource(async () => {
    const manifest = offline ? offline.manifest : await api.play(fileId);
    const pending = manifest.itemId
      ? progress.latest(manifest.itemId)
      : undefined;
    return pending && (offline || !pending.synced)
      ? {
          ...manifest,
          watch: {
            position: pending.position,
            duration: pending.duration || null,
            played: pending.played,
          },
        }
      : manifest;
  }, [api, fileId, offline]);
  if (resource.loading) return <Loading />;
  if (resource.error)
    return (
      <View style={{ padding: 24 }}>
        <Button label="Back" onPress={back} />
        <Notice message={resource.error} retry={resource.retry} />
      </View>
    );
  return (
    resource.value && (
      <Playback
        key={`${fileId}-${offline?.id || "online"}`}
        initial={resource.value}
        offline={offline}
        back={back}
        next={next}
      />
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
  offline,
  back,
  next,
}: {
  initial: Playability;
  offline?: DownloadEntry;
  back: () => void;
  next: (id: number) => void;
}) {
  useKeepAwake();
  const { api, session, platform, preferences, updatePreferences, progress } =
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
    "settings" | "audio" | "captions" | "quality" | null
  >(null);
  const [subtitle, setSubtitle] = useState<string | null>(() =>
    preferences.autoSubtitles
      ? initial.tracks?.find((t) => t.language === preferences.subtitleLanguage)
          ?.track ||
        initial.tracks?.find((t) => t.isDefault)?.track ||
        null
      : null,
  );
  const [cues, setCues] = useState<Cue[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [variants, setVariants] = useState<
    Array<{ label: string; uri: string }>
  >([]);
  const [skips, setSkips] = useState<SkipSegments>({
    intro: null,
    recap: null,
    outro: null,
  });
  const [scrub, setScrub] = useState<number | null>(null);
  const [timelineFocus, setTimelineFocus] = useState(false);
  const [timelineHandle, setTimelineHandle] = useState<number | undefined>();
  const timeline = useRef<View>(null);
  const [casting, setCasting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [autoNextCancelled, setAutoNextCancelled] = useState(false);
  const [nativeAudio, setNativeAudio] = useState<
    typeof player.availableAudioTracks
  >([]);
  const [volume, setVolume] = useState(1);
  const expectedUri = useRef("");
  const audioRequest = useRef(0);
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
    lastInteraction.current = Date.now();
    setVisible(true);
  };
  const seek = (seconds: number) => {
    if (casting) return;
    const target = Math.max(
      0,
      Math.min(duration || Number.MAX_SAFE_INTEGER, seconds),
    );
    setScrub(null);
    setEnded(false);
    setCountdown(10);
    setAutoNextCancelled(false);
    reveal();
    if (!offline && (choice.path === "remux" || choice.path === "transcode")) {
      setChoice((old) => ({
        ...old,
        start: target,
        revision: old.revision + 1,
      }));
    } else {
      player.currentTime = target;
      currentPosition.current = target;
      setPosition(target);
    }
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
            "Playback stopped. Retry, or use server conversion for an unsupported format.",
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
        const value = Math.max(0, chosenStart.current - offset.current);
        player.currentTime = value;
        currentPosition.current = chosenStart.current;
        setPosition(chosenStart.current);
        if (!durationRef.current && e.duration > 0) setDuration(e.duration);
        initialized.current = true;
        player.playbackRate = preferencesRef.current.playbackRate;
        player.play();
      }),
      player.addListener("playToEnd", () => {
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
    if (!started || (!offline && choice.path === "unsupported")) return;
    let live = true;
    setError("");
    setStatus("loading");
    initialized.current = false;
    const converted =
      !offline && (choice.path === "remux" || choice.path === "transcode");
    offset.current = converted ? Math.floor(choice.start) : 0;
    chosenStart.current = choice.start;
    const uri =
      offline?.uri ||
      choice.uri ||
      api.stream(
        manifest.fileId,
        choice.path,
        choice.start,
        choice.audio,
        choice.maxHeight,
      );
    expectedUri.current = uri;
    void player
      .replaceAsync({
        uri,
        headers: offline ? undefined : api.headers(),
        contentType: !offline && choice.path === "hls" ? "hls" : "auto",
        metadata: {
          title: manifest.title || "Plexy",
          artist: manifest.subtitle || undefined,
        },
      })
      .catch(() => {
        if (live)
          setError(
            "Could not open this video. Check the connection, then retry.",
          );
      });
    return () => {
      live = false;
    };
  }, [api, choice, manifest.fileId, offline, player, started]);
  useEffect(() => {
    if (offline) {
      setSkips(offline.skips || { intro: null, recap: null, outro: null });
      return;
    }
    void api
      .skips(manifest.fileId)
      .then(setSkips)
      .catch(() => {});
  }, [api, manifest.fileId, offline]);
  useEffect(() => {
    const controller = new AbortController();
    setCues([]);
    if (!subtitle) return;
    if (offline) {
      setCues(offline.subtitles?.[subtitle] || []);
      if (!offline.subtitles?.[subtitle])
        setMessage("This subtitle was not saved with the download.");
      return;
    }
    void api
      .text(
        `/api/subtitles/${manifest.fileId}/${encodeURIComponent(subtitle)}`,
        controller.signal,
      )
      .then((text) => setCues(parseVtt(text)))
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage(
            "Could not load the selected subtitle. Choose another track or retry.",
          );
      });
    return () => controller.abort();
  }, [api, manifest.fileId, offline, offline?.subtitles, subtitle]);
  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const url = `/api/trickplay/${manifest.fileId}/track.vtt`;
      void api
        .text(url, controller.signal)
        .then((text) => setPreviews(parsePreviews(text, api.url(url))))
        .catch(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 30000);
        });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, manifest.fileId, offline]);
  useEffect(() => {
    setVariants([]);
    if (offline || manifest.path !== "hls") return;
    const controller = new AbortController();
    const url = api.stream(manifest.fileId, "hls", 0, choice.audio);
    void api
      .text(url, controller.signal)
      .then((text) => setVariants(parseHlsVariants(text, url)))
      .catch(() => {});
    return () => controller.abort();
  }, [api, manifest.fileId, manifest.path, choice.audio, offline]);
  useEffect(() => {
    const active = Object.values(skips).find(
      (segment) =>
        segment && position >= segment.start && position < segment.end,
    );
    if (preferences.autoSkip && active && active.end !== autoSkipEnd.current) {
      autoSkipEnd.current = active.end;
      seek(active.end);
    }
  }, [position, preferences.autoSkip, skips]);
  useEffect(() => {
    if (
      !ended ||
      !preferences.autoNext ||
      autoNextCancelled ||
      !manifest.nextFileId ||
      offline
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
    offline,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        !platform.tv &&
        playingRef.current &&
        !menu &&
        scrub == null &&
        !timelineFocus &&
        Date.now() - lastInteraction.current > 6000
      )
        setVisible(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [menu, scrub, timelineFocus, platform.tv]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        save();
        if (!pip.current) player.pause();
      } else reveal();
    });
    return () => sub.remove();
  }, [player, save]);
  usePlayerOrientation(fullscreen, platform.tv, () =>
    setMessage("The device could not change screen orientation."),
  );
  useEffect(() => {
    if (error && fullscreen && !platform.tv) setFullscreen(false);
  }, [error, fullscreen, platform.tv]);
  const exit = () => {
    save();
    player.pause();
    if (!platform.tv) {
      void Orientation.lockAsync(Orientation.OrientationLock.PORTRAIT).catch(() => {});
    }
    back();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (menu) {
        setMenu(null);
        return true;
      }
      exit();
      return true;
    });
    return () => sub.remove();
  }, [menu, fullscreen, platform.tv, back, save, player]);
  const switchAudio = async (audio: number) => {
    setMenu(null);
    save();
    const request = ++audioRequest.current;
    try {
      const updated = await api.play(manifest.fileId, audio);
      if (!mounted.current || request !== audioRequest.current) return;
      setManifest(updated);
      setChoice((old) => ({
        path: updated.path,
        start: currentPosition.current,
        audio: updated.selectedAudioIndex ?? audio,
        revision: old.revision + 1,
      }));
    } catch {
      if (!mounted.current || request !== audioRequest.current) return;
      setMessage(
        "Could not switch audio tracks. Check the connection and try again.",
      );
    }
  };
  const togglePlay = () => {
    if (casting) return;
    reveal();
    if (ended) seek(0);
    player.playing ? player.pause() : player.play();
  };
  const remoteEvent = (event: string) => {
    if (menu || resume) return;
    if (event === "playPause" || event === "play" || event === "pause") {
      togglePlay();
      return;
    }
    if (event === "fastForward" || event === "rewind") {
      seek(currentPosition.current + (event === "rewind" ? -10 : 10));
      reveal();
      return;
    }
    // Remote Left / Right navigation
    if (["left", "right", "longLeft", "longRight"].includes(event)) {
      const delta = event.toLowerCase().includes("left") ? -10 : 10;
      const target = Math.max(0, Math.min(duration, (scrub ?? currentPosition.current) + delta));
      setScrub(target);
      seek(target);
      reveal();
      return;
    }
    // Remote Select / Center
    if (event === "select" || event === "center" || event === "dpadCenter") {
      if (scrub != null) {
        seek(scrub);
        setScrub(null);
      } else if (!visible) {
        reveal();
      } else {
        togglePlay();
      }
      return;
    }
    reveal();
  };
  const activeSkip = Object.entries(skips).find(
    ([, segment]) =>
      segment && position >= segment.start && position < segment.end,
  );
  const previewTime = scrub ?? position;
  const preview = previews.find(
    (p) => previewTime >= p.start && previewTime < p.end,
  );
  const text = subtitleText(cues, position, preferences.subtitleOffset);
  const show = casting || visible || !!menu || resume || ended || !!error;
  const layoutFull = fullscreen || platform.tv;
  const CastControl = platform.CastControl;
  const RemoteEvents = platform.RemoteEvents;
  const FocusGroup = platform.FocusGroup;

  // Progress ratio helpers
  const progressRatio = duration ? Math.min(1, (previewTime / duration)) : 0;
  const hasQualities = !offline && (
    variants.length > 1 ||
    Boolean(manifest.versions && manifest.versions.length > 1) ||
    manifest.path === "hls"
  );

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
      <RemoteEvents onEvent={remoteEvent} />

      {/* ── Video container ── */}
      <View
        style={
          layoutFull
            ? StyleSheet.absoluteFill
            : { width: "100%", aspectRatio: 16 / 9 }
        }
      >
        <VideoView
          ref={video}
          player={player}
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={!platform.tv}
          startsPictureInPictureAutomatically={false}
          onPictureInPictureStart={() => {
            pip.current = true;
          }}
          onPictureInPictureStop={() => {
            pip.current = false;
            reveal();
          }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
        />

        {/* Tap-to-toggle controls */}
        <Pressable
          accessible={false}
          focusable={false}
          onPress={() => {
            if (visible) setVisible(false);
            else reveal();
          }}
          style={StyleSheet.absoluteFill}
        />

        {/* Subtitle overlay */}
        {!!text && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: "8%",
              right: "8%",
              [preferences.subtitlePosition]: preferences.subtitlePosition === "bottom"
                ? (layoutFull ? Math.max(34, insets.bottom + 26) : 16)
                : (layoutFull ? Math.max(28, insets.top + 20) : 14),
              alignItems: "center",
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

        {/* Loading spinner */}
        {status === "loading" && (
          <View
            pointerEvents="none"
            style={{ ...StyleSheet.absoluteFill, justifyContent: "center" }}
          >
            <Loading />
          </View>
        )}
      </View>

      {/* ── Inline (non-fullscreen) title + simple controls ── */}
      {!layoutFull && (
        <View style={{ flex: 1, backgroundColor: "#111" }}>
          {/* Title row */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 12 }}>
            <CircleBtn onPress={exit} size={36} bg="rgba(255,255,255,0.1)">
              <IconBack size={18} />
            </CircleBtn>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}
                numberOfLines={1}
              >
                {manifest.title || offline?.item.name || "Plexy"}
              </Text>
              {!!manifest.subtitle && (
                <Text
                  style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {manifest.subtitle}
                </Text>
              )}
            </View>
          </View>

          {/* Inline progress bar */}
          <Pressable
            disabled={casting}
            ref={timeline}
            accessibilityLabel="Playback position"
            accessibilityRole="adjustable"
            accessibilityValue={{ min: 0, max: duration, now: position, text: timeLabel(position) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) =>
              seek(position + (e.nativeEvent.actionName === "increment" ? 10 : -10))
            }
            onLayout={(e) => { timelineWidth.current = e.nativeEvent.layout.width; }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(e) => {
              reveal();
              setScrub(Math.max(0, Math.min(duration, (e.nativeEvent.locationX / timelineWidth.current) * duration)));
            }}
            onResponderMove={(e) => {
              setScrub(Math.max(0, Math.min(duration, (e.nativeEvent.locationX / timelineWidth.current) * duration)));
            }}
            onResponderRelease={(e) => {
              seek(Math.max(0, Math.min(duration, (e.nativeEvent.locationX / timelineWidth.current) * duration)));
            }}
            style={{ paddingHorizontal: 16, paddingVertical: 10 }}
          >
            {/* Track */}
            <View style={{ height: scrub != null ? 5 : 3, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.2)", overflow: "visible" }}>
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
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16 }}>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{timeLabel(previewTime)}</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{timeLabel(duration)}</Text>
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
            <CircleBtn onPress={() => seek(position - 10)} disabled={casting}>
              <IconRewind size={20} />
            </CircleBtn>
            <CircleBtn
              onPress={togglePlay}
              size={48}
              bg="rgba(0,0,0,0.5)"
              disabled={casting}
            >
              {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </CircleBtn>
            <CircleBtn onPress={() => seek(position + 10)} disabled={casting}>
              <IconForward size={20} />
            </CircleBtn>
            <View style={{ flex: 1 }} />
            {!platform.tv && (
              <CircleBtn onPress={() => setFullscreen(true)}>
                <IconFullscreen size={20} />
              </CircleBtn>
            )}
          </View>

          {/* Error / message strip */}
          {(!!error || (!offline && choice.path === "unsupported")) && (
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
      {show && layoutFull && (
        <FocusGroup style={StyleSheet.absoluteFill}>
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
              paddingLeft: platform.tv ? 26 : Math.max(insets.left + 10, 16),
              paddingRight: platform.tv ? 26 : Math.max(insets.right + 10, 16),
              paddingTop: Math.max(insets.top + 6, platform.tv ? 26 : 14),
              paddingBottom: 10,
            }}
          >
            {/* Back button */}
            <CircleBtn onPress={exit} size={44} bg="rgba(0,0,0,0.45)">
              <IconBack size={22} />
            </CircleBtn>

            {/* Top-Right cluster: Quality, Audio, Subtitles, Next, Cast, PiP, Settings */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {hasQualities && (
                <Pressable
                  onPress={() => setMenu("quality")}
                  disabled={casting}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={(state) => {
                    const pressed = state.pressed;
                    const focused = Boolean((state as any).focused);
                    const isCustom = Boolean(choice.uri || choice.maxHeight);
                    const isWhite = isCustom || (menu === "quality");
                    return {
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 20,
                      borderWidth: 1.2,
                      borderColor: isWhite ? "#ffffff" : "rgba(255,255,255,0.4)",
                      backgroundColor: isWhite ? "#ffffff" : focused ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.45)",
                      justifyContent: "center",
                      alignItems: "center",
                      opacity: casting ? 0.35 : pressed ? 0.75 : 1,
                    };
                  }}
                >
                  {() => {
                    const isCustom = Boolean(choice.uri || choice.maxHeight);
                    const isWhite = isCustom || (menu === "quality");
                    return (
                      <Text
                        style={{
                          color: isWhite ? "#000000" : "#ffffff",
                          fontSize: 12,
                          fontFamily: fonts.bold,
                        }}
                      >
                        {choice.maxHeight ? `${choice.maxHeight}p` : "HD"}
                      </Text>
                    );
                  }}
                </Pressable>
              )}

              <CircleBtn
                onPress={() => setMenu("audio")}
                disabled={casting}
                size={44}
                active={menu === "audio"}
                bg="rgba(0,0,0,0.45)"
              >
                <IconAudio size={22} color={menu === "audio" ? "#000000" : "#ffffff"} />
              </CircleBtn>

              <CircleBtn
                onPress={() => setMenu("captions")}
                disabled={casting}
                size={44}
                active={Boolean(subtitle)}
                bg="rgba(0,0,0,0.45)"
              >
                <IconSubtitles size={22} color={subtitle ? "#000000" : "#ffffff"} active={!!subtitle} />
              </CircleBtn>

              {!offline && !!manifest.nextFileId && (
                <CircleBtn
                  onPress={() => next(manifest.nextFileId!)}
                  size={44}
                  bg="rgba(0,0,0,0.45)"
                >
                  <IconNext size={22} />
                </CircleBtn>
              )}

              {CastControl && !offline && (
                <CastControl
                  media={{
                    url:
                      choice.uri ||
                      api.stream(manifest.fileId, choice.path, 0, choice.audio),
                    contentType:
                      choice.path === "hls"
                        ? "application/x-mpegURL"
                        : "video/mp4",
                    title: manifest.title || "Plexy",
                    position,
                    duration,
                    fileId: manifest.fileId,
                    itemId: manifest.itemId,
                    path: choice.path,
                  }}
                  server={{ url: api.base, token: session.token }}
                  onCasting={(value) => {
                    setCasting(value);
                    if (value) {
                      player.pause();
                      save();
                    } else if (initialized.current) {
                      player.currentTime = Math.max(
                        0,
                        currentPosition.current - offset.current,
                      );
                    }
                  }}
                  onPosition={(value) => {
                    currentPosition.current = value;
                    setPosition(value);
                    if (Date.now() - lastSaved.current > 10000) {
                      lastSaved.current = Date.now();
                      save();
                    }
                  }}
                />
              )}

              {!platform.tv && isPictureInPictureSupported() && (
                <CircleBtn
                  onPress={() => {
                    pip.current = true;
                    void video.current?.startPictureInPicture().catch(() => {
                      pip.current = false;
                      setMessage("Picture in picture is unavailable on this device.");
                    });
                  }}
                  size={44}
                  bg="rgba(0,0,0,0.45)"
                >
                  <IconPip size={22} />
                </CircleBtn>
              )}

              <CircleBtn
                onPress={() => setMenu("settings")}
                size={44}
                active={menu === "settings"}
                bg="rgba(0,0,0,0.45)"
              >
                <IconSettings size={22} color={menu === "settings" ? "#000000" : "#ffffff"} />
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
              gap: platform.tv ? 40 : 28,
            }}
            pointerEvents="box-none"
          >
            {/* Previous episode (if any) */}
            {!!(manifest as any).previousFileId && (
              <CircleBtn
                onPress={() => next((manifest as any).previousFileId)}
                size={platform.tv ? 54 : 48}
                bg="rgba(0,0,0,0.4)"
              >
                <IconBack size={20} />
              </CircleBtn>
            )}

            {/* Rewind 10s */}
            <CircleBtn
              onPress={() => seek(position - 10)}
              size={platform.tv ? 62 : 54}
              bg="rgba(0,0,0,0.45)"
              disabled={casting}
            >
              <IconRewind size={platform.tv ? 32 : 28} />
            </CircleBtn>

            {/* Big Center Play/Pause button: white background with black icon */}
            <CircleBtn
              onPress={togglePlay}
              size={platform.tv ? 82 : 72}
              active={true}
              activeBg="#ffffff"
              disabled={casting}
            >
              {playing ? (
                <IconPause size={platform.tv ? 34 : 30} color="#000000" />
              ) : (
                <IconPlay size={platform.tv ? 36 : 32} color="#000000" />
              )}
            </CircleBtn>

            {/* Forward 10s */}
            <CircleBtn
              onPress={() => seek(position + 10)}
              size={platform.tv ? 62 : 54}
              bg="rgba(0,0,0,0.45)"
              disabled={casting}
            >
              <IconForward size={platform.tv ? 32 : 28} />
            </CircleBtn>
          </View>

          {/* ── BOTTOM SECTION ── */}
          <View
            style={{
              paddingLeft: platform.tv ? 26 : Math.max(insets.left + 10, 16),
              paddingRight: platform.tv ? 26 : Math.max(insets.right + 10, 16),
              paddingBottom: Math.max(insets.bottom + 4, platform.tv ? 26 : 16),
              gap: 6,
            }}
          >
            {/* Error / messages */}
            {(!!error || (!offline && choice.path === "unsupported")) && (
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
                <Text style={{ flex: 1, color: "rgba(255,255,255,0.8)", fontSize: 13 }}>{message}</Text>
                <CircleBtn onPress={() => setMessage("")} size={32} bg="rgba(255,255,255,0.15)">
                  <IconClose size={14} />
                </CircleBtn>
              </View>
            )}

            {/* Ended card */}
            {ended && (
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignSelf: "center",
                  marginBottom: 8,
                }}
              >
                <TouchableOpacity
                  onPress={() => seek(0)}
                  activeOpacity={0.8}
                  style={styles.endBtn}
                >
                  <Text style={styles.endBtnText}>Play again</Text>
                </TouchableOpacity>
                {!offline && manifest.nextFileId && (
                  <TouchableOpacity
                    onPress={() => next(manifest.nextFileId!)}
                    activeOpacity={0.8}
                    style={[styles.endBtn, styles.endBtnPrimary]}
                  >
                    <Text style={[styles.endBtnText, { color: "#000", fontWeight: "700" }]}>
                      {preferences.autoNext && !autoNextCancelled
                        ? `Next  · ${countdown}s`
                        : "Next episode"}
                    </Text>
                  </TouchableOpacity>
                )}
                {preferences.autoNext && !autoNextCancelled && manifest.nextFileId && (
                  <TouchableOpacity
                    onPress={() => setAutoNextCancelled(true)}
                    activeOpacity={0.8}
                    style={styles.endBtn}
                  >
                    <Text style={styles.endBtnText}>Cancel</Text>
                  </TouchableOpacity>
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
                {preview && (
                  <View
                    style={{
                      width: 120,
                      height: 68,
                      overflow: "hidden",
                      backgroundColor: "#000",
                      borderRadius: 8,
                      borderWidth: 1.5,
                      borderColor: "rgba(255,255,255,0.4)",
                    }}
                  >
                    <Image
                      source={api.image(preview.uri)}
                      style={{
                        position: "absolute",
                        left: -preview.x,
                        top: -preview.y,
                        width: preview.width * 10,
                        height: preview.height * 10,
                      }}
                      resizeMode="stretch"
                    />
                  </View>
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
                  <Text style={{ color: "#fff", fontSize: 11, fontFamily: fonts.bold }}>
                    {timeLabel(previewTime)}
                  </Text>
                </View>
              </View>
            )}

            {/* Title & Time row above timeline (like in reference screenshots) */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginBottom: 2,
                paddingHorizontal: 2,
              }}
            >
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: platform.tv ? 20 : 15,
                    fontFamily: fonts.bold,
                    letterSpacing: -0.2,
                  }}
                  numberOfLines={1}
                >
                  {(() => {
                    const raw = manifest.subtitle || "";
                    const cleaned = raw
                      .replace(/^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i, "")
                      .trim();
                    const isEp = manifest.episodeNumber != null || Boolean(raw);
                    return isEp
                      ? (cleaned || manifest.title || offline?.item.name || "")
                      : (manifest.title || offline?.item.name || "");
                  })()}
                </Text>
                {(() => {
                  const raw = manifest.subtitle || "";
                  const isEp = manifest.episodeNumber != null || Boolean(raw);
                  const bottomLabel = isEp
                    ? (manifest.episodeNumber != null
                        ? `Episode ${manifest.episodeNumber}`
                        : raw)
                    : "";
                  return bottomLabel ? (
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.6)",
                        fontSize: platform.tv ? 13 : 11,
                        fontFamily: fonts.regular,
                        marginTop: 2,
                      }}
                      numberOfLines={1}
                    >
                      {bottomLabel}
                    </Text>
                  ) : null;
                })()}
              </View>

              <Text
                style={{
                  color: "rgba(255,255,255,0.75)",
                  fontSize: platform.tv ? 14 : 11,
                  fontFamily: fonts.medium,
                }}
              >
                {timeLabel(previewTime)} / {timeLabel(duration)}
              </Text>
            </View>

            {/* Progress bar */}
            <View
              ref={timeline}
              collapsable={false}
              {...(platform.tv
                ? {
                    focusable: true,
                    nextFocusLeft: timelineHandle,
                    nextFocusRight: timelineHandle,
                  }
                : {})}
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
                if (platform.tv)
                  setTimelineHandle(
                    findNodeHandle(timeline.current) || undefined,
                  );
              }}
              onBlur={() => {
                setTimelineFocus(false);
                if (scrub != null) seek(scrub);
              }}
              onLayout={(e) => {
                timelineWidth.current = Math.max(1, e.nativeEvent.layout.width);
              }}
              onStartShouldSetResponder={() => !platform.tv && !casting}
              onMoveShouldSetResponder={() => !platform.tv && !casting}
              onResponderTerminationRequest={() => false}
              onResponderGrant={(e) => {
                if (!platform.tv && !casting) {
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
                if (!platform.tv && !casting) {
                  const x = Math.max(
                    0,
                    Math.min(timelineWidth.current, e.nativeEvent.locationX),
                  );
                  const target = (x / timelineWidth.current) * duration;
                  setScrub(target);
                }
              }}
              onResponderRelease={(e) => {
                if (!platform.tv && !casting) {
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

            {casting && (
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 }}>
                Playing on your TV. Use the TV playback controls above.
              </Text>
            )}
            {diagnostics && (
              <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                {offline ? "Offline file" : choice.path} ·{" "}
                {timeLabel(player.bufferedPosition)} buffered ·{" "}
                {player.videoTrack?.size.height || "—"}p · audio{" "}
                {choice.audio + 1} · {status}
              </Text>
            )}
          </View>

          {/* Skip segment pill (bottom-right) */}
          {activeSkip && (
            <View
              style={{
                position: "absolute",
                right: 20,
                bottom: Math.max(insets.bottom, 16) + 150,
              }}
            >
              <TouchableOpacity
                onPress={() => seek(activeSkip[1]!.end)}
                activeOpacity={0.85}
                style={styles.skipPill}
              >
                <Text style={styles.skipPillText}>
                  Skip {activeSkip[0]}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </FocusGroup>
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
            <TouchableOpacity
              onPress={() => {
                setChoice((old) => ({ ...old, start: initialResume }));
                setResume(false);
                setStarted(true);
              }}
              activeOpacity={0.85}
              style={{
                width: "100%",
                paddingVertical: 14,
                backgroundColor: colors.brand,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 15 }}>
                Resume ({timeLabel(initialResume)})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setResume(false);
                setStarted(true);
              }}
              activeOpacity={0.85}
              style={{
                width: "100%",
                paddingVertical: 14,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: fonts.medium, fontSize: 14 }}>
                Start from beginning
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Bottom-sheet menus ── */}
      <Modal
        visible={menu != null}
        transparent
        animationType="slide"
        onRequestClose={() => setMenu(null)}
        supportedOrientations={["portrait", "landscape"]}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <FocusGroup style={styles.sheetContainer}>
            {/* Drag handle */}
            <View style={styles.sheetHandle} />

            {/* Title row */}
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>
                {menu === "captions"
                  ? "Subtitles"
                  : menu === "audio"
                    ? "Audio tracks"
                    : menu === "quality"
                      ? "Video quality"
                      : "Player settings"}
              </Text>
              <TouchableOpacity
                onPress={() => { setMenu(null); reveal(); }}
                activeOpacity={0.7}
                style={styles.sheetCloseBtn}
              >
                <IconClose size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) }}
              showsVerticalScrollIndicator={false}
            >
              {/* Settings menu */}
              {menu === "settings" && (
                <>
                  <SheetItem
                    label="Video quality"
                    onPress={() => setMenu("quality")}
                  />

                  <View style={styles.sheetSectionLabel}>
                    <Text style={styles.sheetSectionLabelText}>Playback speed</Text>
                  </View>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <SheetItem
                      key={rate}
                      label={`${rate}×`}
                      selected={preferences.playbackRate === rate}
                      onPress={() => {
                        player.playbackRate = rate;
                        updatePreferences({ playbackRate: rate });
                      }}
                    />
                  ))}

                  <View style={styles.sheetSectionLabel}>
                    <Text style={styles.sheetSectionLabelText}>
                      Volume — {Math.round(volume * 100)}%
                    </Text>
                  </View>
                  <SheetItem
                    label="Quieter"
                    onPress={() => {
                      const value = Math.max(0, volume - 0.1);
                      player.volume = value;
                      setVolume(value);
                    }}
                  />
                  <SheetItem
                    label="Louder"
                    onPress={() => {
                      const value = Math.min(1, volume + 0.1);
                      player.volume = value;
                      setVolume(value);
                    }}
                  />
                  <SheetItem
                    label={`${diagnostics ? "Hide" : "Show"} playback diagnostics`}
                    onPress={() => setDiagnostics((v) => !v)}
                  />
                  {!platform.tv && isPictureInPictureSupported() && (
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
                  {!offline && (
                    <SheetItem
                      label="Retry with server conversion"
                      onPress={() => {
                        setMenu(null);
                        setChoice((old) => ({
                          path: "transcode",
                          audio: old.audio,
                          start: currentPosition.current,
                          maxHeight: 1080,
                          revision: old.revision + 1,
                        }));
                      }}
                    />
                  )}
                </>
              )}

              {/* Audio tracks */}
              {menu === "audio" &&
                (offline ? (
                  nativeAudio.length ? (
                    nativeAudio.map((track) => (
                      <SheetItem
                        key={track.id}
                        label={track.label || track.language || track.id || "Audio track"}
                        selected={player.audioTrack?.id === track.id}
                        onPress={() => {
                          player.audioTrack = track;
                          setMenu(null);
                        }}
                      />
                    ))
                  ) : (
                    <Text style={styles.sheetEmpty}>
                      No alternate audio tracks are available in this download.
                    </Text>
                  )
                ) : (
                  manifest.audioTracks?.map((track) => (
                    <SheetItem
                      key={track.index}
                      label={`${track.language || "Unknown language"} · ${track.codec.toUpperCase()} · ${track.channels} channels`}
                      selected={choice.audio === track.index}
                      onPress={() => void switchAudio(track.index)}
                    />
                  ))
                ))}

              {/* Subtitles */}
              {menu === "captions" && (
                <>
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

                  <View style={styles.sheetSectionLabel}>
                    <Text style={styles.sheetSectionLabelText}>
                      Timing offset: {preferences.subtitleOffset.toFixed(1)}s
                    </Text>
                  </View>
                  <SheetItem
                    label="Earlier −0.5s"
                    onPress={() =>
                      updatePreferences({
                        subtitleOffset: preferences.subtitleOffset - 0.5,
                      })
                    }
                  />
                  <SheetItem
                    label="Later +0.5s"
                    onPress={() =>
                      updatePreferences({
                        subtitleOffset: preferences.subtitleOffset + 0.5,
                      })
                    }
                  />
                  <SheetItem
                    label="Reset timing"
                    onPress={() => updatePreferences({ subtitleOffset: 0 })}
                  />
                  <SheetItem
                    label={`Position: ${preferences.subtitlePosition}`}
                    onPress={() =>
                      updatePreferences({
                        subtitlePosition:
                          preferences.subtitlePosition === "bottom"
                            ? "top"
                            : "bottom",
                      })
                    }
                  />

                  <View style={styles.sheetSectionLabel}>
                    <Text style={styles.sheetSectionLabelText}>Subtitle size</Text>
                  </View>
                  {[18, 22, 28, 34].map((size) => (
                    <SheetItem
                      key={size}
                      label={`${size}px`}
                      selected={preferences.subtitleSize === size}
                      onPress={() => updatePreferences({ subtitleSize: size })}
                    />
                  ))}
                </>
              )}

              {/* Quality */}
              {menu === "quality" &&
                (offline ? (
                  <Text style={styles.sheetEmpty}>
                    This is the saved {offline.label} file. Choose another
                    download for a different quality.
                  </Text>
                ) : (
                  <>
                    {manifest.path === "hls" && (
                      <SheetItem
                        label="Auto (adaptive)"
                        selected={choice.path === "hls" && !choice.uri}
                        onPress={() => {
                          setChoice((old) => ({
                            path: "hls",
                            audio: old.audio,
                            start: currentPosition.current,
                            revision: old.revision + 1,
                          }));
                          setMenu(null);
                        }}
                      />
                    )}
                    {variants.map((variant) => (
                      <SheetItem
                        key={variant.uri}
                        label={variant.label}
                        selected={choice.uri === variant.uri}
                        onPress={() => {
                          const uri = api.url(variant.uri);
                          setChoice((old) => ({
                            ...old,
                            path: "hls",
                            uri,
                            start: currentPosition.current,
                            revision: old.revision + 1,
                          }));
                          setMenu(null);
                        }}
                      />
                    ))}
                    {manifest.versions?.map((version) => (
                      <SheetItem
                        key={version.fileId}
                        label={`Source: ${version.label}`}
                        selected={
                          manifest.fileId === version.fileId && !choice.maxHeight
                        }
                        onPress={() => {
                          setMenu(null);
                          save();
                          next(version.fileId);
                        }}
                      />
                    ))}

                    <View style={styles.sheetSectionLabel}>
                      <Text style={styles.sheetSectionLabelText}>
                        Server conversion cap
                      </Text>
                    </View>
                    {[360, 480, 720, 1080, 1440, 2160].map((height) => (
                      <SheetItem
                        key={height}
                        label={`${height}p`}
                        selected={choice.maxHeight === height}
                        onPress={() => {
                          setChoice((old) => ({
                            path: "transcode",
                            audio: old.audio,
                            start: currentPosition.current,
                            maxHeight: height,
                            revision: old.revision + 1,
                          }));
                          setMenu(null);
                        }}
                      />
                    ))}
                  </>
                ))}
            </ScrollView>
          </FocusGroup>
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
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.sheetItem}
    >
      <Text
        style={[
          styles.sheetItemText,
          selected && styles.sheetItemTextSelected,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected && <IconCheck size={20} color="#ffffff" />}
    </TouchableOpacity>
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

  // Resume card
  resumeCard: {
    backgroundColor: "#121212",
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 400,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  resumeTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 2,
  },
  resumeBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    marginBottom: 4,
  },
  resumeBtn: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
  },
  resumeBtnPrimary: {
    backgroundColor: "#ffffff",
  },
  resumeBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    fontWeight: "600",
  },

  // Bottom sheet
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheetContainer: {
    backgroundColor: "#14161f",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
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
  sheetSectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sheetSectionLabelText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sheetEmpty: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
});
