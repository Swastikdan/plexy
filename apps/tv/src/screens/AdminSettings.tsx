import React, { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { useClient } from "../../../../packages/native-client/src/context";
import { useResource } from "../../../../packages/native-client/src/hooks";
import { Button, Field, Heading, Label, Notice } from "../components/ui";
import type { ServerSettings } from "../../../../packages/api-client/src/types";

const textFields = [
  ["metadataLanguage", "Metadata language"],
  ["preferredAudioLanguage", "Preferred server audio language"],
  ["metadataRegion", "Metadata region"],
  ["note", "Server notes"],
] as const;
const numberFields = [
  ["optimizeMaxCacheGb", "Optimization cache limit (GB)"],
  ["probeConcurrency", "Concurrent media probes"],
  ["prefetchMaxConcurrent", "Concurrent artwork requests"],
  ["prefetchMaxCacheMb", "Artwork cache limit (MB)"],
  ["prefetchNextCount", "Upcoming artwork items"],
] as const;
const toggles = [
  ["autoOptimize", "Automatic optimization"],
  ["skipSegmentsEnabled", "Intro and credits detection"],
  ["prefetchAggressiveLocal", "Prefetch server artwork"],
  ["prefetchOnHover", "Prefetch on hover"],
  ["prefetchOnScroll", "Prefetch on scroll"],
] as const;

export function AdminSettings({
  dirtyChanged,
}: {
  dirtyChanged?: (dirty: boolean) => void;
}) {
  const { api } = useClient();
  const resource = useResource(
    () => api.request<{ settings: ServerSettings }>("/api/settings"),
    [api],
  );
  const [patch, setPatch] = useState<Record<string, string | number | boolean>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const settings = resource.value?.settings;
  useEffect(() => {
    dirtyChanged?.(Object.keys(patch).length > 0);
  }, [patch, dirtyChanged]);
  const change = (key: string, value: string | number | boolean) => {
    setPatch((previous) => ({ ...previous, [key]: value }));
    setMessage("");
  };
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const body = { ...patch };
      for (const [key, label] of numberFields) {
        if (key in body) {
          const value = Number(body[key]);
          const minimum =
            key === "optimizeMaxCacheGb"
              ? 0
              : key === "prefetchMaxCacheMb"
                ? 10
                : 1;
          const maximum =
            key === "prefetchMaxConcurrent"
              ? 10
              : key === "prefetchMaxCacheMb"
                ? 500
                : key === "prefetchNextCount"
                  ? 20
                  : Infinity;
          if (
            String(body[key]).trim() === "" ||
            !Number.isFinite(value) ||
            value < minimum ||
            value > maximum ||
            (key !== "optimizeMaxCacheGb" && !Number.isInteger(value))
          )
            throw new Error(
              `${label}: enter ${key === "optimizeMaxCacheGb" ? "a number" : "a whole number"} from ${minimum}${Number.isFinite(maximum) ? ` to ${maximum}` : " or higher"}.`,
            );
          body[key] = value;
        }
      }
      if (
        body.bindAddress === "127.0.0.1" &&
        settings?.bindAddress !== "127.0.0.1"
      ) {
        const confirmed = await new Promise<boolean>((resolve) =>
          Alert.alert(
            "Disable remote server access?",
            "After the server restarts, mobile and TV clients will lose access. Restore network access from the server computer.",
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => resolve(false),
              },
              {
                text: "Save",
                style: "destructive",
                onPress: () => resolve(true),
              },
            ],
            { cancelable: false },
          ),
        );
        if (!confirmed) return;
      }
      await api.request("/api/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setPatch({});
      resource.retry();
      setMessage("Server settings saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save server settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Heading>Server administration</Heading>
      <Label muted>
        These settings affect everyone connected to this server.
      </Label>
      {resource.error && (
        <Notice message={resource.error} retry={resource.retry} />
      )}
      {!!message && <Notice message={message} />}
      {settings && (
        <>
          {textFields.map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={String(patch[key] ?? settings[key])}
              editable={!busy}
              onChangeText={(value) => change(key, value)}
            />
          ))}
          {numberFields.map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={String(patch[key] ?? settings[key])}
              editable={!busy}
              onChangeText={(value) => change(key, value)}
            />
          ))}
          {toggles.map(([key, label]) => (
            <Button
              key={key}
              label={`${label}: ${(patch[key] ?? settings[key]) ? "On" : "Off"}`}
              selected={Boolean(patch[key] ?? settings[key])}
              disabled={busy}
              onPress={() => change(key, !(patch[key] ?? settings[key]))}
            />
          ))}
          <Label>Image quality</Label>
          {(["w342", "w500", "w780", "original"] as const).map((value) => (
            <Button
              key={value}
              label={value === "original" ? "Original" : `${value.slice(1)} px`}
              selected={(patch.imageQuality ?? settings.imageQuality) === value}
              disabled={busy}
              onPress={() => change("imageQuality", value)}
            />
          ))}
          <Label>Log detail</Label>
          {(["debug", "info", "warn", "error"] as const).map((value) => (
            <Button
              key={value}
              label={value}
              selected={(patch.logLevel ?? settings.logLevel) === value}
              disabled={busy}
              onPress={() => change("logLevel", value)}
            />
          ))}
          <Label>
            Server network access (takes effect after restarting the server)
          </Label>
          <Button
            label="This computer only"
            disabled={busy}
            selected={
              (patch.bindAddress ?? settings.bindAddress) === "127.0.0.1"
            }
            onPress={() => change("bindAddress", "127.0.0.1")}
          />
          <Button
            label="Allow network clients"
            disabled={busy}
            selected={(patch.bindAddress ?? settings.bindAddress) === "0.0.0.0"}
            onPress={() => change("bindAddress", "0.0.0.0")}
          />
          <Label muted>
            Port: {settings.port} · Metadata token source:{" "}
            {settings.tokenSource}
          </Label>
          <Field
            label={
              settings.hasTmdbToken
                ? "Replace metadata access token"
                : "Metadata access token"
            }
            value={String(patch.tmdbToken ?? "")}
            secureTextEntry
            editable={!busy}
            autoCapitalize="none"
            onChangeText={(value) => change("tmdbToken", value)}
          />
          <Button
            label="Test saved metadata token"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                const result = await api.request<{
                  ok: boolean;
                  message?: string;
                  error?: string;
                }>("/api/settings/tmdb/test", { method: "POST" });
                setMessage(
                  result.message ??
                    result.error ??
                    (result.ok
                      ? "Metadata token works."
                      : "Metadata token test failed."),
                );
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Could not test metadata token.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button
            label={busy ? "Saving…" : "Save server settings"}
            disabled={busy || Object.keys(patch).length === 0}
            onPress={save}
          />
        </>
      )}
    </View>
  );
}
