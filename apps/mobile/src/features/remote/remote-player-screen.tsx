import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, StatusBar, View } from "react-native";
import { WebView } from "react-native-webview";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { ArrowLeft } from "@/shared/ui/icons";
import { PlayerControl } from "@/features/player/components/player-control";
import { PlayerLoading } from "@/features/player/components/player-loading";
import { lockPlayerLandscape, usePlayerOrientation } from "@/features/player/hooks/use-player-orientation";
import { useRemoteNavigation } from "./lib/use-remote-navigation";
import {
  flushRemoteProgress,
  getRemoteProgress,
  getRemoteTitleProgress,
  recordRemotePlayback,
} from "./lib/remote-progress";
import {
  parseVidyBridgeMessage,
  vidyColor,
  vidyEmbedHtml,
  vidyEmbedUrl,
} from "./lib/vidy";
import type { RemoteMediaType } from "./lib/tmdb";

export interface RemotePlayerInput {
  mediaType: RemoteMediaType;
  tmdbId: number;
  season: number | null;
  episode: number | null;
  title: string;
  display: string;
}

export function RemotePlayerScreen({ input }: { input: RemotePlayerInput }) {
  useKeepAwake();
  usePlayerOrientation(() => {});
  const navigation = useRemoteNavigation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { preferences } = useClient();
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");
  const lastRecorded = useRef(0);
  const lastPosition = useRef<{
    currentTime: number;
    duration: number;
    season: number | null;
    episode: number | null;
  } | null>(null);

  // Read the resume point once. A live progress tick must never rebuild the
  // iframe URL (that would reload the player).
  const [initialResume] = useState(() => {
    const episodeProgress = getRemoteProgress(
      input.mediaType,
      input.tmdbId,
      input.season,
      input.episode,
    );
    const titleProgress = getRemoteTitleProgress(
      input.mediaType,
      input.tmdbId,
    );
    const sameTarget =
      input.mediaType === "movie" ||
      (titleProgress?.season === input.season &&
        titleProgress?.episode === input.episode);
    const saved =
      episodeProgress ?? (sameTarget ? titleProgress : undefined);
    return saved && !saved.played && saved.position >= 15
      ? Math.max(0, Math.floor(saved.position))
      : 0;
  });

  const url = useMemo(
    () =>
      vidyEmbedUrl(input, {
        autoplay: preferences.onlineAutoplay,
        autoNext: preferences.autoNext,
        episodeSelector: preferences.onlineEpisodeSelector,
        progress: initialResume,
        color: vidyColor(colors.brand),
      }),
    [
      colors.brand,
      initialResume,
      input,
      preferences.autoNext,
      preferences.onlineAutoplay,
      preferences.onlineEpisodeSelector,
    ],
  );
  const source = useMemo(
    () => ({ html: vidyEmbedHtml(url), baseUrl: "https://www.vidy.st" }),
    [url],
  );

  const persistLast = useCallback(() => {
    const last = lastPosition.current;
    if (!last) return;
    const duration = last.duration > 0 ? last.duration : null;
    const played =
      Boolean(duration) && last.currentTime >= (duration ?? 0) * 0.95;
    recordRemotePlayback({
      mediaType: input.mediaType,
      tmdbId: input.tmdbId,
      season: last.season,
      episode: last.episode,
      position: last.currentTime,
      duration,
      played,
      updatedAt: Date.now(),
    });
  }, [input.mediaType, input.tmdbId]);

  const close = useCallback(() => {
    persistLast();
    void flushRemoteProgress().catch(() => {});
    navigation.back();
  }, [navigation, persistLast]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state !== "active") {
        persistLast();
        void flushRemoteProgress().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [persistLast]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        close();
        return true;
      },
    );
    return () => subscription.remove();
  }, [close]);

  const recordTick = useCallback(
    (event: NonNullable<ReturnType<typeof parseVidyBridgeMessage>>) => {
      if (event.type !== "PLAYER_EVENT") return;
      if (event.mediaType !== input.mediaType || event.tmdbId !== input.tmdbId) {
        return;
      }
      const season =
        event.mediaType === "tv" ? (event.season ?? input.season) : null;
      const episode =
        event.mediaType === "tv" ? (event.episode ?? input.episode) : null;
      lastPosition.current = {
        currentTime: event.currentTime,
        duration: event.duration,
        season,
        episode,
      };
      // Vidy ticks every second. Keep the in-app store and every subscribed
      // list calm by folding those ticks into one update every two seconds.
      const now = Date.now();
      if (event.event === "timeupdate" && now - lastRecorded.current < 2000) {
        return;
      }
      lastRecorded.current = now;
      const duration = event.duration > 0 ? event.duration : null;
      const played =
        Boolean(duration) && event.currentTime >= (duration ?? 0) * 0.95;
      recordRemotePlayback({
        mediaType: event.mediaType,
        tmdbId: event.tmdbId,
        season,
        episode,
        position: event.currentTime,
        duration,
        played,
        updatedAt: Date.now(),
      });
    },
    [input.episode, input.mediaType, input.season, input.tmdbId],
  );

  return (
    <View className="flex-1 bg-black">
      <StatusBar hidden />
      {error ? (
        <View className="flex-1 justify-center gap-4 p-6">
          <Notice
            kind="error"
            message={error}
            retry={() => {
              setError(null);
              setRevision((value) => value + 1);
            }}
          />
          <Button label="Back" onPress={close} />
        </View>
      ) : (
        <>
          <WebView
            key={`${url}:${revision}`}
            source={source}
            style={{ flex: 1, backgroundColor: "#000" }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows
            androidLayerType="hardware"
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            onMessage={(event) => {
              const parsed = parseVidyBridgeMessage(event.nativeEvent.data);
              if (!parsed) return;
              if (parsed.type === "FULLSCREEN") {
                lockPlayerLandscape();
                return;
              }
              recordTick(parsed);
            }}
            onOpenWindow={() => {
              /* Keep popup tabs outside the playback flow. */
            }}
            onShouldStartLoadWithRequest={(request) =>
              request.isTopFrame === false ||
              request.url === "about:blank" ||
              request.url.startsWith("https://www.vidy.st/") ||
              request.url.startsWith("https://vidy.st/")
            }
            startInLoadingState
            renderLoading={() => (
              <View className="absolute inset-0 bg-black">
                <PlayerLoading />
              </View>
            )}
            onError={() =>
              setError("Vidy could not load. Check your connection and retry.")
            }
            onHttpError={(event) => {
              if (event.nativeEvent.url === url)
                setError("Vidy is unavailable. Try again shortly.");
            }}
            onRenderProcessGone={() =>
              setError("The video player stopped. Tap retry to reopen it.")
            }
          />

          {!active && <View className="absolute inset-0 bg-black" pointerEvents="auto" />}

          {/* Online playback is just the provider iframe plus a back control. */}
          <View
            pointerEvents="box-none"
            className="absolute flex-row items-center"
            style={[
              {
                top: Math.max(insets.top, 10) + 8,
                left: Math.max(insets.left, 10) + 8,
                right: Math.max(insets.right, 10) + 8,
              },
            ]}
          >
            <PlayerControl
              accessibilityLabel="Close player"
              onPress={close}
              size={48}
              bg="rgba(0,0,0,0.4)"
            >
              <ArrowLeft size={20} color="#ffffff" strokeWidth={2.2} />
            </PlayerControl>
          </View>
        </>
      )}
    </View>
  );
}
