import React, { useState } from "react";
import { Text, View } from "react-native";
import type {
  CrashesResponse,
  LogsResponse,
  PlaybackDiagnostic,
} from "../../../api-client/src/types";
import { useClient } from "../context";
import { useResource } from "../hooks";
import { Button, Field, Heading, Label } from "../ui";
import { colors, fonts } from "../theme";
import { Group, Refresh, ResourceState } from "./shared";

type Crash = {
  ts: string;
  kind: string;
  message: string;
  stack: string | null;
  version: string;
  bunVersion: string;
  os: string;
  arch: string;
  uptimeSeconds: number;
  memoryMB: number;
  lastLogs: string[];
  config: unknown;
};
export function AdminLogs() {
  const { api, platform } = useClient();
  const [level, setLevel] = useState("");
  const [component, setComponent] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [crashId, setCrashId] = useState<string | null>(null);
  const logs = useResource(
    (signal) => api.request<LogsResponse>(`/api/logs?${filter}`, { signal }),
    [api, filter],
  );
  const crashes = useResource(
    (signal) => api.request<CrashesResponse>("/api/crashes", { signal }),
    [api],
  );
  const crash = useResource(
    (signal) =>
      crashId
        ? api.request<Crash>(`/api/crashes/${encodeURIComponent(crashId)}`, {
            signal,
          })
        : Promise.resolve(null),
    [api, crashId],
  );
  const diagnostics = useResource(
    (signal) =>
      api.request<{ events: PlaybackDiagnostic[] }>(
        "/api/diagnostics/playback",
        { signal },
      ),
    [api],
  );
  const [showLogs, setShowLogs] = useState(false);
  const textStyle = {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: platform.tv ? 18 : 12,
    lineHeight: platform.tv ? 26 : 18,
  };
  return (
    <View style={{ gap: 12 }}>
      <Heading>Logs and diagnostics</Heading>
      <Refresh
        onPress={() => {
          logs.retry();
          crashes.retry();
          diagnostics.retry();
          crash.retry();
        }}
      />
      <Group title="Server logs">
        <Label>Log level</Label>
        {["", "debug", "info", "warn", "error"].map((value) => (
          <Button
            key={value}
            label={value || "All levels"}
            selected={level === value}
            onPress={() => setLevel(value)}
          />
        ))}
        <Field
          label="Component (optional)"
          value={component}
          onChangeText={setComponent}
        />
        <Field
          label="Search log text"
          value={search}
          onChangeText={setSearch}
        />
        <Button
          label="Apply filters"
          onPress={() => {
            setFilter(
              new URLSearchParams({
                ...(level ? { level } : {}),
                ...(component ? { component } : {}),
                ...(search ? { search } : {}),
              }).toString(),
            );
            logs.retry();
          }}
        />
        <ResourceState
          resource={logs}
          empty={
            logs.value?.lines.length === 0
              ? "No log lines match these filters."
              : undefined
          }
        />
        {logs.value && (
          <>
            <Label>{logs.value.lines.length} recent log lines</Label>
            <Button
              label={
                showLogs ? "Show latest 50 lines" : "Show all returned lines"
              }
              onPress={() => setShowLogs(!showLogs)}
            />
            <Text selectable style={textStyle}>
              {(showLogs ? logs.value.lines : logs.value.lines.slice(-50)).join(
                "\n\n",
              )}
            </Text>
          </>
        )}
      </Group>
      <Group title="Crash reports">
        <ResourceState
          resource={crashes}
          empty={
            crashes.value?.crashes.length === 0
              ? "No crash reports recorded."
              : undefined
          }
        />
        {crashes.value?.crashes.map((entry) => (
          <Button
            key={entry.id}
            label={entry.ts}
            selected={crashId === entry.id}
            onPress={() =>
              setCrashId((previous) =>
                previous === entry.id ? null : entry.id,
              )
            }
          />
        ))}
        {crashId && <ResourceState resource={crash} />}
        {crash.value && (
          <>
            <Label>
              {crash.value.kind}: {crash.value.message}
            </Label>
            <Label muted>
              {crash.value.ts} · {crash.value.os} {crash.value.arch} · v
              {crash.value.version} · Bun {crash.value.bunVersion}
            </Label>
            <Label muted>
              Uptime {crash.value.uptimeSeconds}s · Memory{" "}
              {crash.value.memoryMB} MB
            </Label>
            <Text selectable style={textStyle}>
              {crash.value.stack ?? "No stack trace available."}
            </Text>
            <Heading>Last log lines</Heading>
            <Text selectable style={textStyle}>
              {crash.value.lastLogs.join("\n\n")}
            </Text>
            <Heading>Server configuration at crash</Heading>
            <Text selectable style={textStyle}>
              {JSON.stringify(crash.value.config, null, 2)}
            </Text>
          </>
        )}
      </Group>
      <Group title="Playback diagnostics">
        <ResourceState
          resource={diagnostics}
          empty={
            diagnostics.value?.events.length === 0
              ? "No playback diagnostics recorded."
              : undefined
          }
        />
        {diagnostics.value?.events
          .slice()
          .reverse()
          .map((event, index) => (
            <Label key={`${event.at}:${index}`}>
              {event.at} · {event.kind} · {event.path ?? "Unknown path"}
              {event.durationMs === null ? "" : ` · ${event.durationMs} ms`}
              {event.mediaErrorCode === null
                ? ""
                : ` · Error ${event.mediaErrorCode}`}
            </Label>
          ))}
      </Group>
    </View>
  );
}
