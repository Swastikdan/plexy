import { Directory } from "expo-file-system";
import { useIsFocused,useLocalSearchParams,useRouter } from "expo-router";
import { useEffect,useState } from "react";
import {
Alert,
BackHandler,
Modal,
Pressable,
ScrollView,
StyleSheet,
Text,
View,
} from "react-native";
import type { LocalRoot } from "../../../../../packages/local-library/src/library";
import { useClient } from "../../core/client/client-provider";
import {
bundledMetadata,
displayName,
localLibrary,
localRuntime,
} from "../../core/library/local-runtime";
import { useOnline } from "../../shared/hooks/use-online";
import { card,colors,fonts } from "../../shared/theme";
import { Button } from "../../shared/ui/button";
import { Icon } from "../../shared/ui/icon";
import { Notice } from "../../shared/ui/notice";
import { PageHeader } from "../../shared/ui/page-header";
import { ToggleSwitch } from "../../shared/ui/toggle-switch";
import { LibraryReportScreen } from "../library-report/library-report-screen";
import { Updates } from "./components/app-updates";
import { SettingsRow } from "./components/settings-row";
import { useAppUpdates } from "./hooks/use-app-updates";

export function SettingsScreen() {
  const online = useOnline();
  const params = useLocalSearchParams<{ page?: string }>();
  const focused = useIsFocused();
  const router = useRouter();
  const [, update] = useState(0);
  const [page, setPage] = useState<
    "settings" | "report" | "folders" | "updates" | "metadata"
  >(params.page === "folders" ? "folders" : "settings");
  useEffect(() => {
    if (!focused || page === "settings") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      setPage("settings");
      return true;
    });
    return () => listener.remove();
  }, [focused, page]);
  useEffect(() => {
    if (focused && params.page === "folders") {
      setPage("folders");
      router.setParams({ page: undefined });
    }
  }, [focused, params.page, router]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { preferences, updatePreferences } = useClient();
  const {
    appInfo,
    availableUpdate,
    updateChecking,
    updateDownloading,
    updateProgress,
    updateStatusText,
    handleCheckUpdate,
    handleDownloadAndInstall,
  } = useAppUpdates(online);
  useEffect(() => localLibrary.subscribe(() => update((n) => n + 1)), []);
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (!/cancel/i.test(String(e)))
        setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const addFolder = async (kind: LocalRoot["kind"]) => {
    const folder = await Directory.pickDirectoryAsync();
    await localLibrary.addRoot({
      uri: folder.uri,
      name: displayName(folder.uri),
      kind,
    });
  };
  const metadata = localLibrary.metadataSettings;
  const [picker, setPicker] = useState<{
    key: "language" | "region" | "posterSize";
    title: string;
    options: [string, string][];
  } | null>(null);
  const choose = (
    key: "language" | "region" | "posterSize",
    title: string,
    options: [string, string][],
  ) => setPicker({ key, title, options });
  const languages: [string, string][] = [
    ["en-US", "English (US)"],
    ["en-GB", "English (UK)"],
    ["hi-IN", "Hindi (India)"],
    ["ja-JP", "Japanese"],
    ["ko-KR", "Korean"],
    ["fr-FR", "French"],
    ["es-ES", "Spanish"],
  ];
  const regions: [string, string][] = [
    ["US", "United States"],
    ["IN", "India"],
    ["GB", "United Kingdom"],
    ["CA", "Canada"],
    ["AU", "Australia"],
    ["JP", "Japan"],
  ];
  const sizes: [string, string][] = [
    ["w342", "342 px wide"],
    ["w500", "500 px wide"],
    ["w780", "780 px wide"],
    ["original", "Original size"],
  ];
  const label = (options: [string, string][], value: string) =>
    options.find((o) => o[0] === value)?.[1] || value;
  const records = localLibrary.state.records;
  const review = records.filter(
    (r) => r.card.matchStatus !== "matched" || r.metadataError,
  ).length;
  if (page === "report")
    return <LibraryReportScreen back={() => setPage("settings")} />;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={styles.page}
    >
      {!online && (
        <Notice message="Offline. Trailers, updates and metadata refresh are unavailable. Your saved library and markers still work." />
      )}
      {page !== "settings" && (
        <Pressable
          onPress={() => setPage("settings")}
          accessibilityLabel="Back to Settings"
          style={{ paddingVertical: 12 }}
        >
          <Text style={styles.back}>‹ Settings</Text>
        </Pressable>
      )}
      <PageHeader
        title={
          page === "folders"
            ? "Media folders"
            : page === "updates"
              ? "App updates"
              : page === "metadata"
                ? "Metadata & episode markers"
                : "Settings"
        }
        style={styles.settingsHeader}
      />
      <Modal
        visible={!!picker}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(null)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 24,
            backgroundColor: "rgba(0,0,0,.7)",
          }}
        >
          <View style={styles.group}>
            <ScrollView style={{ maxHeight: 500 }}>
              <SettingsRow title={picker?.title || ""} />
              {picker?.options.map(([value, title]) => (
                <SettingsRow
                  key={value}
                  title={`${metadata[picker.key] === value ? "✓ " : ""}${title}`}
                  onPress={() => {
                    const key = picker.key;
                    setPicker(null);
                    void action(() =>
                      localLibrary.updateMetadataSettings({ [key]: value }),
                    );
                  }}
                />
              ))}
              <SettingsRow title="Cancel" onPress={() => setPicker(null)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
      {!!message && <Notice message={message} />}
      {page === "settings" && (
        <>
          <Text style={styles.section}>Library</Text>
          <View style={styles.group}>
            <SettingsRow
              title="Library report"
              subtitle={`${records.length} files${review ? ` · ${review} need attention` : " · All titles identified"}`}
              icon="library"
              onPress={() => setPage("report")}
            />
            <SettingsRow
              title="Metadata & episode markers"
              subtitle="TMDB, artwork, intro, recap and credits"
              icon="film"
              onPress={() => setPage("metadata")}
            />
            <SettingsRow
              title="Media folders"
              subtitle={`${localLibrary.state.roots.filter((r) => !r.singleFile).length} folders connected`}
              icon="film"
              onPress={() => setPage("folders")}
            />
            <SettingsRow
              title={
                localLibrary.scanning
                  ? "Updating your library…"
                  : "Scan for changes"
              }
              subtitle="New files and artwork appear automatically"
              icon="library"
              onPress={
                busy || localLibrary.scanning
                  ? undefined
                  : () => void action(() => localRuntime.refresh())
              }
            />
          </View>
          {localLibrary.issues.map((issue) => (
            <Notice key={issue} message={issue} />
          ))}
          <Text style={styles.section}>Playback</Text>
          <View style={styles.group}>
            <SettingsRow
              title="Automatic subtitles"
              subtitle="Use your preferred subtitle track"
            >
              <ToggleSwitch
                value={preferences.autoSubtitles}
                onValueChange={(v) => updatePreferences({ autoSubtitles: v })}
              />
            </SettingsRow>
            <SettingsRow
              title="Automatically skip marked sections"
              subtitle="Intro, recap and credits when markers are enabled"
            >
              <ToggleSwitch
                value={preferences.autoSkip}
                onValueChange={(v) => updatePreferences({ autoSkip: v })}
                accessibilityLabel="Automatically skip marked sections"
              />
            </SettingsRow>
            <SettingsRow
              title="Play next episode"
              subtitle="Continue the series automatically"
            >
              <ToggleSwitch
                value={preferences.autoNext}
                onValueChange={(v) => updatePreferences({ autoNext: v })}
              />
            </SettingsRow>
          </View>
          <Text style={styles.section}>About</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <View style={styles.icon}>
                <Icon name="download" size={20} color={colors.muted} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.rowTitle}>App update</Text>
                <Text
                  style={[
                    styles.rowSubtitle,
                    (updateDownloading || updateProgress !== null) && {
                      color: colors.ink,
                    },
                  ]}
                >
                  {updateProgress !== null
                    ? `Downloading update… ${updateProgress}%`
                    : updateStatusText ||
                      (appInfo
                        ? `Version ${appInfo.versionName} (build ${appInfo.buildNumber})`
                        : "Version checking…")}
                </Text>
              </View>
              <Button
                label={
                  availableUpdate
                    ? updateDownloading
                      ? `${updateProgress ?? 0}%`
                      : "Update now"
                    : updateChecking
                      ? "Checking…"
                      : "Check"
                }
                primary={Boolean(availableUpdate)}
                disabled={!online || updateChecking || updateDownloading}
                onPress={() =>
                  void (availableUpdate
                    ? handleDownloadAndInstall()
                    : handleCheckUpdate())
                }
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: online ? 1 : 0.4,
                }}
              />
            </View>
            <SettingsRow
              title="Movie and TV information"
              subtitle={
                bundledMetadata
                  ? "TMDB is ready to use. No setup needed."
                  : "TMDB is unavailable in this build."
              }
            />
          </View>
          <Text style={styles.footnote}>
            Videos stay in their original folders. Library data, artwork and
            saved scrub previews stay on this device.
          </Text>
          <Text style={styles.footnote}>
            This product uses the TMDB API but is not endorsed or certified by
            TMDB.
          </Text>
        </>
      )}
      {page === "folders" && (
        <>
          <View style={styles.group}>
            <SettingsRow
              title="Add movie folder"
              icon="film"
              onPress={
                busy ? undefined : () => void action(() => addFolder("movies"))
              }
            />
            <SettingsRow
              title="Add TV show folder"
              icon="tv"
              onPress={
                busy ? undefined : () => void action(() => addFolder("tv"))
              }
            />
            <SettingsRow
              title="Add anime folder"
              icon="library"
              onPress={
                busy ? undefined : () => void action(() => addFolder("anime"))
              }
            />
          </View>
          {localLibrary.state.roots
            .filter((r) => !r.singleFile)
            .map((root) => (
              <View style={styles.group} key={root.uri}>
                <SettingsRow
                  title={root.name || displayName(root.uri)}
                  subtitle={
                    root.kind === "anime"
                      ? "Anime"
                      : root.kind === "tv"
                        ? "TV shows"
                        : "Movies"
                  }
                />
                <SettingsRow
                  title="Remove folder from library"
                  danger
                  onPress={() =>
                    Alert.alert(
                      "Remove folder?",
                      "Your original videos will stay untouched.",
                      [
                        { text: "Cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () =>
                            void action(() =>
                              localLibrary.removeRoot(root.uri),
                            ),
                        },
                      ],
                    )
                  }
                />
              </View>
            ))}
        </>
      )}
      {page === "metadata" && (
        <>
          <Text style={styles.section}>TMDB metadata</Text>
          <View style={styles.group}>
            <SettingsRow
              title="TMDB connection"
              subtitle={
                bundledMetadata
                  ? "Bundled with this app"
                  : "Unavailable in this build"
              }
            />
            <SettingsRow
              title="Metadata language"
              subtitle={label(languages, metadata.language)}
              onPress={
                busy
                  ? undefined
                  : () => choose("language", "Metadata language", languages)
              }
            />
            <SettingsRow
              title="Region"
              subtitle={label(regions, metadata.region)}
              onPress={
                busy ? undefined : () => choose("region", "Region", regions)
              }
            />
            <SettingsRow
              title="Poster image size"
              subtitle={label(sizes, metadata.posterSize)}
              onPress={
                busy
                  ? undefined
                  : () => choose("posterSize", "Poster image size", sizes)
              }
            />
            <SettingsRow
              title="Refresh metadata & artwork"
              subtitle="Apply these settings to your saved titles"
              onPress={
                !online || busy || localLibrary.scanning
                  ? undefined
                  : () =>
                      void action(async () => {
                        await localRuntime.refreshMetadata();
                        setMessage(
                          "Metadata refreshed. Check Library report for any titles needing attention.",
                        );
                      })
              }
            />
            <SettingsRow
              title="Clear TMDB response cache"
              subtitle="Keep your library, artwork and watch progress"
              onPress={
                busy
                  ? undefined
                  : () => {
                      localRuntime.clearMetadataCache();
                      setMessage("TMDB response cache cleared.");
                    }
              }
            />
            <SettingsRow
              title="Test TMDB connection"
              onPress={
                !online || busy
                  ? undefined
                  : () =>
                      void action(async () => {
                        await localRuntime.testMetadata();
                        setMessage("Connected to TMDB.");
                      })
              }
            />
          </View>
          <Text style={styles.footnote}>
            Language, region and poster size apply on the next metadata refresh.
            Larger posters use more storage.
          </Text>
          <Text style={styles.section}>Intro, recap & credits</Text>
          <View style={styles.group}>
            <SettingsRow
              title="Community skip markers"
              subtitle="Look up timings from IntroDB and save on this device"
            >
              <ToggleSwitch
                accessibilityLabel="Enable community skip markers"
                value={metadata.markersEnabled}
                disabled={busy}
                onValueChange={(v) =>
                  void action(() =>
                    localLibrary.updateMetadataSettings({ markersEnabled: v }),
                  )
                }
              />
            </SettingsRow>
            <SettingsRow
              title="Refresh markers now"
              subtitle={`${records.filter((r) => Object.values(r.skips || {}).some(Boolean)).length} files have saved markers`}
              onPress={
                !online || busy || !metadata.markersEnabled
                  ? undefined
                  : () =>
                      void action(async () => {
                        const result = await localLibrary.refreshMarkers();
                        setMessage(
                          `Checked ${result.checked} titles; found markers for ${result.found}.`,
                        );
                      })
              }
            />
            <SettingsRow
              title="Automatically skip marked sections"
              subtitle="Turn off to show a skip button instead"
            >
              <ToggleSwitch
                accessibilityLabel="Automatically skip intro recap and credits"
                value={preferences.autoSkip}
                onValueChange={(v) => updatePreferences({ autoSkip: v })}
              />
            </SettingsRow>
          </View>
          <Text style={styles.footnote}>
            When timings are available, the player offers Skip intro, Skip recap
            or Skip credits. Saved markers work offline. Missing or stale
            markers are checked during scans and playback; titles without
            community timings play normally.
          </Text>
          {!!busy && <Text style={styles.footnote}>Updating…</Text>}
        </>
      )}
      {page === "updates" && <Updates />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
page: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 36, gap: 14 },
settingsHeader: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    minHeight: 0,
  },
section: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    marginTop: 14,
    marginLeft: 2,
  },
group: {
    backgroundColor: colors.surface,
    borderRadius: card.radius,
    overflow: "hidden",
  },
row: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
icon: { width: 24, alignItems: "center" },
rowTitle: { color: colors.ink, fontSize: 15, fontFamily: fonts.medium },
rowSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
footnote: {
    color: colors.quiet,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    marginTop: 4,
  },
back: { color: colors.brandLight, fontFamily: fonts.medium, fontSize: 15 }
});
