import { useMemo, useState } from "react";
import {
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { localLibrary } from "@/core/library/local-runtime";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { Tappable } from "@/shared/ui/tappable";
import { useColors } from "@/shared/theme";
import {
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  type NativeIcon,
} from "@/shared/ui/icons";
import { cn } from "@/shared/lib/cn";
import { AccountSheet } from "./components/account-sheet";
import { useMovy } from "./movy-provider";
import { quotaLabel, resetLabel } from "./lib/account";
import { downloadsRoot } from "./lib/library-import";
import { hasNativeDownloads } from "./lib/native-downloads";
import type { MovyDownloadRecord, MovyTitleRef } from "./lib/types";

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function statusLabel(record: MovyDownloadRecord) {
  if (record.status === "queued") return "Queued";
  if (record.status === "downloading") {
    const percent = Math.min(99, Math.round(record.progress * 100));
    return `${percent}%${record.expectedBytes ? ` · ${formatSize(record.bytes)} of ${formatSize(record.expectedBytes)}` : ""}`;
  }
  if (record.status === "paused") {
    return record.error ? `Paused · ${record.error}` : "Paused";
  }
  if (record.status === "verifying") return "Adding to library…";
  if (record.status === "completed") return "In library";
  return record.error || "Failed";
}

function IconAction({
  label,
  onPress,
  icon: Icon,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  icon: NativeIcon;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={cn(
        "h-9 w-9 items-center justify-center rounded-full border border-border bg-surface active:opacity-70",
        danger && "border-danger/30 bg-danger/10",
      )}
    >
      <Icon size={16} color={danger ? colors.danger : colors.ink} />
    </Pressable>
  );
}

function DownloadRow({
  title,
  subtitle,
  value,
  onPress,
  children,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tappable
      feedback="highlight"
      disabled={!onPress || disabled}
      onPress={onPress}
      className={cn(
        "min-h-[62px] flex-row items-center gap-3 border-b-[0.33px] border-border px-4 py-3",
        disabled && "opacity-50",
      )}
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-archivo-medium text-[14px] text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text className="font-archivo-regular text-[11px] leading-[16px] text-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text className="max-w-[40%] text-right font-archivo-medium text-[12px] text-muted">
          {value}
        </Text>
      ) : null}
      {children}
    </Tappable>
  );
}

