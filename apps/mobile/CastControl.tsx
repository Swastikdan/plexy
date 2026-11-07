import React, { useEffect, useRef, useState } from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import { Cast as CastIcon } from "lucide-react-native";
import GoogleCast, {
  CastButton,
  MediaPlayerState,
  useMediaStatus,
  useRemoteMediaClient,
  useStreamPosition,
} from "react-native-google-cast";
import type { CastControlProps } from "../../packages/native-client/src/cast-types";
import { Button, Label } from "../../packages/native-client/src/ui";
import { colors, timeLabel } from "../../packages/native-client/src/theme";
// Only this mobile entry imports the Cast SDK. TV builds have no sender module.
export function CastControl(props: CastControlProps) {
  if (!Constants.expoConfig?.extra?.castReceiverEnabled)
    return (
      <TouchableOpacity
        onPress={() =>
          Alert.alert(
            "Casting unavailable",
            "Casting is not enabled in this build. You can use the Plexy TV app directly.",
          )
        }
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Cast"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CastIcon size={18} color="#fff" />
      </TouchableOpacity>
    );
  return <EnabledCastControl {...props} />;
}
function EnabledCastControl({
  media,
  server,
  onCasting,
  onPosition,
}: CastControlProps) {
  const client = useRemoteMediaClient();
  const status = useMediaStatus();
  const position = useStreamPosition(1);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const callbacks = useRef({ onCasting, onPosition });
  callbacks.current = { onCasting, onPosition };
  useEffect(() => {
    if (!client) {
      setLoaded(false);
      callbacks.current.onCasting(false);
    }
  }, [client]);
  useEffect(() => {
    if (loaded && position != null) callbacks.current.onPosition(position);
  }, [loaded, position]);
  useEffect(
    () => () => {
      callbacks.current.onCasting(false);
      void GoogleCast.getSessionManager()
        .endCurrentSession(true)
        .catch(() => {});
    },
    [],
  );
  async function load() {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      if (!server.url.startsWith("https://"))
        throw new Error(
          "Casting requires an HTTPS server address trusted by your TV.",
        );
      if (!["direct", "hls"].includes(media.path))
        throw new Error(
          "Prepare this title for direct or adaptive playback on your server before casting.",
        );
      await client.loadMedia({
        autoplay: true,
        startTime: media.position,
        credentials: server.token,
        credentialsType: "plexy-bearer",
        customData: {
          server: server.url,
          itemId: media.itemId,
          fileId: media.fileId,
        },
        mediaInfo: {
          contentUrl: media.url,
          contentType: media.contentType,
          streamDuration: media.duration || undefined,
          metadata: { type: "movie", title: media.title },
        },
      });
      setLoaded(true);
      callbacks.current.onCasting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start casting.");
    } finally {
      setBusy(false);
    }
  }
  const act = (fn: () => Promise<unknown>) => {
    void fn().catch(() =>
      setError(
        "Could not control playback on the TV. Reconnect and try again.",
      ),
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <CastButton
          accessibilityLabel="Choose a casting device"
          style={{ width: 46, height: 46, tintColor: colors.ink }}
        />
        {client && !loaded && (
          <Button
            label={busy ? "Connecting…" : "Play on TV"}
            disabled={busy}
            onPress={() => void load()}
          />
        )}
        {loaded && client && (
          <>
            <Label>{timeLabel(position || 0)}</Label>
            <Button
              label={
                status?.playerState === MediaPlayerState.PLAYING
                  ? "Pause TV"
                  : "Play TV"
              }
              onPress={() =>
                act(() =>
                  status?.playerState === MediaPlayerState.PLAYING
                    ? client.pause()
                    : client.play(),
                )
              }
            />
            <Button
              label="TV −10s"
              onPress={() =>
                act(() =>
                  client.seek({ position: Math.max(0, (position || 0) - 10) }),
                )
              }
            />
            <Button
              label="TV +10s"
              onPress={() =>
                act(() => client.seek({ position: (position || 0) + 10 }))
              }
            />
            <Button
              label="Stop casting"
              onPress={() =>
                act(() =>
                  GoogleCast.getSessionManager().endCurrentSession(true),
                )
              }
            />
          </>
        )}
      </View>
      {!!error && <Label>{error}</Label>}
    </View>
  );
}
