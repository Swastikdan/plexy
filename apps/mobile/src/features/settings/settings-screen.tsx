import { useAppDialog } from "@/shared/ui/app-dialog";
import { useUniwind } from "uniwind";
import { Directory } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect,useState } from "react";
import {
Modal,
ScrollView,
Text,
View,
} from "react-native";
import type { LocalRoot } from "@plexy/local-library/library";
import { useClient } from "@/core/client/client-provider";
import {
bundledMetadata,
displayName,
localLibrary,
localRuntime,
} from "@/core/library/local-runtime";
import { useOnline } from "@/shared/hooks/use-online";
import { cn } from "@/shared/lib/cn";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { Download, Film, Library, Tv } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { Updates } from "./components/app-updates";
import { SettingsRow } from "./components/settings-row";
import { useAppUpdates } from "./hooks/use-app-updates";

export function SettingsScreen({ page = "settings" }: {
  page?: "settings" | "folders" | "updates" | "metadata";
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const { theme } = useUniwind();
  const online = useOnline();
  const router = useRouter();
  const [, update] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { api, runtime, preferences, updatePreferences } = useClient();
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
  useEffect(() => runtime.subscribe(() => update((n) => n + 1)), [runtime]);
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
  const pickFolder = async (kind: LocalRoot["kind"]) => {
    const folder = await Directory.pickDirectoryAsync();
    await localLibrary.addRoot({
      uri: folder.uri,
      name: displayName(folder.uri),
      kind,
    });
  };
  const addFolder = (kind: LocalRoot["kind"]) => {
    showDialog("Add media folder", "Choose a folder in Android’s file picker, then allow Plexy to access its videos.", [
      { text: "Choose folder", onPress: () => void action(() => pickFolder(kind)) },
      { text: "Cancel", style: "cancel" },
    ]);
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
  const { fileCount, reviewCount: review, markerCount } = api.libraryStatus();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 36,
        gap: 14,
      }}
    >
      {!online && (
        <Notice message="Offline. Trailers, updates and metadata refresh are unavailable. Your saved library and markers still work." />
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
        style={{
          paddingHorizontal: 0,
          paddingTop: 0,
          paddingBottom: 0,
          minHeight: 0,
        }}
      />
      <Modal
        visible={!!picker}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(null)}
      >
        <View className="flex-1 justify-center bg-black/70 p-6">
          <View className="overflow-hidden rounded-[18px] bg-overlay">
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
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            Appearance
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
            <SettingsRow title="Dark mode" subtitle={theme === "dark" ? "Dark appearance" : "Light appearance"}>
              <ToggleSwitch
                accessibilityLabel="Dark mode"
                value={theme === "dark"}
                onValueChange={(value) => updatePreferences({ theme: value ? "dark" : "light" })}
              />
            </SettingsRow>
          </View>
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            Library
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
            <SettingsRow
              title="Library report"
              subtitle={`${fileCount} files, ${review ? `${review} need attention` : "all titles identified"}`}
              icon={Library}
              onPress={() => router.push("/settings/report")}
            />
            <SettingsRow
              title="Metadata & episode markers"
              subtitle="TMDB, artwork, intro, recap and credits"
              icon={Film}
              onPress={() => router.push("/settings/metadata")}
            />
            <SettingsRow
              title="Media folders"
              subtitle={`${localLibrary.state.roots.filter((r) => !r.singleFile).length} folders connected`}
              icon={Film}
              onPress={() => router.push("/settings/folders")}
            />
            <SettingsRow
              title={
                localLibrary.scanning
                  ? "Updating your library…"
                  : "Scan for changes"
              }
              subtitle="New files and artwork appear automatically"
              icon={Library}
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
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            Playback
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
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
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            About
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
            <View className="min-h-[66px] flex-row items-center gap-3.5 border-b-[0.33px] border-border px-4 py-3.5">
              <View className="w-6 items-center">
                <Download size={20} color={colors.muted} />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-[15px] font-archivo-medium text-foreground">
                  App update
                </Text>
                <Text
                  className={cn(
                    "text-[12px] leading-[18px] font-archivo-regular",
                    (updateDownloading || updateProgress !== null)
                      ? "text-foreground"
                      : "text-muted",
                  )}
                >
                  {updateProgress !== null
                    ? updateProgress === 100
                      ? updateStatusText
                      : `Downloading update… ${updateProgress}%`
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
                      ? updateProgress === 100 ? "Install…" : `${updateProgress ?? 0}%`
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
                  width: 120,
                  flexShrink: 0,
                  minHeight: 44,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: online ? 1 : 0.4,
                }}
              />
            </View>
            <SettingsRow
              title="Update installation options"
              subtitle="Allow installations or download the APK in your browser"
              onPress={() => router.push("/settings/updates")}
            />
            <SettingsRow
              title="Movie and TV information"
              subtitle={
                bundledMetadata
                  ? "TMDB is ready to use. No setup needed."
                  : "TMDB is unavailable in this build."
              }
            />
          </View>
          <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
            Videos stay in their original folders. Library data, artwork and
            saved scrub previews stay on this device.
          </Text>
          <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
            This product uses the TMDB API but is not endorsed or certified by
            TMDB.
          </Text>
        </>
      )}
      {page === "folders" && (
        <>
          <View className="overflow-hidden rounded-[18px] bg-surface">
            <SettingsRow
              title="Add movie folder"
              icon={Film}
              onPress={
                busy ? undefined : () => addFolder("movies")
              }
            />
            <SettingsRow
              title="Add TV show folder"
              icon={Tv}
              onPress={
                busy ? undefined : () => addFolder("tv")
              }
            />
            <SettingsRow
              title="Add anime folder"
              icon={Library}
              onPress={
                busy ? undefined : () => addFolder("anime")
              }
            />
          </View>
          {localLibrary.state.roots
            .filter((r) => !r.singleFile)
            .map((root) => (
              <View
                className="overflow-hidden rounded-[18px] bg-surface"
                key={root.uri}
              >
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
                    showDialog(
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
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            TMDB metadata
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
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
          <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
            Language, region and poster size apply on the next metadata refresh.
            Larger posters use more storage.
          </Text>
          <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
            Intro, recap & credits
          </Text>
          <View className="overflow-hidden rounded-[18px] bg-surface">
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
              subtitle={`${markerCount} files have saved markers`}
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
          <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
            When timings are available, the player offers Skip intro, Skip recap
            or Skip credits. Saved markers work offline. Missing or stale
            markers are checked during scans and playback; titles without
            community timings play normally.
          </Text>
          {!!busy && (
            <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
              Updating…
            </Text>
          )}
        </>
      )}
      {page === "updates" && <Updates />}
    </ScrollView>
  );
}
