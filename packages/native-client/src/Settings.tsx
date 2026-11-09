import { AdminPanel } from "./admin/Panel";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, CheckCircle2, Shield, User, Play, Sparkles } from "lucide-react-native";
import { useClient } from "./context";
import { useResource } from "./hooks";
import { Button, Field, Heading, Label, Notice, UserAvatar } from "./ui";
import { colors, fonts } from "./theme";
import { sessionStore } from "./storage";
import type { AuthResult, Session } from "./api";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getInstalledAppInfo,
  openUnknownAppsSettings,
  type AppInfo,
  type UpdateInfo,
} from "./updater";
import { triggerHaptic } from "./haptics";

type SettingsTab = "account" | "playback" | "updates" | "admin";

function SettingsCard({
  title,
  subtitle,
  children,
  tv,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tv?: boolean;
}) {
  return (
    <View style={[settingsStyles.card, tv && settingsStyles.cardTv]}>
      <View style={settingsStyles.cardHeader}>
        <Text style={[settingsStyles.cardTitle, tv && settingsStyles.cardTitleTv]}>{title}</Text>
        {subtitle && (
          <Text style={[settingsStyles.cardSubtitle, tv && settingsStyles.cardSubtitleTv]}>{subtitle}</Text>
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
  back,
}: {
  connect: () => void;
  signout: (removeDownloads: boolean) => Promise<void>;
  sessionChanged: (session: Session) => void;
  back?: () => void;
}) {
  const { session, api, preferences, updatePreferences, platform } =
    useClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [focusedTab, setFocusedTab] = useState<SettingsTab | null>(null);

  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // App updater state
  const [appInfo, setAppInfo] = useState<AppInfo>({
    versionName: "1.0.2",
    versionCode: 50028,
    buildNumber: 28,
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  React.useEffect(() => {
    void getInstalledAppInfo().then(setAppInfo);
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError("");
    try {
      const current = await getInstalledAppInfo();
      setAppInfo(current);
      const update = await checkForUpdate(platform.tv, current.buildNumber);
      setAvailableUpdate(update);
      setUpdateChecked(true);
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : "Failed to check for updates");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = () => {
    if (!availableUpdate) return;
    const mb = (availableUpdate.apkSize / (1024 * 1024)).toFixed(1);
    Alert.alert(
      "Update Plexy",
      `Download and install ${availableUpdate.tagName} (${mb} MB)?\n\nThe Android package installer will prompt you to confirm and install the update.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download & Install",
          onPress: async () => {
            setDownloadProgress(1);
            setUpdateError("");
            try {
              await downloadAndInstallUpdate(availableUpdate, (pct) => {
                setDownloadProgress(pct);
              });
            } catch (e) {
              setUpdateError(
                e instanceof Error
                  ? e.message
                  : "Could not install update. Please check Android unknown apps permission in Settings.",
              );
            } finally {
              setDownloadProgress(null);
            }
          },
        },
      ],
    );
  };

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

  const availableTabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "account", label: "Account & Devices" },
    { id: "playback", label: "Playback & Storage" },
    { id: "updates", label: "Updates" },
    ...(status.value?.adminAvailable ? [{ id: "admin" as const, label: "Server Admin" }] : []),
  ];

  return (
    <ScrollView
      contentContainerStyle={[
        settingsStyles.container,
        platform.tv && settingsStyles.containerTv,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {back && (
        <Pressable
          onPress={back}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 6,
            marginBottom: 2,
          }}
          hitSlop={10}
        >
          <ArrowLeft size={18} color="#fff" strokeWidth={2.4} />
          <Text style={{ color: colors.ink, fontFamily: fonts.medium, fontSize: 15 }}>
            Back to Home
          </Text>
        </Pressable>
      )}

      <Heading large>Settings</Heading>

      {/* ── Category Tabs Bar ── */}
      <View style={[settingsStyles.tabBar, platform.tv && settingsStyles.tabBarTv]}>
        {availableTabs.map((t) => {
          const isActive = activeTab === t.id;
          const isFocused = focusedTab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                triggerHaptic("selection");
                setActiveTab(t.id);
              }}
              onFocus={() => setFocusedTab(t.id)}
              onBlur={() => setFocusedTab(null)}
              style={({ pressed }) => [
                settingsStyles.tabItem,
                platform.tv && settingsStyles.tabItemTv,
                isActive && settingsStyles.tabItemActive,
                platform.tv && isFocused && !isActive && settingsStyles.tabItemFocusedTv,
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  settingsStyles.tabText,
                  platform.tv && settingsStyles.tabTextTv,
                  isActive && settingsStyles.tabTextActive,
                  platform.tv && isFocused && !isActive && settingsStyles.tabTextFocusedTv,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ACCOUNT & DEVICES                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "account" && (
        <>
          {/* Account & Server Card */}
          <SettingsCard
            title="Account & Server"
            subtitle="Current profile and connected server"
            tv={platform.tv}
          >
            <View style={settingsStyles.serverRow}>
              <UserAvatar
                name={session.profile.username || session.profile.name || "User"}
                size={platform.tv ? 54 : 46}
              />
              <View style={settingsStyles.serverInfo}>
                <Text style={[settingsStyles.serverName, platform.tv && { fontSize: 17 }]}>
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

          {/* Security & Devices Card */}
          <SettingsCard
            title="Security & Devices"
            subtitle="Pairing codes, passwords and active devices"
            tv={platform.tv}
          >
            <Heading>Pair another device</Heading>
            <Field
              label="Confirm password to create pairing code"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!busy}
            />
            <Button
              label="Create pairing code"
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
                        : "Could not create a pairing code.",
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

          {/* Cache & Session Card */}
          <SettingsCard
            title="Cache & Session"
            subtitle="Manage storage, profiles or sign out"
            tv={platform.tv}
          >
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
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PLAYBACK & STORAGE                                              */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "playback" && (
        <>
          {/* Playback Preferences Card */}
          <SettingsCard
            title="Playback Preferences"
            subtitle="Subtitles, skipping and audio behavior"
            tv={platform.tv}
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

          {/* Downloads & Storage Card */}
          <SettingsCard
            title="Downloads & Storage"
            subtitle="Offline sync, network and storage caps"
            tv={platform.tv}
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
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: APP UPDATES (GitHub Releases)                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "updates" && (
        <SettingsCard
          title="App Updates"
          subtitle="Direct GitHub releases & in-app updates"
          tv={platform.tv}
        >
          <View style={{ gap: 14 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <View>
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.ink }}>
                  Installed Version
                </Text>
                <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2 }}>
                  v{appInfo.versionName} (build {appInfo.buildNumber}) · {platform.tv ? "Android TV" : "Android Mobile"}
                </Text>
              </View>
              <Button
                label={checkingUpdate ? "Checking…" : "Check for Updates"}
                disabled={checkingUpdate || downloadProgress != null}
                onPress={() => void handleCheckUpdate()}
              />
            </View>

            {updateError ? (
              <View style={{ gap: 8 }}>
                <Notice message={updateError} kind="error" />
                <Button
                  label="Open Android App Install Settings"
                  onPress={() => void openUnknownAppsSettings()}
                />
              </View>
            ) : null}

            {updateChecked && !availableUpdate && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
                <CheckCircle2 size={18} color="#22c55e" />
                <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: "#22c55e" }}>
                  Plexy is up to date (build {appInfo.buildNumber}). You are running the latest release.
                </Text>
              </View>
            )}

            {availableUpdate && (
              <View
                style={{
                  gap: 14,
                  padding: 16,
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.1)",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink }}>
                      {availableUpdate.tagName} Available
                    </Text>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 3 }}>
                      Package: {availableUpdate.apkName} · {(availableUpdate.apkSize / (1024 * 1024)).toFixed(1)} MB
                    </Text>
                  </View>
                  <Button
                    label={
                      downloadProgress != null
                        ? `Downloading ${downloadProgress}%`
                        : "Download & Install"
                    }
                    primary
                    disabled={downloadProgress != null}
                    onPress={handleInstallUpdate}
                  />
                </View>

                {downloadProgress != null && (
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: "rgba(255,255,255,0.15)",
                      overflow: "hidden",
                      width: "100%",
                      marginTop: 4,
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${downloadProgress}%`,
                        backgroundColor: colors.brand,
                      }}
                    />
                  </View>
                )}
              </View>
            )}

            <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted, lineHeight: 18 }}>
              Updates are downloaded directly from official Plexy GitHub releases. Android will ask you to confirm before updating.
            </Text>
          </View>
        </SettingsCard>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ADMINISTRATOR                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "admin" && status.value?.adminAvailable && (
        <SettingsCard title="Server Administration" tv={platform.tv}>
          <AdminPanel />
        </SettingsCard>
      )}

      {!!error && <Notice message={error} />}
    </ScrollView>
  );
}

const settingsStyles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 48,
    gap: 16,
  },
  containerTv: {
    padding: 32,
    paddingBottom: 64,
    gap: 20,
    maxWidth: 960,
    alignSelf: "flex-start",
    width: "100%",
  },
  card: {
    backgroundColor: "#121212",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    gap: 14,
    width: "100%",
  },
  cardTv: {
    padding: 22,
    gap: 16,
    backgroundColor: "#141414",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.09)",
  },
  cardHeader: {
    gap: 3,
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
  cardTitleTv: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
  },
  cardSubtitleTv: {
    fontSize: 13,
  },
  cardBody: {
    gap: 14,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    flexWrap: "wrap",
  },
  tabBarTv: {
    gap: 12,
    marginBottom: 10,
  },
  tabItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  tabItemTv: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1.5,
  },
  tabItemActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  tabItemFocusedTv: {
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ scale: 1.03 }],
  },
  tabText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
  tabTextTv: {
    fontSize: 15,
  },
  tabTextActive: {
    fontFamily: fonts.bold,
    color: "#000000",
  },
  tabTextFocusedTv: {
    color: "#ffffff",
    fontFamily: fonts.bold,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
