import React, { useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";
import * as FS from "expo-file-system/legacy";
import { useClient, useDownloads } from "./context";
import { useResource } from "./hooks";
import { Button, Heading, Label, Loading, Notice } from "./ui";
import { colors, sizeLabel } from "./theme";
import type { ItemCard } from "./api";
import type { DownloadEntry } from "./downloads";
export function DownloadsScreen({
  play,
  back,
}: {
  play: (entry: DownloadEntry) => void;
  back?: () => void;
}) {
  const { downloads, preferences, platform } = useClient();
  const entries = useDownloads();
  const [error, setError] = useState("");
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
  return (
    <ScrollView
      contentContainerStyle={{ padding: platform.tv ? 32 : 20, gap: 20 }}
    >
      {back && (
        <View style={{ marginBottom: 4 }}>
          <Button label="Back" icon="back" onPress={back} />
        </View>
      )}
      <Heading large>Downloads</Heading>
      <Label muted>
        {free.value != null
          ? `${sizeLabel(free.value)} free on this device. `
          : ""}
        {preferences.wifiOnly
          ? "Transfers use Wi-Fi or Ethernet."
          : "Transfers may use mobile data."}
      </Label>
      <Label muted>
        Keep the app open while downloading. Source downloads can resume after
        pausing. Generated downloads restart when interrupted.
      </Label>
      {!!downloads.storageError && <Notice message={downloads.storageError} />}
      {!!error && <Notice message={error} />}
      {!entries.length && (
        <Notice message="No downloads yet. Open a movie or episode and choose Download." />
      )}
      {entries.map((entry) => (
        <View
          key={entry.id}
          style={{
            paddingVertical: 20,
            gap: 12,
            borderTopWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Heading>{entry.item.name}</Heading>
          <Label muted>
            {entry.label} · {entry.state} · {sizeLabel(entry.bytes)}
            {entry.expected ? ` / ${sizeLabel(entry.expected)}` : ""}
          </Label>
          <View style={{ height: 3, backgroundColor: colors.strong }}>
            <View
              style={{
                height: 3,
                backgroundColor: colors.ink,
                width: `${entry.state === "completed" ? 100 : entry.expected ? Math.min(100, (entry.bytes / entry.expected) * 100) : 0}%`,
              }}
            />
          </View>
          {!!entry.error && <Label>{entry.error}</Label>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {entry.state === "completed" ? (
              <Button
                label="Play offline"
                primary
                icon="play"
                onPress={() => play(entry)}
              />
            ) : entry.state === "downloading" || entry.state === "queued" ? (
              <Button
                label="Pause"
                icon="pause"
                onPress={() => action(() => downloads.pause(entry.id))}
              />
            ) : (
              <Button
                label={entry.maxHeight ? "Restart download" : "Resume / retry"}
                onPress={() => action(() => downloads.retry(entry.id))}
              />
            )}
            <Button
              label={
                entry.state === "completed"
                  ? "Delete download"
                  : "Cancel download"
              }
              onPress={() =>
                Alert.alert(
                  "Remove download?",
                  `Remove ${entry.item.name} from this device?`,
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
            />
          </View>
        </View>
      ))}
      {!!entries.length && (
        <Button
          label="Remove all downloads"
          onPress={() =>
            Alert.alert(
              "Remove all downloads?",
              "This removes saved media and unfinished downloads for this account on this server.",
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
      )}
    </ScrollView>
  );
}
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
                  Choose a source version, or ask your server to generate a
                  smaller file. Default:{" "}
                  {preferences.defaultDownloadHeight
                    ? `${preferences.defaultDownloadHeight}p`
                    : "best available"}
                  .
                </Label>
                {versions.map((version, index) => (
                  <Button
                    key={version.fileId}
                    label={`${index === 0 ? "Best available · " : ""}${version.label} · ${sizeLabel(version.size)}`}
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
                <Heading>Other resolutions</Heading>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {caps.map((height) => (
                    <Button
                      key={height}
                      label={`${height}p`}
                      disabled={busy}
                      onPress={() => {
                        const existing = versions.find(
                          (v) => v.height === height,
                        );
                        if (existing)
                          void enqueue(existing.fileId, existing.label);
                        else setGenerate(height);
                      }}
                    />
                  ))}
                </View>
                {generate && (
                  <View
                    style={{
                      gap: 12,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: colors.strong,
                    }}
                  >
                    <Label>
                      Your server will convert this file while transferring, up
                      to {generate}p without upscaling. This can take
                      significant CPU/GPU time. If interrupted, this generated
                      download restarts from the beginning. Output size is not
                      known in advance.
                    </Label>
                    <Button
                      label={`Generate up to ${generate}p and download`}
                      disabled={busy}
                      onPress={() =>
                        void enqueue(
                          best?.fileId || fileId,
                          `Generated up to ${generate}p`,
                          generate,
                        )
                      }
                    />
                    <Button
                      label="Use best available source instead"
                      disabled={busy}
                      onPress={() =>
                        void enqueue(
                          best?.fileId || fileId,
                          best?.label || "Original source",
                        )
                      }
                    />
                    <Button
                      label="Cancel generation"
                      disabled={busy}
                      onPress={() => setGenerate(null)}
                    />
                  </View>
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
