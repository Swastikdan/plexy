import { AdminPanel } from "./admin/Panel";
import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useClient } from "./context";
import { useResource } from "./hooks";
import { Button, Field, Heading, Label, Notice } from "./ui";
import { colors, fonts } from "./theme";
import { sessionStore } from "./storage";
import type { AuthResult, Session } from "./api";

function SettingsCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.cardHeader}>
        <Text style={settingsStyles.cardTitle}>{title}</Text>
        {subtitle && (
          <Text style={settingsStyles.cardSubtitle}>{subtitle}</Text>
        )}
      </View>
      <View style={settingsStyles.cardBody}>{children}</View>
    </View>
  );
}

export function SettingsScreen({
  connect,
  signout,
  sessionChanged,
}: {
  connect: () => void;
  signout: (removeDownloads: boolean) => Promise<void>;
  sessionChanged: (session: Session) => void;
}) {
  const { session, api, preferences, updatePreferences, platform } =
    useClient();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const certificate = useResource(
    () => api.request<{ fingerprint: string | null }>("/api/auth/certificate"),
    [api],
  );
  const [error, setError] = useState("");
  const status = useResource(() => api.status(), [api]);
  const devices = useResource(
    () =>
      api.request<{
        devices: Array<{ id: number; name: string; revoked: boolean }>;
      }>("/api/auth/devices"),
    [api],
  );

  return (
    <ScrollView
      contentContainerStyle={{
        padding: platform.tv ? 32 : 16,
        paddingBottom: 48,
        gap: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Heading large>Settings</Heading>

      {/* ── 1. Account & Server Card ── */}
      <SettingsCard
        title="Account & Server"
        subtitle="Current profile and connected server"
      >
        <View style={settingsStyles.serverRow}>
          <View style={settingsStyles.serverAvatar}>
            <Text style={settingsStyles.serverAvatarText}>
              {(session.profile.username || session.profile.name || "U").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={settingsStyles.serverInfo}>
            <Text style={settingsStyles.serverName}>
              {session.profile.username || "Account"}
            </Text>
            <Text style={settingsStyles.serverUrl} numberOfLines={1}>
              {session.profile.name || session.profile.url} · {session.profile.url}
            </Text>
            <View style={settingsStyles.serverBadge}>
              <Text style={settingsStyles.serverBadgeText}>
                v{status.value?.version || "1.0.0"} · Plexy Native Client
              </Text>
            </View>
          </View>
        </View>

        {status.error && (
          <Notice message={status.error} retry={status.retry} />
        )}

        <View style={{ gap: 8, marginTop: 4 }}>
          <Button label="Sign In / Switch Account or Server" onPress={connect} />
        </View>

        {certificate.value?.fingerprint && (
          <View style={{ marginTop: 4, gap: 4 }}>
            <Label muted>Server certificate fingerprint</Label>
            <Text
              selectable
              style={{
                fontSize: 11,
                fontFamily: fonts.regular,
                color: colors.muted,
                backgroundColor: "rgba(255,255,255,0.05)",
                padding: 8,
                borderRadius: 6,
              }}
            >
              {certificate.value.fingerprint}
            </Text>
          </View>
        )}
      </SettingsCard>

      {status.value?.adminAvailable && (
        <SettingsCard title="Administrator">
          <AdminPanel />
        </SettingsCard>
      )}

      {/* ── 2. Playback Preferences Card ── */}
      <SettingsCard
        title="Playback"
        subtitle="Subtitles, skipping and audio behavior"
      >
        <Button
          label={`Automatic subtitles: ${preferences.autoSubtitles ? "On" : "Off"}`}
          selected={preferences.autoSubtitles}
          onPress={() =>
            updatePreferences({ autoSubtitles: !preferences.autoSubtitles })
          }
        />
        <Field
          label="Preferred subtitle language"
          value={preferences.subtitleLanguage}
          onChangeText={(subtitleLanguage) =>
            updatePreferences({ subtitleLanguage })
          }
          autoCapitalize="none"
          placeholder="e.g. en, fr, de"
        />
        <Button
          label={`Auto-skip intros and recaps: ${preferences.autoSkip ? "On" : "Off"}`}
          selected={preferences.autoSkip}
          onPress={() =>
            updatePreferences({ autoSkip: !preferences.autoSkip })
          }
        />
        <Button
          label={`Play next episode automatically: ${preferences.autoNext ? "On" : "Off"}`}
          selected={preferences.autoNext}
          onPress={() =>
            updatePreferences({ autoNext: !preferences.autoNext })
          }
        />
      </SettingsCard>

      {/* ── 3. Downloads Preferences Card ── */}
      <SettingsCard
        title="Downloads"
        subtitle="Offline sync, network and storage caps"
      >
        <Button
          label={`Wi-Fi / Ethernet only: ${preferences.wifiOnly ? "On" : "Off"}`}
          selected={preferences.wifiOnly}
          onPress={() =>
            updatePreferences({ wifiOnly: !preferences.wifiOnly })
          }
        />
        <Label muted>Storage limit</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[5, 10, 20, 50, 0].map((cap) => (
            <Button
              key={cap}
              label={cap ? `${cap} GB` : "No limit"}
              selected={preferences.downloadCapGb === cap}
              onPress={() => updatePreferences({ downloadCapGb: cap })}
            />
          ))}
        </View>
        <Label muted>Preferred download resolution</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[0, 480, 720, 1080, 2160].map((height) => (
            <Button
              key={height}
              label={height ? `${height}p` : "Best available"}
              selected={preferences.defaultDownloadHeight === height}
              onPress={() =>
                updatePreferences({ defaultDownloadHeight: height })
              }
            />
          ))}
        </View>
      </SettingsCard>

      {/* ── 4. Security & Devices Card ── */}
      <SettingsCard
        title="Security & Devices"
        subtitle="Pairing keys, passwords and active devices"
      >
        <Heading>Pair another device</Heading>
        <Field
          label="Confirm password to create pairing key"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />
        <Button
          label="Create pairing key"
          disabled={busy || !password}
          onPress={() => {
            setBusy(true);
            setError("");
            void api
              .request<{ code: string; expiresAt: string }>(
                "/api/auth/pairing-code",
                { method: "POST", body: JSON.stringify({ password }) },
              )
              .then((value) => {
                setPairing(value);
                setPassword("");
              })
              .catch((e) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not create a pairing key.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        />
        {pairing && (
          <View
            style={{
              gap: 8,
              padding: 14,
              backgroundColor: "rgba(59,125,249,0.1)",
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#3B7DF9",
            }}
          >
            <Text
              selectable
              style={{
                fontSize: 22,
                fontFamily: fonts.bold,
                color: "#fff",
                letterSpacing: 2,
              }}
            >
              {pairing.code}
            </Text>
            <Label muted>
              Expires{" "}
              {new Date(
                pairing.expiresAt.replace(" ", "T") +
                  (pairing.expiresAt.endsWith("Z") ? "" : "Z"),
              ).toLocaleTimeString()}
              . Use this key once on another device.
            </Label>
          </View>
        )}

        <Heading>Change password</Heading>
        <Field
          label="New password (12+ characters)"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          editable={!busy}
        />
        <Button
          label="Change password"
          disabled={busy || !password || newPassword.length < 12}
          onPress={() => {
            setBusy(true);
            setError("");
            void api
              .request<AuthResult>("/api/auth/password", {
                method: "POST",
                body: JSON.stringify({ password, newPassword }),
              })
              .then(async (auth) => {
                const updated = { ...session, token: auth.token };
                await sessionStore.save(updated);
                setPassword("");
                setNewPassword("");
                setPairing(null);
                sessionChanged(updated);
              })
              .catch((e) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not change your password.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        />

        <Heading>Signed-in devices</Heading>
        {devices.loading && <Label muted>Loading devices…</Label>}
        {devices.error && <Notice message={devices.error} retry={devices.retry} />}
        {!devices.loading && (!devices.value?.devices || devices.value.devices.length === 0) && (
          <Label muted>No other active devices registered to this account.</Label>
        )}
        {devices.value?.devices && devices.value.devices.length > 0 && (
          <>
            {devices.value.devices.map((device) => (
              <View
                key={device.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Label>
                  {device.name}
                  {device.revoked ? " · Revoked" : ""}
                </Label>
                <Button
                  compact
                  label={device.revoked ? "Delete" : "Revoke"}
                  onPress={() =>
                    Alert.alert(
                      device.revoked ? "Delete device record?" : "Revoke device?",
                      device.name,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Confirm",
                          style: "destructive",
                          onPress: () => {
                            void api
                              .request(
                                `/api/auth/devices/${device.id}${device.revoked ? "" : "/revoke"}`,
                                { method: device.revoked ? "DELETE" : "POST" },
                              )
                              .then(devices.retry)
                              .catch(() =>
                                setError("Could not update this device."),
                              );
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            ))}
          </>
        )}
      </SettingsCard>

      {/* ── 5. Device Data & Session Card ── */}
      <SettingsCard title="Cache & Session" subtitle="Manage storage, profiles or sign out">
        <Button
          label="Clear catalog cache"
          onPress={() => {
            void AsyncStorage.getAllKeys()
              .then((keys) =>
                AsyncStorage.multiRemove(
                  keys.filter((k) =>
                    k.startsWith(`plexy.catalog.${session.profile.id}.`),
                  ),
                ),
              )
              .then(() => setError("Catalog cache cleared."))
              .catch(() => setError("Could not clear the catalog cache."));
          }}
        />
        <Button
          label="Delete account profile from this device"
          onPress={() =>
            Alert.alert(
              "Delete profile?",
              `Remove ${session.profile.username || session.profile.name} from saved profiles on this device?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    void sessionStore.remove(session.profile.id).then(connect);
                  },
                },
              ],
            )
          }
        />
        <Button
          label="Sign out"
          onPress={() =>
            Alert.alert(
              "Sign out?",
              "Choose whether to keep downloaded media on this device. Reconnect to the same account to access kept downloads.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Keep downloads",
                  onPress: () => {
                    void signout(false).catch(() =>
                      setError("Could not sign out. Try again."),
                    );
                  },
                },
                {
                  text: "Remove downloads",
                  style: "destructive",
                  onPress: () => {
                    void signout(true).catch(() =>
                      setError(
                        "Could not remove downloads or sign out. Try again.",
                      ),
                    );
                  },
                },
              ],
            )
          }
        />
      </SettingsCard>

      {!!error && <Notice message={error} />}
    </ScrollView>
  );
}

const settingsStyles = StyleSheet.create({
  card: {
    backgroundColor: "#121212",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    paddingBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
  },
  cardBody: {
    gap: 12,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  serverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#3B7DF9",
    alignItems: "center",
    justifyContent: "center",
  },
  serverAvatarText: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: "#fff",
  },
  serverInfo: {
    flex: 1,
    gap: 2,
  },
  serverName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  serverUrl: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
  },
  serverBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  serverBadgeText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.muted,
  },
});
