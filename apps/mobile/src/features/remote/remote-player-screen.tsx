import { useEffect, useMemo, useState } from "react";
import {
  AppState,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { ArrowLeft } from "@/shared/ui/icons";
import { PlayerControl } from "@/features/player/components/player-control";
import { PlayerLoading } from "@/features/player/components/player-loading";
import { usePlayerOrientation } from "@/features/player/hooks/use-player-orientation";
import { useRemoteNavigation } from "./lib/use-remote-navigation";
import { vidyEmbedHtml, vidyEmbedUrl } from "./lib/vidy";
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
  const { preferences } = useClient();
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");
  const url = vidyEmbedUrl(input, preferences.autoNext);
  const source = useMemo(
    () => ({ html: vidyEmbedHtml(url), baseUrl: "https://www.vidy.st" }),
    [url],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {error ? (
        <View style={styles.error}>
          <Notice
            kind="error"
            message={error}
            retry={() => {
              setError(null);
              setRevision((value) => value + 1);
            }}
          />
          <Button label="Back" onPress={navigation.back} />
        </View>
      ) : (
        <>
          <WebView
            key={`${url}:${revision}`}
            source={source}
            style={styles.webview}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows
            androidLayerType="hardware"
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
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
            renderLoading={() => <PlayerLoading />}
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

          {!active && <View style={styles.paused} pointerEvents="auto" />}

          <View
            pointerEvents="box-none"
            style={[
              styles.chrome,
              {
                top: Math.max(insets.top, 10) + 8,
                left: Math.max(insets.left, 10) + 8,
                right: Math.max(insets.right, 10) + 8,
              },
            ]}
          >
            <PlayerControl
              accessibilityLabel="Close player"
              onPress={navigation.back}
              size={48}
              bg="rgba(0,0,0,0.4)"
            >
              <ArrowLeft size={20} color="#ffffff" strokeWidth={2.2} />
            </PlayerControl>
            <View style={styles.titleWrap} pointerEvents="none">
              <Text numberOfLines={1} style={styles.title}>
                {input.display}
              </Text>
            </View>
            <View style={styles.controlSpacer} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  webview: { flex: 1, backgroundColor: "#000" },
  paused: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#000",
  },
  chrome: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  titleWrap: { flex: 1, alignItems: "center" },
  title: {
    maxWidth: "78%",
    color: "rgba(255,255,255,0.95)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  controlSpacer: { width: 48, height: 48 },
  error: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
});