export function OnlineDownloadsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { preferences, updatePreferences } = useClient();
  const show = useAppDialog();
  const movy = useMovy();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...movy.downloads].sort((a, b) => b.createdAt - a.createdAt),
    [movy.downloads],
  );
  const active = sorted.filter(
    (record) =>
      record.status === "queued" ||
      record.status === "downloading" ||
      record.status === "paused" ||
      record.status === "verifying",
  );
  const failed = sorted.filter((record) => record.status === "failed");
  const completed = sorted.filter((record) => record.status === "completed");
  const storage = completed.reduce((sum, record) => sum + (record.bytes || 0), 0);

  const qualityLabel =
    preferences.movyMaxHeight === 2160
      ? "4K (2160p)"
      : `Up to ${preferences.movyMaxHeight}p`;

  const chooseQuality = () =>
    show(
      "Maximum download quality",
      "The best source at or below this is selected. If it is missing, the next available quality is used.",
      [
        {
          text: "4K (2160p)",
          onPress: () => updatePreferences({ movyMaxHeight: 2160 }),
        },
        {
          text: "1080p",
          onPress: () => updatePreferences({ movyMaxHeight: 1080 }),
        },
        {
          text: "720p",
          onPress: () => updatePreferences({ movyMaxHeight: 720 }),
        },
        {
          text: "480p",
          onPress: () => updatePreferences({ movyMaxHeight: 480 }),
        },
      ],
    );

  const chooseCap = () =>
    show(
      "Replacement account cap",
      "How many replacement accounts the app may create in 24 hours when the quota is reached.",
      [
        { text: "1 account", onPress: () => updatePreferences({ movyAccountCap: 1 }) },
        { text: "2 accounts", onPress: () => updatePreferences({ movyAccountCap: 2 }) },
        { text: "3 accounts", onPress: () => updatePreferences({ movyAccountCap: 3 }) },
      ],
    );

  const askNotifications = async () => {
    if (Platform.OS !== "android" || Number(Platform.Version) < 33) {
      setNotification("This Android version does not need notification permission.");
      return;
    }
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      setNotification(
        result === PermissionsAndroid.RESULTS.GRANTED
          ? "Download notifications are enabled."
          : "Notifications are blocked. Downloads will still run, but the progress notification is hidden.",
      );
    } catch {
      setNotification("Could not request notification permission.");
    }
  };

  const refreshQuota = () => {
    const record = sorted[0];
    if (!record) {
      setNotification("Open a title to check the quota.");
      return;
    }
    const ref: MovyTitleRef = {
      title: record.title,
      mediaType: record.mediaType,
      year: record.year,
      tmdbId: record.tmdbId,
      imdbId: record.imdbId,
      season: record.season,
      episode: record.episode,
    };
    void movy.refreshQuota(ref);
  };

  const remove = (record: MovyDownloadRecord) => {
    show(
      record.status === "completed" ? "Delete downloaded file?" : "Remove download?",
      record.status === "completed"
        ? "This removes the file from your library and from device storage."
        : "The partial download is removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: record.status === "completed" ? "Delete file" : "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (record.status === "completed" && record.libraryFileId != null) {
                await localLibrary
                  .deleteFiles([record.libraryFileId])
                  .catch(() => {});
              }
              await movy.remove(record.id);
            })();
          },
        },
      ],
    );
  };

  const recordCard = (record: MovyDownloadRecord) => (
    <View
      key={record.id}
      className="gap-3 rounded-[18px] border border-border bg-surface p-3"
    >
      <View className="flex-row gap-3">
        {record.poster ? (
          <Image
            source={{ uri: record.poster }}
            className="h-[84px] w-[56px] rounded-lg bg-surface-secondary"
          />
        ) : (
          <View className="h-[84px] w-[56px] items-center justify-center rounded-lg bg-surface-secondary">
            <Download size={20} color={colors.muted} />
          </View>
        )}
        <View className="flex-1 gap-0.5">
          <Text className="font-archivo-bold text-[14px] text-foreground" numberOfLines={1}>
            {record.title}
          </Text>
          {record.display !== record.title ? (
            <Text className="font-archivo-regular text-[11px] text-muted" numberOfLines={1}>
              {record.display}
            </Text>
          ) : null}
          <Text className="font-archivo-regular text-[11px] text-muted" numberOfLines={1}>
            {record.quality}
          </Text>
          <Text
            className={cn(
              "mt-0.5 font-archivo-medium text-[11px]",
              record.status === "failed" ? "text-danger" : "text-muted",
            )}
            numberOfLines={2}
          >
            {statusLabel(record)}
          </Text>
        </View>
        <View className="gap-2">
          {record.status === "downloading" || record.status === "queued" ? (
            <IconAction label="Pause download" icon={Pause} onPress={() => void movy.pause(record.id)} />
          ) : null}
          {record.status === "paused" ? (
            <IconAction label="Resume download" icon={Play} onPress={() => void movy.resume(record.id)} />
          ) : null}
          {record.status === "failed" ? (
            <IconAction label="Retry download" icon={RotateCcw} onPress={() => void movy.retry(record.id)} />
          ) : null}
          {record.status === "completed" && record.libraryFileId != null ? (
            <IconAction
              label="Play downloaded file"
              icon={Play}
              onPress={() =>
                router.push({
                  pathname: "/player/[file-id]",
                  params: { "file-id": String(record.libraryFileId), offline: "1" },
                })
              }
            />
          ) : null}
          <IconAction
            label="Remove download"
            icon={Trash2}
            danger
            onPress={() => remove(record)}
          />
        </View>
      </View>
      {record.status === "downloading" || record.status === "paused" ? (
        <View className="h-1 overflow-hidden rounded-full bg-surface-secondary">
          <View
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(record.progress * 100)}%` }}
          />
        </View>
      ) : null}
      <View className="flex-row items-center justify-between">
        <Text className="font-archivo-regular text-[11px] text-muted">
          {record.accountUsername ? `Account ${record.accountUsername}` : ""}
        </Text>
        <Text className="font-archivo-regular text-[11px] text-muted">
          {record.bytes ? formatSize(record.bytes) : ""}
        </Text>
      </View>
    </View>
  );

  return (
    <View className="flex-1">
      <PageHeader
        title="Online downloads"
        subtitle={movy.active ? movy.active.username : "No download account"}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {movy.error ? <Notice kind="error" message={movy.error} /> : null}
        {notification ? <Notice message={notification} /> : null}

        <View className="gap-3 rounded-[18px] border border-border bg-surface p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-accent/15">
              <Download size={20} color={colors.brand} />
            </View>
            <View className="flex-1">
              <Text className="font-archivo-bold text-[15px] text-foreground">
                {movy.active ? movy.active.username : "Download account"}
              </Text>
              <Text className="font-archivo-regular text-[12px] text-muted">
                {movy.active
                  ? quotaLabel(movy.active.quota)
                  : "Create or sign in to download from Movy."}
                {movy.active && resetLabel(movy.active.quota)
                  ? ` · ${resetLabel(movy.active.quota)}`
                  : ""}
              </Text>
            </View>
            <Button
              label={movy.active ? "Manage" : "Set up"}
              onPress={() => {
                movy.clearError();
                setAccountOpen(true);
              }}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="font-archivo-regular text-[11px] text-muted">
              {completed.length} downloaded · {formatSize(storage)}
            </Text>
            <Pressable onPress={refreshQuota} accessibilityRole="button">
              <Text className="font-archivo-medium text-[12px] text-accent">
                Refresh quota
              </Text>
            </Pressable>
          </View>
        </View>

        <Text className="ml-[2px] font-archivo-medium text-[13px] text-muted">
          Downloads
        </Text>
        {active.length || failed.length || completed.length ? (
          <View className="gap-3">
            {[...active, ...failed, ...completed].map(recordCard)}
          </View>
        ) : (
          <View className="items-center gap-2 rounded-[18px] border border-border bg-surface px-5 py-10">
            <Download size={26} color={colors.muted} />
            <Text className="font-archivo-medium text-[14px] text-foreground">
              No downloads yet
            </Text>
            <Text className="text-center font-archivo-regular text-[12px] leading-[18px] text-muted">
              Open an online movie or episode and tap the download button.
            </Text>
          </View>
        )}

        <Text className="ml-[2px] mt-2 font-archivo-medium text-[13px] text-muted">
          Download settings
        </Text>
        <View className="overflow-hidden rounded-[18px] bg-surface">
          <DownloadRow
            title="Maximum quality"
            subtitle="Best source at or below this"
            value={qualityLabel}
            onPress={chooseQuality}
          />
          <DownloadRow
            title="Wi-Fi only"
            subtitle="Pause when mobile data is active"
          >
            <ToggleSwitch
              value={preferences.movyWifiOnly}
              onValueChange={(value) => updatePreferences({ movyWifiOnly: value })}
              accessibilityLabel="Wi-Fi only downloads"
            />
          </DownloadRow>
          <DownloadRow
            title="Fast downloads"
            subtitle="Use multiple range requests when available"
          >
            <ToggleSwitch
              value={preferences.movyMultiStream}
              onValueChange={(value) => updatePreferences({ movyMultiStream: value })}
              accessibilityLabel="Fast downloads"
            />
          </DownloadRow>
          <DownloadRow
            title="Background downloads"
            subtitle={
              hasNativeDownloads()
                ? "Continue after leaving Plexy"
                : "Requires the native app build"
            }
            disabled={!hasNativeDownloads()}
          >
            <ToggleSwitch
              value={preferences.movyBackgroundDownloads && hasNativeDownloads()}
              onValueChange={(value) =>
                updatePreferences({ movyBackgroundDownloads: value })
              }
              accessibilityLabel="Background downloads"
            />
          </DownloadRow>
          <DownloadRow
            title="Download notifications"
            subtitle="Progress and pause/cancel from the notification"
            onPress={() => void askNotifications()}
          />
          <DownloadRow
            title="Auto-create replacement account"
            subtitle={`On a quota hit, create a new account (max ${preferences.movyAccountCap} per 24 h)`}
          >
            <ToggleSwitch
              value={preferences.movyAutoCreateAccount}
              onValueChange={(value) =>
                updatePreferences({ movyAutoCreateAccount: value })
              }
              accessibilityLabel="Auto-create replacement account"
            />
          </DownloadRow>
          {preferences.movyAutoCreateAccount ? (
            <DownloadRow
              title="Replacement account cap"
              subtitle="Per 24 hours"
              value={String(preferences.movyAccountCap)}
              onPress={chooseCap}
            />
          ) : null}
          <DownloadRow
            title="Download folder"
            subtitle="Where Plexy saves movies and TV shows"
            value={downloadsRoot().uri.replace("file://", "")}
          />
        </View>

        <Text className="px-1 font-archivo-regular text-[11px] leading-[16px] text-muted">
          Downloads use a separate Movy account and count against its quota.
          Each account has its own download limit. Plexy is not affiliated
          with Movy.
        </Text>
      </ScrollView>

      <AccountSheet
        key={accountOpen ? "account-open" : "account-closed"}
        visible={accountOpen}
        onClose={() => setAccountOpen(false)}
      />
    </View>
  );
}
