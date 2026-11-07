import React, { useState } from "react";
import { View } from "react-native";
import { useClient } from "./context";
import { useResource } from "./hooks";
import { Button, Field, Heading, Label, Notice } from "./ui";
import type { ServerSettings } from "../../api-client/src/types";

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

export function AdminSettings() {
  const { api } = useClient();
  const resource = useResource(() => api.request<{ settings: ServerSettings }>("/api/settings"), [api]);
  const [patch, setPatch] = useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const settings = resource.value?.settings;
  const change = (key: string, value: string | number | boolean) => {
    setPatch(previous => ({ ...previous, [key]: value }));
    setMessage("");
  };
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const body = { ...patch };
      for (const [key] of numberFields) {
        if (key in body) {
          if (String(body[key]).trim() === "" || !Number.isFinite(Number(body[key])) || Number(body[key]) <= 0)
            throw new Error("Enter a positive number for each numeric setting.");
          body[key] = Number(body[key]);
        }
      }
      await api.request("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      setPatch({});
      resource.retry();
      setMessage("Server settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save server settings.");
    } finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Heading>Server administration</Heading>
    <Label muted>These settings affect everyone connected to this server.</Label>
    {resource.error && <Notice message={resource.error} retry={resource.retry} />}
    {!!message && <Notice message={message} />}
    {settings && <>
      {textFields.map(([key, label]) => <Field key={key} label={label} value={String(patch[key] ?? settings[key])} onChangeText={value => change(key, value)} />)}
      {numberFields.map(([key, label]) => <Field key={key} label={label} value={String(patch[key] ?? settings[key])} onChangeText={value => change(key, value)} />)}
      {toggles.map(([key, label]) => <Button key={key} label={`${label}: ${(patch[key] ?? settings[key]) ? "On" : "Off"}`} selected={Boolean(patch[key] ?? settings[key])} disabled={busy} onPress={() => change(key, !(patch[key] ?? settings[key]))} />)}
      <Label>Image quality</Label>
      {(["w342", "w500", "w780", "original"] as const).map(value => <Button key={value} label={value === "original" ? "Original" : `${value.slice(1)} px`} selected={(patch.imageQuality ?? settings.imageQuality) === value} onPress={() => change("imageQuality", value)} />)}
      <Label>Log detail</Label>
      {(["debug", "info", "warn", "error"] as const).map(value => <Button key={value} label={value} selected={(patch.logLevel ?? settings.logLevel) === value} onPress={() => change("logLevel", value)} />)}
      <Field label={settings.hasTmdbToken ? "Replace metadata access token" : "Metadata access token"} value={String(patch.tmdbToken ?? "")} secureTextEntry onChangeText={value => change("tmdbToken", value)} />
      <Button label={busy ? "Saving…" : "Save server settings"} disabled={busy || Object.keys(patch).length === 0} onPress={save} />
    </>}
  </View>;
}
