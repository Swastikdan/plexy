import React, { useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as FS from "expo-file-system/legacy";
import { Check, Download, Film, Pause, Play, RotateCcw, Trash2, Tv, AlertCircle } from "lucide-react-native";
import { useClient, useDownloads } from "../../../../packages/native-client/src/context";
import { useResource } from "../../../../packages/native-client/src/hooks";
import { Button, Heading, Label, Loading, Notice } from "../components/ui";
import { colors, fonts, sizeLabel } from "../ui/theme";
import type { ItemCard } from "../../../../packages/native-client/src/api";
import type { DownloadEntry } from "../../../../packages/native-client/src/downloads";

export function DownloadsScreen({
  play,
  back,
}: {
  play: (entry: DownloadEntry) => void;
  back?: () => void;
}) {
  const { api, downloads, preferences, platform } = useClient();
  const entries = useDownloads();
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "completed" | "downloading">("all");
  const free = useResource(
    () => FS.getFreeDiskStorageAsync(),
    [entries.length],
  );

  const action = (fn: () => Promise<void>) => {
    void fn().catch((e) =>
      setError(
        e instanceof Error ? e.message : "Could not change this download.",
      ),
    );
  };

  const totalBytes = entries.reduce((acc, e) => acc + (e.bytes || 0), 0);
  const completedEntries = entries.filter((e) => e.state === "completed");
  const activeEntries = entries.filter(
    (e) => e.state === "downloading" || e.state === "queued",
  );

  const visibleEntries =
    filter === "completed"
      ? completedEntries
      : filter === "downloading"
        ? activeEntries
        : entries;

  // Group entries: TV Shows grouped by Series and Season, Movies grouped separately
  const seriesGroups = new Map<string, {
    title: string;
    posterUri?: string;
    seasons: Map<number, DownloadEntry[]>;
  }>();
  const movieEntries: DownloadEntry[] = [];

  visibleEntries.forEach((entry) => {
    const isEpisode = entry.item.kind === "episode" || entry.seriesName != null || entry.seasonNumber != null;
    if (isEpisode) {
      const seriesKey = entry.seriesName || (entry.item as any).parentName || entry.item.name.split(" - ")[0] || "TV Shows";
      if (!seriesGroups.has(seriesKey)) {
        seriesGroups.set(seriesKey, {
          title: seriesKey,
          posterUri: entry.localPosterUri || (entry.item.poster?.startsWith("file://") ? entry.item.poster : undefined),
          seasons: new Map<number, DownloadEntry[]>(),
        });
      }
      const group = seriesGroups.get(seriesKey)!;
      if (!group.posterUri && entry.localPosterUri) {
        group.posterUri = entry.localPosterUri;
      }
      const seasonNum = entry.seasonNumber ?? (entry.item as any).seasonNumber ?? 1;
      if (!group.seasons.has(seasonNum)) {
        group.seasons.set(seasonNum, []);
      }
      group.seasons.get(seasonNum)!.push(entry);
    } else {
      movieEntries.push(entry);
    }
  });

  return (
    <ScrollView
      contentContainerStyle={{ padding: platform.tv ? 32 : 18, gap: 18 }}
      showsVerticalScrollIndicator={false}
    >
      {back && (
        <View style={{ marginBottom: 2 }}>
          <Button label="Back" icon="back" onPress={back} />
        </View>
      )}

      {/* Header */}
      <View style={{ gap: 6 }}>
        <Heading large>Downloads</Heading>
        <Text style={dlStyles.storageMeta}>
          {sizeLabel(totalBytes)} used · {free.value != null ? `${sizeLabel(free.value)} free` : ""}
          {preferences.wifiOnly ? " · Wi-Fi only" : " · Mobile data allowed"}
        </Text>
      </View>

      {/* Filter Tabs */}
      {entries.length > 0 && (
        <View style={dlStyles.filterRow}>
          <Pressable
            onPress={() => setFilter("all")}
            style={[dlStyles.filterChip, filter === "all" && dlStyles.filterChipActive]}
          >
            <Text style={[dlStyles.filterChipText, filter === "all" && dlStyles.filterChipTextActive]}>
              All ({entries.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter("completed")}
            style={[dlStyles.filterChip, filter === "completed" && dlStyles.filterChipActive]}
          >
            <Text style={[dlStyles.filterChipText, filter === "completed" && dlStyles.filterChipTextActive]}>
              Downloaded ({completedEntries.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter("downloading")}
            style={[dlStyles.filterChip, filter === "downloading" && dlStyles.filterChipActive]}
          >
            <Text style={[dlStyles.filterChipText, filter === "downloading" && dlStyles.filterChipTextActive]}>
              Active ({activeEntries.length})
            </Text>
          </Pressable>
        </View>
      )}

      {!!downloads.storageError && <Notice message={downloads.storageError} />}
      {!!error && <Notice message={error} />}

      {!entries.length && (
        <View style={dlStyles.emptyCard}>
          <Download size={42} color={colors.muted} />
          <Text style={dlStyles.emptyTitle}>No downloads yet</Text>
          <Text style={dlStyles.emptyDesc}>
            Download movies or entire TV seasons from any title's details page to enjoy smooth offline playback anywhere.
          </Text>
        </View>
      )}

      {/* TV Series Sections */}
      {[...seriesGroups.entries()].map(([seriesTitle, group]) => {
        const totalEps = [...group.seasons.values()].reduce((n, eps) => n + eps.length, 0);

        return (
          <View key={seriesTitle} style={dlStyles.seriesCard}>
            {/* Series Header */}
            <View style={dlStyles.seriesHeader}>
              {group.posterUri ? (
                <Image
                  source={{ uri: group.posterUri }}
                  style={dlStyles.seriesThumb}
                  resizeMode="cover"
                />
              ) : (
                <View style={[dlStyles.seriesThumb, { backgroundColor: "#1e1e24", alignItems: "center", justifyContent: "center" }]}>
                  <Tv size={20} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={dlStyles.seriesTitle}>{seriesTitle}</Text>
                <Text style={dlStyles.seriesMeta}>
                  {group.seasons.size} Season{group.seasons.size === 1 ? "" : "s"} · {totalEps} Episode{totalEps === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {/* Seasons */}
            {[...group.seasons.entries()]
              .sort(([a], [b]) => a - b)
              .map(([seasonNum, seasonEps]) => (
                <View key={seasonNum} style={dlStyles.seasonWrap}>
                  <Text style={dlStyles.seasonHeader}>Season {seasonNum}</Text>
                  <View style={{ gap: 10 }}>
                    {seasonEps
                      .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
                      .map((entry) => (
                        <DownloadEntryRow
                          key={entry.id}
                          entry={entry}
                          api={api}
                          play={play}
                          action={action}
                          downloads={downloads}
                        />
                      ))}
                  </View>
                </View>
              ))}
          </View>
        );
      })}

      {/* Movies Section */}
      {movieEntries.length > 0 && (
        <View style={dlStyles.seriesCard}>
          <View style={dlStyles.seriesHeader}>
            <View style={[dlStyles.seriesThumb, { backgroundColor: "#1e1e24", alignItems: "center", justifyContent: "center" }]}>
              <Film size={20} color={colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={dlStyles.seriesTitle}>Movies</Text>
              <Text style={dlStyles.seriesMeta}>{movieEntries.length} downloaded movie{movieEntries.length === 1 ? "" : "s"}</Text>
            </View>
          </View>

          <View style={{ gap: 10, padding: 14 }}>
            {movieEntries.map((entry) => (
              <DownloadEntryRow
                key={entry.id}
                entry={entry}
                api={api}
                play={play}
                action={action}
                downloads={downloads}
              />
            ))}
          </View>
        </View>
      )}

      {/* Clear All button */}
      {!!entries.length && (
        <View style={{ marginTop: 10, marginBottom: 20 }}>
          <Button
            label="Remove all downloads"
            onPress={() =>
              Alert.alert(
                "Remove all downloads?",
                "This removes saved media and unfinished downloads for this account on this device.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Remove all",
                    style: "destructive",
                    onPress: () => action(() => downloads.clear()),
                  },
                ],
              )
            }
          />
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Download Entry Row Component
// ---------------------------------------------------------------------------

function DownloadEntryRow({
  entry,
  api,
  play,
  action,
  downloads,
}: {
  entry: DownloadEntry;
  api: any;
  play: (entry: DownloadEntry) => void;
  action: (fn: () => Promise<void>) => void;
  downloads: any;
}) {
  const percent =
    entry.state === "completed"
      ? 100
      : entry.expected
        ? Math.min(100, Math.round((entry.bytes / entry.expected) * 100))
        : 0;

  const posterSource = entry.localPosterUri
    ? { uri: entry.localPosterUri }
    : entry.item.poster?.startsWith("file://")
      ? { uri: entry.item.poster }
      : api.image(entry.item.poster);

  const cleanTitle = (entry.item.name || "Media")
    .replace(/^.* - (S\d+E\d+) - /, "$1 · ")
    .replace(/^.* - /, "");

  return (
    <View style={dlStyles.entryRow}>
      {/* Thumbnail with status badge */}
      <View style={dlStyles.thumbWrap}>
        {posterSource ? (
          <Image source={posterSource} style={dlStyles.entryThumb} resizeMode="cover" />
        ) : (
          <View style={[dlStyles.entryThumb, { backgroundColor: "#1e1e24" }]} />
        )}
        {entry.state === "completed" && (
          <View style={dlStyles.completedBadge}>
            <Check size={11} color="#000" strokeWidth={3} />
          </View>
        )}
      </View>

      {/* Details */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={dlStyles.entryTitle} numberOfLines={1}>
          {cleanTitle}
        </Text>

        <Text style={dlStyles.entryMeta}>
          {entry.state === "completed"
            ? `${sizeLabel(entry.bytes)} · ${entry.label || "Source"}`
            : entry.state === "downloading"
              ? `Downloading ${percent}% (${sizeLabel(entry.bytes)} / ${sizeLabel(entry.expected || 0)})`
              : entry.state === "queued"
                ? "Queued in download queue"
                : entry.state === "paused"
                  ? `Paused at ${percent}%`
                  : "Download failed"}
        </Text>

        {/* Progress bar */}
        {entry.state !== "completed" && (
          <View style={dlStyles.progressBar}>
            <View
              style={[
                dlStyles.progressFill,
                { width: `${percent}%` },
                entry.state === "failed" && { backgroundColor: "#e04f5f" },
              ]}
            />
          </View>
        )}

        {!!entry.error && (
          <Text style={dlStyles.entryError} numberOfLines={2}>
            {entry.error}
          </Text>
        )}

        {/* Action buttons */}
        <View style={dlStyles.actionRow}>
          {entry.state === "completed" ? (
            <Pressable
              onPress={() => play(entry)}
              style={({ pressed }) => [dlStyles.playBtn, pressed && { opacity: 0.8 }]}
            >
              <Play size={13} color="#000" fill="#000" />
              <Text style={dlStyles.playBtnText}>Play offline</Text>
            </Pressable>
          ) : entry.state === "downloading" || entry.state === "queued" ? (
            <Pressable
              onPress={() => action(() => downloads.pause(entry.id))}
              style={({ pressed }) => [dlStyles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Pause size={13} color="#fff" />
              <Text style={dlStyles.actionBtnText}>Pause</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => action(() => downloads.retry(entry.id))}
              style={({ pressed }) => [dlStyles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <RotateCcw size={13} color="#fff" />
              <Text style={dlStyles.actionBtnText}>Retry</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() =>
              Alert.alert(
                "Remove download?",
                `Remove ${cleanTitle} from this device?`,
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Remove",
                    style: "destructive",
                    onPress: () => action(() => downloads.remove(entry.id)),
                  },
                ],
              )
            }
            style={({ pressed }) => [dlStyles.deleteBtn, pressed && { opacity: 0.8 }]}
            hitSlop={8}
          >
            <Trash2 size={14} color="#888" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const dlStyles = StyleSheet.create({
  storageMeta: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  filterChipActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  filterChipText: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.medium,
  },
  filterChipTextActive: {
    color: "#000000",
    fontFamily: fonts.bold,
  },
  emptyCard: {
    padding: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 12,
    marginTop: 20,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  emptyDesc: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 320,
    fontFamily: fonts.regular,
  },
  seriesCard: {
    backgroundColor: "#111114",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  seriesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  seriesThumb: {
    width: 44,
    height: 62,
    borderRadius: 6,
  },
  seriesTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  seriesMeta: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  seasonWrap: {
    padding: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  seasonHeader: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: fonts.bold,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  entryRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 10,
    borderRadius: 8,
  },
  thumbWrap: {
    position: "relative",
  },
  entryThumb: {
    width: 60,
    height: 84,
    borderRadius: 6,
  },
  completedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#34C759",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  entryTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  entryMeta: {
    color: colors.muted,
    fontSize: 11.5,
    fontFamily: fonts.regular,
  },
  entryError: {
    color: "#ff6b6b",
    fontSize: 11,
    fontFamily: fonts.regular,
  },
  progressBar: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    overflow: "hidden",
    marginVertical: 2,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.brand,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  playBtnText: {
    color: "#000000",
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  deleteBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
});
export function DownloadPicker({
  item,
  fileId,
  close,
}: {
  item: ItemCard;
  fileId: number;
  close: () => void;
}) {
  const { api, downloads, platform, preferences } = useClient();
  const manifest = useResource(() => api.play(fileId), [api, fileId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generate, setGenerate] = useState<number | null>(null);
  async function enqueue(id: number, label: string, maxHeight?: number) {
    if (!manifest.value) return;
    setBusy(true);
    setError("");
    try {
      const selected =
        id === manifest.value.fileId ? manifest.value : await api.play(id);
      await downloads.enqueue(item, selected, id, label, maxHeight);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this download.");
    } finally {
      setBusy(false);
    }
  }
  const versions = manifest.value?.versions || [];
  const best = versions[0];
  const caps = [360, 480, 720, 1080, 1440, 2160];
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <View
        style={{
          flex: 1,
          padding: 24,
          backgroundColor: "rgba(0,0,0,0.8)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <platform.FocusGroup
          style={{
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: colors.strong,
            borderRadius: 20,
            overflow: "hidden",
            width: "100%",
            maxWidth: 660,
            maxHeight: "90%",
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
            <Heading>Download {item.name}</Heading>
            {manifest.loading ? (
              <Loading />
            ) : manifest.error ? (
              <Notice message={manifest.error} retry={manifest.retry} />
            ) : (
              <>
                <Label muted>
                  {versions.length > 1
                    ? "Choose a resolution for download."
                    : "Download source media file directly to your device."}
                </Label>
                {versions.map((version, index) => (
                  <Button
                    key={version.fileId}
                    label={`${index === 0 ? "Best quality · " : ""}${version.label} · ${sizeLabel(version.size)}`}
                    primary={
                      preferences.defaultDownloadHeight
                        ? version.height === preferences.defaultDownloadHeight
                        : index === 0
                    }
                    disabled={busy}
                    onPress={() => void enqueue(version.fileId, version.label)}
                  />
                ))}
                {!versions.length && (
                  <Button
                    label="Original source"
                    disabled={busy}
                    onPress={() => void enqueue(fileId, "Original source")}
                  />
                )}
                {/* Only show other resolutions if the server actually has multiple pre-generated versions */}
                {versions.length > 1 && (
                  <>
                    <Heading>Available resolutions</Heading>
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {versions.map((v) => (
                        <Button
                          key={v.fileId}
                          label={`${v.height ? `${v.height}p` : v.label}`}
                          disabled={busy}
                          onPress={() => void enqueue(v.fileId, v.label)}
                        />
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
            {!!error && <Notice message={error} />}
            <Button
              label={busy ? "Adding…" : "Close"}
              disabled={busy}
              onPress={close}
            />
          </ScrollView>
        </platform.FocusGroup>
      </View>
    </Modal>
  );
}
