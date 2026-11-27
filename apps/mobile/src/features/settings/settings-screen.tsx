import { modeLabels } from "@/core/client/preferences";
import { familyAllows, familyLevelLabels } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
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
import { useClient } from "@/core/client/client-provider";
import {
  bundledMetadata,
  displayName,
  localLibrary,
  localRuntime,
} from "@/core/library/local-runtime";
import { useOnline } from "@/shared/hooks/use-online";
import { cn } from "@/shared/lib/cn";
import {
  languageIdentity,
  mediaLanguageName,
  mediaLanguageOptions,
} from "@/shared/lib/media-language";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import {
  Download,
  EyeOff,
  Film,
  Folder,
  HardDrive,
  Play,
  Tv,
  Gauge,
  Library,
  ListVideo,
  Lock,
  RefreshCw,
  X,
} from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { ScreenContent } from "@/shared/ui/screen";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { Updates } from "./components/app-updates";
import { AppearanceModeSelector } from "./components/appearance-mode-selector";
import { FamilySettings } from "./components/family-settings";
import { HiddenTitlesSettings } from "./components/hidden-titles-settings";
import { SettingsRow } from "./components/settings-row";
import { useAppUpdates } from "./hooks/use-app-updates";

export function SettingsScreen({
  page = "settings",
}: {
  page?:
    | "settings"
    | "folders"
    | "updates"
    | "metadata"
    | "playback"
    | "family"
    | "hidden";
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const online = useOnline();
  const { navigate, push } = useRouter();
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
  const { hidden } = useHiddenTitles();
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
    offerOta,
    otaPending,
  } = useAppUpdates(online);
  const hasAppUpdate = offerOta || Boolean(availableUpdate);
  let appUpdateLabel = updateChecking ? "Checking…" : "Check";
  if (hasAppUpdate) appUpdateLabel = offerOta ? (otaPending ? "Restart" : "Download") : "Update now";
  if (updateDownloading) appUpdateLabel = updateProgress === 100 ? "Install…" : "Updating…";
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
  const downloadFromGitHub = () =>
    action(async () => {
      // A floor version keeps the newest published APK eligible even when the
      // installed app is already current, including build-less mobile-v tags.
      const latest = selectUpdate(
        await fetchUpdateReleases(),
        "mobile",
        0,
        "0.0.0",
      );
      if (!latest)
        throw new Error("No Android download is available on GitHub yet.");
      await Linking.openURL(latest.apkUrl);
    });
  const pickFolder = async (kind: "movies" | "tv") => {
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
      ],
    );
  };
  const metadata = localLibrary.metadataSettings;
  const [picker, setPicker] = useState<{
    title: string;
    description?: string;
    value: string;
    options: readonly [string, string][];
    onSelect: (value: string) => void;
  } | null>(null);
  const choose = (
    key: "language" | "region" | "posterSize",
    title: string,
    options: [string, string][],
  ) => setPicker({
    title,
    description: key === "posterSize" ? "Larger posters use more device storage." : undefined,
    value: metadata[key],
    options,
    onSelect: (value) => void action(() =>
      localLibrary.updateMetadataSettings({ [key]: value }),
    ),
  });
  const chooseTrackLanguage = (
    key: "audioLanguage" | "subtitleLanguage",
    title: string,
    defaultLabel: string,
  ) => {
    const savedLanguage = preferences[key];
    const value = languageIdentity(savedLanguage) ?? savedLanguage;
    const options: [string, string][] = [["", defaultLabel], ...mediaLanguageOptions];
    if (value && !options.some(([code]) => code === value)) {
      options.splice(1, 0, [value, mediaLanguageName(value) ?? value]);
    }
    setPicker({
      title,
      value,
      options,
      onSelect: (language) => updatePreferences({ [key]: language }),
    });
  };
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
  const { reviewCount: review, markerCount } = api.libraryStatus();
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
            : page === "family"
              ? "Titles above the limit are hidden and blocked. Changes are PIN-protected."
              : page === "folders"
                ? "Videos stay in their original folders."
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
                    : page === "family"
                      ? "Kids & family"
                      : page === "hidden"
                        ? "Hidden titles"
                        : "Settings"
        }
      />
      <ScreenContent>
      <ScrollView
        ref={folderScroll}
        className="flex-1 bg-background"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 36,
          flexGrow: page === "hidden" ? 1 : undefined,
          gap: 14,
        }}
      >
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
              <ScrollView className="max-h-[420px] shrink">
                {picker?.description ? (
                  <Text className="px-4 py-3 text-[13px] leading-5 font-archivo-regular text-muted">
                    {picker.description}
                  </Text>
                ) : null}
                {picker?.options.map(([value, title]) => (
                  <SettingsRow
                    key={value}
                    title={title}
                    selected={picker.value === value}
                    onPress={() => {
                      setPicker(null);
                      picker.onSelect(value);
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
              <SettingsRow navigation title="Watching mode" icon={Tv} value={modeLabels[preferences.mode]} onPress={() => push("/watching-mode")} />
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Kids & family
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Kids & family mode"
                value={familyLevelLabels[preferences.familyLevel]}
                icon={Lock}
                onPress={() => push("/settings/family")}
              />
              <SettingsRow
                navigation
                title="Hidden titles"
                value={hidden.length ? String(hidden.length) : undefined}
                icon={EyeOff}
                onPress={() => push("/settings/hidden")}
              />
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Library
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow navigation title="Storage"
                icon={HardDrive}
                onPress={() => push("/storage")}
              />
              <SettingsRow
                navigation
                title="Watchlist"
                icon={ListVideo}
                onPress={() => push("/watchlist")}
              />
              {hasLocal && <>
              <SettingsRow
                navigation
                title="Library report"
                value={review ? `${review} to review` : undefined}
                icon={Library}
                onPress={() => navigate("/settings/report")}
              />
              <SettingsRow
                navigation
                title="Metadata & markers"
                icon={Film}
                onPress={() => push("/settings/metadata")}
              />
              <SettingsRow
                navigation
                title="Media folders"
                icon={Folder}
                onPress={() => push("/settings/folders")}
              />
              <SettingsRow
                title={localLibrary.scanning ? "Scanning…" : "Scan library"}
                icon={RefreshCw}
                onPress={
                  busy || localLibrary.scanning
                    ? undefined
                    : () => void action(() => localLibrary.scan())
                }
              />
              <SettingsRow navigation title="Reconnect media"
                icon={RefreshCw}
                onPress={() => push("/library-recovery")}
              />
              </>}
            </View>
            {hasLocal && localLibrary.issues.map((issue) => (
              <Notice key={issue} message={issue} />
            ))}
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Playback
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Playback settings"
                icon={Gauge}
                onPress={() => push("/settings/playback")}
              />
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              About
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <View className="border-b-[0.33px] border-border px-4 py-3.5">
                <View className="flex-row items-start gap-3.5">
                  <View className="h-5 w-6 items-center justify-center">
                    <Download size={20} color={colors.muted} />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-[15px] leading-5 font-archivo-medium text-foreground">
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
                </View>
                <View className="mt-3 flex-row gap-3">
                  <View className="flex-1">
                    <Button
                      label={appUpdateLabel}
                      primary={hasAppUpdate}
                      disabled={(!online && !otaPending) || updateChecking || updateDownloading}
                      onPress={() =>
                        void (hasAppUpdate
                          ? handleDownloadAndInstall()
                          : handleCheckUpdate())
                      }
                      className="min-h-11 w-full px-3 py-2.5"
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      label="Get from GitHub"
                      disabled={busy || !online}
                      onPress={() => void downloadFromGitHub()}
                      className="min-h-11 w-full px-3 py-2.5"
                    />
                  </View>
                </View>
              </View>
              <SettingsRow
                title="Open Source Licenses"
                navigation
                onPress={() => push("/settings/licenses")}
              />
            </View>
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
                        text: `${value} seconds`,
                        selected: preferences.seekSeconds === value,
                        onPress: () =>
                          updatePreferences({ seekSeconds: value }),
                      })),
                    ],
                  )
                }
              />
            </View>
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Audio and subtitles
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Preferred audio language"
                subtitle={mediaLanguageName(preferences.audioLanguage) || preferences.audioLanguage || "File default"}
                onPress={() => chooseTrackLanguage("audioLanguage", "Preferred audio language", "File default")}
              />
              <SettingsRow
                title="Automatic subtitles"
                subtitle="Show subtitles during local playback"
              >
                <ToggleSwitch
                  value={preferences.autoSubtitles}
                  onValueChange={(v) => updatePreferences({ autoSubtitles: v })}
                  accessibilityLabel="Automatic subtitles"
                />
              </SettingsRow>
              <SettingsRow
                navigation
                title="Preferred subtitle language"
                subtitle={mediaLanguageName(preferences.subtitleLanguage) || preferences.subtitleLanguage || "File default"}
                onPress={() => chooseTrackLanguage("subtitleLanguage", "Preferred subtitle language", "File default")}
              />
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
                title="Background play"
                subtitle="Keep listening when you leave the app or lock the screen"
              >
                <ToggleSwitch
                  value={preferences.backgroundPlay}
                  onValueChange={(v) => updatePreferences({ backgroundPlay: v })}
                  accessibilityLabel="Background play"
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
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Downloads
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                navigation
                title="Online downloads"
                subtitle="Save movies and episodes for offline playback"
                icon={Download}
                onPress={() => push("/settings/downloads")}
              />
            </View>
            </>}
          </>
        )}
        {page === "folders" && (
          <>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow title="Open a video" icon={Play} navigation onPress={() => push("/external-player")} />
            </View>
            {hasLocal && (!expandedFolder ? (
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
                        folderFiles && familyAllows(record.certification ?? record.card.certification, preferences.familyLevel, preferences.familyBlockUnrated) ? push({
                          pathname: "/player/[file-id]",
                          params: { "file-id": String(record.id), offline: "1" },
                        }) : push({
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
            ))}
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
                subtitle={online ? "Apply language, region and poster size to saved titles" : "Connect to the internet to refresh metadata"}
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
            <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
              Intro, recap & credits
            </Text>
            <View className="overflow-hidden rounded-[18px] bg-surface">
              <SettingsRow
                title="Community skip markers"
                subtitle="Save intro, recap and credit timings from IntroDB for offline playback"
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
                  markerStatus || (online ? `${markerCount} files have saved markers` : "Connect to the internet to refresh markers")
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
          </>
        )}
        {page === "family" && <FamilySettings />}
        {page === "hidden" && <HiddenTitlesSettings />}
        {page === "updates" && <Updates />}
      </ScrollView>
      </ScreenContent>
    </View>
  );
}
