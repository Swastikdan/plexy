import React, { useState } from "react";
import { View } from "react-native";
import type {
  LibraryItem,
  LocalFoldersResponse,
} from "../../../../../packages/api-client/src/types";
import { useClient } from "../../../../../packages/native-client/src/context";
import { useResource } from "../../../../../packages/native-client/src/hooks";
import { Button, Field, Heading, Label } from "../../components/ui";
import {
  confirmAction,
  Feedback,
  Group,
  Refresh,
  ResourceState,
  useAdminAction,
} from "./shared";

export function AdminLibraries() {
  const { api } = useClient();
  const resource = useResource(
    (signal) =>
      api.request<{ libraries: LibraryItem[] }>("/api/libraries", { signal }),
    [api],
  );
  const status = useResource(
    (signal) =>
      api.request<import("../../../../../packages/api-client/src/types").ServerStatus>(
        "/api/server/status",
        { signal },
      ),
    [api],
  );
  const action = useAdminAction(() => {
    resource.retry();
    status.retry();
  });
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [kind, setKind] = useState("movies");
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const folders = useResource(
    (signal) =>
      browsePath === null
        ? Promise.resolve(null)
        : api.request<LocalFoldersResponse>(
            `/api/local-folders?path=${encodeURIComponent(browsePath)}`,
            { signal },
          ),
    [api, browsePath],
  );
  function edit(library?: LibraryItem) {
    setEditing(library ?? null);
    setName(library?.name ?? "");
    setPaths(library?.paths ?? []);
    setPath("");
    setKind(library?.type ?? "movies");
    setFormOpen(true);
    setBrowsePath(null);
  }
  return (
    <View style={{ gap: 12 }}>
      <Heading>Libraries</Heading>
      <Refresh
        onPress={() => {
          resource.retry();
          status.retry();
        }}
      />
      <ResourceState
        resource={resource}
        empty={
          resource.value?.libraries.length === 0
            ? "Add a library to start scanning your media."
            : undefined
        }
      />
      <ResourceState resource={status} />
      {status.value?.scan && (
        <Label>
          Scan: {status.value.scan.status} · {status.value.scan.filesSeen} files
          · {status.value.scan.issues} issues
          {status.value.scan.currentFile
            ? `\n${status.value.scan.currentFile}`
            : ""}
        </Label>
      )}
      <Feedback action={action} />
      {resource.value?.libraries.map((library) => (
        <Group key={library.id} title={library.name}>
          <Label>
            {library.type} · {library.counts.items} titles ·{" "}
            {library.counts.review} need review
          </Label>
          <Label muted>{library.paths.join("\n")}</Label>
          <Button
            label={`Edit ${library.name}`}
            disabled={action.busy}
            onPress={() => edit(library)}
          />
          <Button
            label={`Scan ${library.name}`}
            disabled={action.busy}
            onPress={() => {
              void action
                .run<{
                  alreadyRunning?: boolean;
                }>(`/api/libraries/${library.id}/scan`, "POST", undefined, "Scan requested. Refresh to check progress.")
                .then((result) => {
                  if (result?.alreadyRunning)
                    action.setMessage(
                      "A scan is already running. Refresh to check progress.",
                    );
                });
            }}
          />
          <Button
            label={`Remove ${library.name}`}
            disabled={action.busy}
            onPress={() =>
              confirmAction(
                "Remove library?",
                "Library records will be removed. Media files stay on the server.",
                () => {
                  void action.run(`/api/libraries/${library.id}`, "DELETE");
                },
              )
            }
          />
        </Group>
      ))}
      {!formOpen ? (
        <Button label="Add library" onPress={() => edit()} />
      ) : (
        <Group title={editing ? `Edit ${editing.name}` : "New library"}>
          <Field label="Library name" value={name} onChangeText={setName} />
          <Label>Library type</Label>
          {(["movies", "tv", "anime"] as const).map((value) => (
            <Button
              key={value}
              label={
                value === "tv"
                  ? "TV shows"
                  : value === "anime"
                    ? "Anime"
                    : "Movies"
              }
              selected={kind === value}
              onPress={() => setKind(value)}
            />
          ))}
          <Label muted>Folders are on the server computer.</Label>
          {paths.map((value) => (
            <View key={value} style={{ gap: 8 }}>
              <Label>{value}</Label>
              <Button
                label={`Remove folder ${value}`}
                onPress={() =>
                  setPaths((previous) =>
                    previous.filter((entry) => entry !== value),
                  )
                }
              />
            </View>
          ))}
          <Field
            label="Folder path on the server"
            value={path}
            onChangeText={setPath}
            autoCapitalize="none"
          />
          <Button
            label="Add this path"
            disabled={!path.trim()}
            onPress={() => {
              setPaths((previous) => [...new Set([...previous, path.trim()])]);
              setPath("");
            }}
          />
          <Button
            label="Browse server folders"
            onPress={() => setBrowsePath(path.trim() || "~")}
          />
          {browsePath !== null && (
            <Group title="Server folders">
              <ResourceState resource={folders} />
              {folders.value && (
                <>
                  <Label>{folders.value.path}</Label>
                  <Button
                    label="Use this folder"
                    onPress={() => {
                      setPaths((previous) => [
                        ...new Set([...previous, folders.value!.path]),
                      ]);
                      setBrowsePath(null);
                    }}
                  />
                  {folders.value.parent && (
                    <Button
                      label="Parent folder"
                      onPress={() => setBrowsePath(folders.value!.parent)}
                    />
                  )}
                  {folders.value.entries
                    .filter((entry) => entry.isDirectory)
                    .map((entry) => (
                      <Button
                        key={entry.path}
                        label={entry.name}
                        onPress={() => setBrowsePath(entry.path)}
                      />
                    ))}
                </>
              )}
              <Button
                label="Close folder browser"
                onPress={() => setBrowsePath(null)}
              />
            </Group>
          )}
          <Button
            label={action.busy ? "Saving…" : "Save library"}
            disabled={action.busy || !name.trim() || paths.length === 0}
            onPress={async () => {
              const result = await action.run(
                editing ? `/api/libraries/${editing.id}` : "/api/libraries",
                editing ? "PATCH" : "POST",
                { name: name.trim(), type: kind, paths },
              );
              if (result) setFormOpen(false);
            }}
          />
          <Button
            label="Cancel editing"
            disabled={action.busy}
            onPress={() => setFormOpen(false)}
          />
        </Group>
      )}
    </View>
  );
}
