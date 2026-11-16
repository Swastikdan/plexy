import { modeLabels } from "@/core/client/preferences";
import * as Linking from "expo-linking";
import { fetchUpdateReleases } from "./lib/update-releases";
import { selectUpdate } from "./lib/update-policy";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { Directory } from "expo-file-system";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Modal,
  Pressable,
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
import {
  Download,
  Film,
  Gauge,
  Library,
  RefreshCw,
  X,
} from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { Updates } from "./components/app-updates";
import { AppearanceModeSelector } from "./components/appearance-mode-selector";
import { SettingsRow } from "./components/settings-row";
import { useAppUpdates } from "./hooks/use-app-updates";

export function SettingsScreen({
  page = "settings",
}: {
  page?: "settings" | "folders" | "updates" | "metadata" | "playback";
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const online = useOnline();
  const { push } = useRouter();
  const [, update] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const folderScroll = useRef<ScrollView>(null);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [folderLimit, setFolderLimit] = useState(50);
  const [markerStatus, setMarkerStatus] = useState("");
  const [refreshingMarkers, setRefreshingMarkers] = useState(false);
  const [folderFiles, setFolderFiles] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!expandedFolder) return;
      const listener = BackHandler.addEventListener("hardwareBackPress", () => {
        if (folderFiles) setFolderFiles(false);
        else setExpandedFolder(null);
        return true;
      });
      return () => listener.remove();
    }, [expandedFolder, folderFiles]),
  );
  const folderKey = `${expandedFolder}:${folderFiles}`;
  const [previousFolderKey, setPreviousFolderKey] = useState(folderKey);
  if (previousFolderKey !== folderKey) {
    setPreviousFolderKey(folderKey);
    setFolderLimit(50);
  }
  useEffect(() => {
    folderScroll.current?.scrollTo({ y: 0, animated: false });
  }, [expandedFolder, folderFiles]);
  const [message, setMessage] = useState("");
  const { api, runtime, preferences, updatePreferences } = useClient();
  const hasLocal = preferences.mode !== "online";
  const hasOnline = preferences.mode !== "local";
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
  const action = async (fn: () => Promise<void>, key = "") => {
    if (busy) return;
    setBusy(true);
    setActiveAction(key);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (!/cancel/i.test(String(e)))
        setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setActiveAction("");
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
  const addFolder = () => {
    showDialog(
      "Add media folder",
      "Choose what kind of videos are in this folder, then pick it in Android’s file picker and allow Plexy to access it.",
      [
        {
          text: "Movies",
          onPress: () => void action(() => pickFolder("movies")),
        },
        {
          text: "TV shows",
          onPress: () => void action(() => pickFolder("tv")),
        },
        {
          text: "Anime",
          onPress: () => void action(() => pickFolder("anime")),
        },
      ],
    );
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
  const folderRecords = localLibrary.state.records.filter(
    (record) => record.root === expandedFolder,
  );
  const folderTitles = [
    ...new Map(
      folderRecords.map((record) => [
        record.card.parentId ?? record.id,
        record,
      ]),
    ).values(),
  ];
  // A connected folder can hold thousands of files. Render a bounded page
  // instead of mounting every row inside this ScrollView at once.
  const folderList = folderFiles ? folderRecords : folderTitles;
  const visibleFolderList = folderList.slice(0, folderLimit);
  return (
    <View className="flex-1 bg-background">
      <PageHeader
        onBack={
          expandedFolder
            ? () => {
                if (folderFiles) setFolderFiles(false);
                else setExpandedFolder(null);
              }
            : undefined
        }
        subtitle={
          expandedFolder
            ? `${folderTitles.length} ${folderTitles.length === 1 ? "title" : "titles"} · ${folderRecords.length} files`
            : undefined
        }
        title={
          expandedFolder
            ? folderFiles
              ? "Files"
              : localLibrary.state.roots.find((r) => r.uri === expandedFolder)
                  ?.name || "Media folder"
            : page === "folders"
              ? "Media folders"
              : page === "updates"
                ? "App updates"
                : page === "metadata"
                  ? "Metadata & markers"
                  : page === "playback"
                    ? "Playback"
                    : "Settings"
        }
        style={{
          paddingHorizontal: 20,
        }}
      />
      <ScrollView
        ref={folderScroll}
        className="flex-1 bg-background"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 36,
          gap: 14,
        }}
      >
        {!online && (
          <Notice message="Offline. Online playback and updates are unavailable. Saved local videos remain available in Local only or Hybrid mode." />
        )}
        <Modal
          visible={!!picker}
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <View className="flex-1 justify-center bg-black/70 p-6">
            <Pressable
              className="absolute inset-0"
              accessible={false}
              onPress={() => setPicker(null)}
            />
            <View
              accessibilityViewIsModal
              className="w-full max-w-[420px] max-h-full self-center overflow-hidden rounded-[18px] bg-overlay"
            >
              <View className="flex-row items-center gap-3 px-4 py-3 border-b border-border">
                <Text
                  accessibilityRole="header"
                  className="flex-1 text-[22px] font-archivo-bold text-foreground"
                >
                  {picker?.title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close choices"
                  onPress={() => setPicker(null)}
                  className="h-12 w-12 items-center justify-center rounded-full bg-default"
                >
                  <X size={22} color={colors.ink} />
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 420, flexShrink: 1 }}>
                {picker?.options.map(([value, title]) => (
                  <SettingsRow
                    key={value}
                    title={title}
                    selected={metadata[picker.key] === value}
                    onPress={() => {
                      const key = picker.key;
                      setPicker(null);
                      void action(() =>
                        localLibrary.updateMetadataSettings({ [key]: value }),
                      );
                    }}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
        {!!message && <Notice message={message} />}
        {page === "settings" && (
          <>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Mode
            </Text>
            <AppearanceModeSelector
              value={preferences.theme}
              onChange={(theme) => updatePreferences({ theme })}
            />
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow navigation title="Watching mode" subtitle={modeLabels[preferences.mode]} onPress={() => updatePreferences({ onboardingCompleted: false })} />
            </View>
            {preferences.mode === "hybrid" && <>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Online
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Online catalog"
                subtitle="Browse TMDB and play with Vidy"
              >
                <ToggleSwitch
                  value={preferences.source === "remote"}
                  accessibilityLabel="Online catalog"
                  onValueChange={(enabled) => {
                    if (!enabled) {
                      updatePreferences({ source: "local" });
                      return;
                    }
                    if (preferences.onlineDisclaimerSeen) {
                      updatePreferences({ source: "remote" });
                      return;
                    }
                    showDialog(
                      "Online catalog",
                      "Plexy does not host online titles. Metadata comes from TMDB and playback is provided by third-party sources. Some titles may be unavailable, region-locked, or change without notice.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Continue",
                          onPress: () =>
                            updatePreferences({
                              source: "remote",
                              onlineDisclaimerSeen: true,
                            }),
                        },
                      ],
                    );
                  }}
                />
              </SettingsRow>

            </View>
            </>}
            {hasLocal && <>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Library
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Library report"
                subtitle={`${fileCount} files, ${review ? `${review} need attention` : "all titles identified"}`}
                icon={Library}
                onPress={() => push("/settings/report")}
              />
              <SettingsRow
                navigation
                title="Metadata & markers"
                subtitle="Artwork and skip markers"
                icon={Film}
                onPress={() => push("/settings/metadata")}
              />
              <SettingsRow
                navigation
                title="Media folders"
                subtitle={`${localLibrary.state.roots.filter((r) => !r.singleFile).length} folders connected`}
                icon={Film}
                onPress={() => push("/settings/folders")}
              />
              <SettingsRow
                title={localLibrary.scanning ? "Scanning…" : "Scan library"}
                subtitle="Scan connected folders"
                icon={RefreshCw}
                onPress={
                  busy || localLibrary.scanning
                    ? undefined
                    : () => void action(() => localLibrary.scan())
                }
              />
            </View>
            {localLibrary.issues.map((issue) => (
              <Notice key={issue} message={issue} />
            ))}
            </>}
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Playback
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Playback settings"
                subtitle={hasLocal ? "Seeking, subtitles, autoplay and skipping" : "Online autoplay and episode picker"}
                icon={Gauge}
                onPress={() => push("/settings/playback")}
              />
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
                      updateDownloading || updateProgress !== null
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
                          ? `Version ${appInfo.versionName}`
                          : "Version checking…")}
                  </Text>
                </View>
                <Button
                  label={
                    availableUpdate
                      ? updateDownloading
                        ? updateProgress === 100
                          ? "Install…"
                          : "Downloading…"
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
                title="Open Source Licenses"
                subtitle="Credits, copyright and license notices"
                navigation
                onPress={() => push("/settings/licenses")}
              />
              <SettingsRow
                title="Download from GitHub"
                subtitle="Open the latest Android download"
                onPress={() =>
                  void action(async () => {
                    const latest = selectUpdate(
                      await fetchUpdateReleases(),
                      "mobile",
                      0,
                    );
                    if (!latest)
                      throw new Error(
                        "No Android download is available on GitHub yet.",
                      );
                    await Linking.openURL(latest.apkUrl);
                  })
                }
              />
            </View>
            {hasLocal && <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
              Videos stay in their original folders. Library data, artwork and
              saved scrub previews stay on this device.
            </Text>}
            <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
              This product uses the TMDB API but is not endorsed or certified by
              TMDB.
            </Text>
          </>
        )}
        {page === "playback" && (
          <>
            {hasLocal && <>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Seeking
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Skip forward & backward"
                subtitle={`${preferences.seekSeconds} seconds`}
                onPress={() =>
                  showDialog(
                    "Seek duration",
                    "Choose the interval for both directions and double taps.",
                    [
                      ...([5, 10, 15, 20, 30, 60] as const).map((value) => ({
                        text: `${preferences.seekSeconds === value ? "✓ " : ""}${value} seconds`,
                        onPress: () =>
                          updatePreferences({ seekSeconds: value }),
                      })),
                    ],
                  )
                }
              />
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Subtitles
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Automatic subtitles"
                subtitle="Use preferred track"
              >
                <ToggleSwitch
                  value={preferences.autoSubtitles}
                  onValueChange={(v) => updatePreferences({ autoSubtitles: v })}
                />
              </SettingsRow>
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Playback behavior
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Automatically skip marked sections"
                subtitle="Skip intro, recap and credits"
              >
                <ToggleSwitch
                  value={preferences.autoSkip}
                  onValueChange={(v) => updatePreferences({ autoSkip: v })}
                  accessibilityLabel="Automatically skip marked sections"
                />
              </SettingsRow>
              <SettingsRow
                title="Play next episode"
                subtitle="Continue automatically"
              >
                <ToggleSwitch
                  value={preferences.autoNext}
                  onValueChange={(v) => updatePreferences({ autoNext: v })}
                />
              </SettingsRow>
            </View>
            </>}
            {hasOnline && <>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Online playback
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Autoplay online"
                subtitle="Start the Vidy player automatically"
              >
                <ToggleSwitch
                  value={preferences.onlineAutoplay}
                  onValueChange={(v) =>
                    updatePreferences({ onlineAutoplay: v })
                  }
                  accessibilityLabel="Autoplay online"
                />
              </SettingsRow>
              <SettingsRow
                title="Online episode picker"
                subtitle="Show the provider season and episode menu"
              >
                <ToggleSwitch
                  value={preferences.onlineEpisodeSelector}
                  onValueChange={(v) =>
                    updatePreferences({ onlineEpisodeSelector: v })
                  }
                  accessibilityLabel="Online episode picker"
                />
              </SettingsRow>
            </View>
            </>}
          </>
        )}
        {page === "folders" && hasLocal && (
          <>
            {!expandedFolder ? (
              <>
                <Button
                  label="Add media folder"
                  testID="add-media-folder"
                  disabled={busy}
                  onPress={() => addFolder()}
                />
                <View className="overflow-hidden rounded-[18px] bg-surface">
                  {localLibrary.state.roots
                    .filter((r) => !r.singleFile)
                    .map((root) => {
                      const records = localLibrary.state.records.filter(
                        (r) => r.root === root.uri,
                      );
                      const count = new Set(
                        records.map((r) => r.card.parentId ?? r.id),
                      ).size;
                      return (
                        <SettingsRow
                          key={root.uri}
                          navigation
                          title={root.name || displayName(root.uri)}
                          subtitle={`${count} ${count === 1 ? "title" : "titles"} · ${records.length} files`}
                          onPress={() => setExpandedFolder(root.uri)}
                        />
                      );
                    })}
                </View>
              </>
            ) : (
              <>
                {!folderFiles && (
                  <View className="overflow-hidden rounded-[18px] bg-surface">
                    <SettingsRow
                      navigation
                      title="All files"
                      subtitle={`${folderRecords.length} videos in this folder`}
                      onPress={() => setFolderFiles(true)}
                    />
                  </View>
                )}
                <View className="overflow-hidden rounded-[18px] bg-surface">
                  {visibleFolderList.map((record) => (
                    <SettingsRow
                      key={record.id}
                      navigation
                      title={
                        folderFiles
                          ? record.file.name
                          : record.card.parentTitle || record.card.name
                      }
                      subtitle={folderFiles ? record.card.name : undefined}
                      onPress={() =>
                        push({
                          pathname: "/item/[id]",
                          params: {
                            id: folderFiles
                              ? record.card.publicId
                              : record.card.parentPublicId ||
                                record.card.publicId,
                          },
                        })
                      }
                    />
                  ))}
                </View>
                {folderList.length > folderLimit && (
                  <Button
                    label={`Show more (${folderList.length - folderLimit} remaining)`}
                    onPress={() => setFolderLimit((limit) => limit + 50)}
                  />
                )}
                {!folderFiles && (
                  <>
                    <Button
                      label="Add media folder"
                      disabled={busy}
                      onPress={() => addFolder()}
                    />
                    <Button
                      label="Remove from the library"
                      disabled={busy}
                      onPress={() =>
                        showDialog(
                          "Remove folder?",
                          "Your original videos will stay untouched.",
                          [
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () =>
                                void action(async () => {
                                  await localLibrary.removeRoot(expandedFolder);
                                  setExpandedFolder(null);
                                }),
                            },
                          ],
                        )
                      }
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
        {page === "metadata" && hasLocal && (
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
                navigation
                title="Metadata language"
                subtitle={label(languages, metadata.language)}
                onPress={
                  busy
                    ? undefined
                    : () => choose("language", "Metadata language", languages)
                }
              />
              <SettingsRow
                navigation
                title="Region"
                subtitle={label(regions, metadata.region)}
                onPress={
                  busy ? undefined : () => choose("region", "Region", regions)
                }
              />
              <SettingsRow
                navigation
                title="Poster image size"
                subtitle={label(sizes, metadata.posterSize)}
                onPress={
                  busy
                    ? undefined
                    : () => choose("posterSize", "Poster image size", sizes)
                }
              />
              <SettingsRow
                title={
                  activeAction === "metadata"
                    ? "Refreshing metadata & artwork…"
                    : "Refresh metadata & artwork"
                }
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
                        }, "metadata")
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
              Language, region and poster size apply on the next metadata
              refresh. Larger posters use more storage.
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
                      localLibrary.updateMetadataSettings({
                        markersEnabled: v,
                      }),
                    )
                  }
                />
              </SettingsRow>
              <SettingsRow
                title={
                  refreshingMarkers
                    ? "Refreshing markers…"
                    : "Refresh markers now"
                }
                subtitle={
                  markerStatus || `${markerCount} files have saved markers`
                }
                onPress={
                  !online || busy || !metadata.markersEnabled
                    ? undefined
                    : () =>
                        void action(async () => {
                          setRefreshingMarkers(true);
                          setMarkerStatus("Updating…");
                          try {
                            const result = await localLibrary.refreshMarkers();
                            setMarkerStatus(
                              `Checked ${result.checked} titles; found markers for ${result.found}.`,
                            );
                          } catch (error) {
                            setMarkerStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            );
                          } finally {
                            setRefreshingMarkers(false);
                          }
                        })
                }
              />
            </View>
            <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
              When timings are available, the player offers Skip intro, Skip
              recap or Skip credits. Saved markers work offline. Missing or
              stale markers are checked during scans and playback; titles
              without community timings play normally. Automatic skipping is
              configured under Playback settings.
            </Text>
          </>
        )}
        {page === "updates" && <Updates />}
      </ScrollView>
    </View>
  );
}
