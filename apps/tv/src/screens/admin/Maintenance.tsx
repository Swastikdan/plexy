import React, { useState } from "react";
import { View } from "react-native";
import type {
  ItemCard,
  OptimizerStatus,
  ServerStatus,
  StreamPreparationStatus,
} from "../../../../../packages/api-client/src/types";
import { useClient } from "../../../../../packages/native-client/src/context";
import { useResource } from "../../../../../packages/native-client/src/hooks";
import { Button, Field, Heading, Label } from "../../components/ui";
import { sizeLabel } from "../../ui/theme";
import {
  confirmAction,
  Feedback,
  Group,
  Refresh,
  ResourceState,
  useAdminAction,
} from "./shared";

type Artwork = {
  originalsCount: number;
  derivedCount: number;
  totalBytes: number;
};
export function AdminMaintenance() {
  const { api } = useClient();
  const status = useResource(
    (signal) => api.request<ServerStatus>("/api/server/status", { signal }),
    [api],
  );
  const optimizer = useResource(
    (signal) =>
      api.request<OptimizerStatus>("/api/optimize/status", { signal }),
    [api],
  );
  const streams = useResource(
    (signal) =>
      api.request<StreamPreparationStatus>("/api/stream-preparation/status", {
        signal,
      }),
    [api],
  );
  const artwork = useResource(
    (signal) => api.request<Artwork>("/api/admin/artwork/storage", { signal }),
    [api],
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const titles = useResource(
    (signal) =>
      api.request<{ items: ItemCard[] }>(
        `/api/items?limit=100&q=${encodeURIComponent(query)}`,
        { signal },
      ),
    [api, query],
  );
  const [selected, setSelected] = useState<ItemCard[]>([]);
  const [phrase, setPhrase] = useState("");
  const refresh = () => {
    status.retry();
    optimizer.retry();
    streams.retry();
    artwork.retry();
  };
  const action = useAdminAction(refresh);
  return (
    <View style={{ gap: 12 }}>
      <Heading>Server status and maintenance</Heading>
      <Refresh onPress={refresh} />
      <Feedback action={action} />
      <ResourceState resource={status} />
      {status.value && (
        <Group title="Server">
          <Label>
            Version {status.value.version} · Bun {status.value.bun ?? "Unknown"}
          </Label>
          <Label>
            Uptime: {Math.floor((status.value.uptimeSeconds ?? 0) / 60)} minutes
          </Label>
          <Label>
            Listening on {status.value.bind}:{status.value.port}
          </Label>
          {status.value.restartRequired && (
            <Label>
              Restart the server on its computer to apply the saved network
              setting.
            </Label>
          )}
          {status.value.lanUrls?.map((url) => (
            <Label key={url}>{url}</Label>
          ))}
          {status.value.scan && (
            <Label>
              Scan: {status.value.scan.status}, {status.value.scan.filesSeen}{" "}
              files, {status.value.scan.issues} issues
            </Label>
          )}
          {status.value.recentScans?.map((scan) => (
            <Label key={scan.id}>
              Scan {scan.id}: {scan.status} · {scan.files_seen ?? 0} files ·{" "}
              {scan.issues ?? 0} issues
            </Label>
          ))}
        </Group>
      )}
      <Group title="Optimized media">
        <ResourceState resource={optimizer} />
        {optimizer.value && (
          <>
            <Label>
              {optimizer.value.running
                ? "Running"
                : optimizer.value.paused
                  ? "Paused"
                  : "Idle"}{" "}
              · {optimizer.value.queued} queued ·{" "}
              {sizeLabel(optimizer.value.cacheBytes)} cached
            </Label>
            {optimizer.value.current && (
              <Label>
                File {optimizer.value.current.fileId}:{" "}
                {Math.round(optimizer.value.current.progress * 100)}%
              </Label>
            )}
            {Object.entries(optimizer.value.counts).map(([key, count]) => (
              <Label key={key}>
                {key}: {count}
              </Label>
            ))}
            {optimizer.value.files?.map((file) => (
              <Label key={file.id}>
                {file.title ?? file.path} · {sizeLabel(file.optimizedSize)}
              </Label>
            ))}
          </>
        )}
        <Button
          label="Prepare optimized media / retry failures"
          disabled={action.busy}
          onPress={() => {
            void action.run(
              "/api/optimize/run",
              "POST",
              undefined,
              "Optimization requested. Refresh to check progress.",
            );
          }}
        />
        <Button
          label="Clear optimized media cache"
          disabled={action.busy}
          onPress={() =>
            confirmAction(
              "Clear optimized copies?",
              "Prepared copies will be deleted. Original media files stay on the server.",
              () => {
                void action.run("/api/optimize/clear");
              },
            )
          }
        />
      </Group>
      <Group title="Adaptive streams">
        <ResourceState resource={streams} />
        {streams.value && (
          <>
            <Label>
              {streams.value.ready} ready · {streams.value.queued} queued ·{" "}
              {streams.value.running} running · {streams.value.failed} failed ·{" "}
              {streams.value.cancelled} cancelled
            </Label>
            {streams.value.current && (
              <Label>
                {streams.value.current.title}:{" "}
                {Math.round(streams.value.current.progress * 100)}%
              </Label>
            )}
            {streams.value.error && <Label>{streams.value.error}</Label>}
          </>
        )}
        <Field
          label="Find titles to prepare"
          value={search}
          onChangeText={setSearch}
        />
        <Button label="Search titles" onPress={() => setQuery(search.trim())} />
        <ResourceState
          resource={titles}
          empty={
            titles.value?.items.length === 0 ? "No titles found." : undefined
          }
        />
        <Label>
          {selected.length} titles selected. Showing up to 100 results; narrow
          the search to find more.
        </Label>
        {titles.value?.items.map((title) => (
          <Button
            key={title.id}
            label={title.name}
            selected={selected.some((item) => item.id === title.id)}
            onPress={() =>
              setSelected((previous) =>
                previous.some((item) => item.id === title.id)
                  ? previous.filter((item) => item.id !== title.id)
                  : [...previous, title],
              )
            }
          />
        ))}
        <Button
          label="Clear selection"
          disabled={!selected.length}
          onPress={() => setSelected([])}
        />
        <Button
          label="Prepare selected titles"
          disabled={action.busy || !selected.length}
          onPress={() => {
            void action.run(
              "/api/stream-preparation/run",
              "POST",
              { itemIds: selected.map((item) => item.id) },
              "Preparation requested. Refresh to check progress.",
            );
          }}
        />
        <Button
          label="Cancel stream preparation"
          disabled={
            action.busy ||
            !streams.value ||
            !(streams.value.running || streams.value.queued)
          }
          onPress={() =>
            confirmAction(
              "Cancel stream preparation?",
              "Queued and running stream preparation will stop.",
              () => {
                void action.run("/api/stream-preparation/cancel");
              },
            )
          }
        />
      </Group>
      <Group title="Artwork and metadata">
        <ResourceState resource={artwork} />
        {artwork.value && (
          <Label>
            {artwork.value.originalsCount} originals ·{" "}
            {artwork.value.derivedCount} derived images ·{" "}
            {sizeLabel(artwork.value.totalBytes)}
          </Label>
        )}
        <Button
          label="Cache all missing artwork"
          disabled={action.busy}
          onPress={() => {
            void action.run(
              "/api/admin/artwork/cache-all",
              "POST",
              undefined,
              "Artwork caching started. Refresh to check storage.",
            );
          }}
        />
        <Button
          label="Refresh intro and credits markers"
          disabled={action.busy}
          onPress={() => {
            void action.run("/api/skip-segments/refresh");
          }}
        />
        <Button
          label="Clear metadata response cache"
          disabled={action.busy}
          onPress={() =>
            confirmAction(
              "Clear metadata cache?",
              "Future metadata lookups will request fresh results. Saved library matches stay intact.",
              () => {
                void action.run("/api/tmdb/cache/clear");
              },
            )
          }
        />
      </Group>
      <Group title="Reset library data">
        <Label muted>
          This removes indexed titles, watch history, artwork and prepared
          copies. Library folders, accounts, settings and original media stay
          intact. Rescan libraries afterward.
        </Label>
        <Field
          label="Type RESET to continue"
          value={phrase}
          onChangeText={setPhrase}
          autoCapitalize="characters"
        />
        <Button
          label="Reset library data"
          disabled={action.busy || phrase !== "RESET"}
          onPress={() =>
            confirmAction(
              "Reset library data?",
              "This cannot be undone. All indexed titles and watch history will be removed.",
              () => {
                void action
                  .run(
                    "/api/database/reset",
                    "POST",
                    undefined,
                    "Library data reset. Rescan your libraries to rebuild the catalog.",
                  )
                  .then((result) => {
                    if (result) {
                      setPhrase("");
                      setSelected([]);
                      titles.retry();
                    }
                  });
              },
            )
          }
        />
      </Group>
    </View>
  );
}
