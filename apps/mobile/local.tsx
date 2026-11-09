import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";
import NetInfo from "@react-native-community/netinfo";
import { LocalThumbnail } from "./LocalThumbnail";
import { LocalApi, invalidateLocalResources } from "@plexy/native-client";
import { LocalLibrary, parseLocalName, localSegments, type LocalFile, type LocalRecord, type LocalRoot, type LocalState } from "../../packages/local-library/src/library";
import { Button, Heading, Label, Notice } from "../../packages/native-client/src/ui";
import { useClient } from "../../packages/native-client/src/context";
import type { SubtitleTrack } from "../../packages/api-client/src/types";

const databaseKey = "plexy.local-library.v1";
const tokenKey = "plexy.local.tmdb-token";
let online = true;
const imageDirectory = new Directory(Paths.document, "library-artwork");
const requests = new Map<string, Promise<any>>();

function displayName(uri: string) {
  try { return decodeURIComponent(uri.split("/").at(-1)!).split("/").at(-1)!; }
  catch { return uri.split("/").at(-1)!; }
}
async function walk(root: LocalRoot): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  const pending = [{ directory: new Directory(root.uri), path: "" }];
  const visited = new Set<string>();
  while (pending.length) {
    const { directory, path } = pending.pop()!;
    if (visited.has(directory.uri)) continue;
    visited.add(directory.uri);
    // Let UI and player events run between directories, including large libraries.
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const entry of directory.list()) {
      const name = displayName(entry.uri);
      const relativePath = path ? `${path}/${name}` : name;
      if (entry instanceof Directory) {
        if (!/^(sample|extras?|trailers?|featurettes?)$/i.test(name)) pending.push({ directory: entry, path: relativePath });
      } else {
        const info = entry.info();
        if (!info.exists) throw new Error(`Cannot read ${relativePath}`);
        files.push({ uri: entry.uri, name, relativePath, directoryUri: directory.uri, size: info.size || 0, modified: info.modificationTime || 0 });
      }
    }
  }
  return files;
}
async function tmdb(path: string, token: string) {
  const key = `${token}:${path}`;
  let request = requests.get(key);
  if (!request) {
    request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`https://api.themoviedb.org/3${path}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
        return await response.json();
      } finally { clearTimeout(timer); }
    })();
    requests.set(key, request);
    request.catch(() => requests.delete(key));
  }
  return request;
}
async function artwork(path: string | null | undefined, size: string) {
  if (!path) return null;
  imageDirectory.create({ intermediates: true, idempotent: true });
  const destination = new File(imageDirectory, `${size}-${path.replace(/[^a-zA-Z0-9._-]/g, "")}`);
  if (!destination.exists || !destination.size) {
    const temporary = new File(imageDirectory, destination.name + ".part");
    try {
      await File.downloadFileAsync(`https://image.tmdb.org/t/p/${size}${path}`, temporary, { idempotent: true });
      if (!temporary.size) throw new Error("Artwork download was empty");
      await temporary.move(destination, { overwrite: true });
    } finally { if (temporary.uri !== destination.uri && temporary.exists) temporary.delete(); }
  }
  return destination.uri;
}
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
async function metadata(record: LocalRecord): Promise<Partial<LocalRecord> | null> {
  if (!online) return null;
  const token = await SecureStore.getItemAsync(tokenKey);
  if (!token) return null;
  const kind = record.card.kind === "episode" ? "tv" : "movie";
  const parsed = parseLocalName(record.file.relativePath, kind === "tv" ? "tv" : "movies");
  let id = record.tmdbId || parsed.explicitId;
  if (!id) {
    const query = new URLSearchParams({ query: parsed.title, include_adult: "false" });
    if (parsed.year) query.set(kind === "tv" ? "first_air_date_year" : "year", String(parsed.year));
    const search = await tmdb(`/search/${kind}?${query}`, token);
    const matches = search.results.filter((r: any) => normalized(r.title || r.name || "") === normalized(parsed.title)
      || normalized(r.original_title || r.original_name || "") === normalized(parsed.title));
    // Ambiguous results remain filename-based rather than attaching the wrong movie.
    if (matches.length !== 1) return { metadataAt: Date.now() };
    id = matches[0].id;
  }
  const data = await tmdb(`/${kind}/${id}?append_to_response=credits`, token);
  let episode: any = null;
  if (kind === "tv" && parsed.season != null && parsed.episode != null) {
    episode = await tmdb(`/tv/${id}/season/${parsed.season}/episode/${parsed.episode}`, token);
  }
  const poster = await artwork(data.poster_path, "w500");
  const backdrop = await artwork(data.backdrop_path, "w1280");
  const cast = [];
  for (const person of (data.credits?.cast || []).slice(0, 12)) {
    cast.push({ name: person.name, character: person.character || null,
      photo: await artwork(person.profile_path, "w185") });
  }
  const card = { ...record.card,
    name: episode?.name || data.title || data.name || record.card.name,
    parentTitle: kind === "tv" ? data.name : null,
    year: Number((data.release_date || data.first_air_date || "").slice(0, 4)) || parsed.year,
    poster, backdrop, overview: episode?.overview || data.overview || null,
    rating: episode?.vote_average || data.vote_average || null, runtime: episode?.runtime || data.runtime || null,
    genres: (data.genres || []).map((g: any) => g.name), matchStatus: "matched" };
  return { card, cast, tmdbId: id!, metadataAt: Date.now() };
}

async function markers(record: LocalRecord) {
  if (!online) return null;
  const token = await SecureStore.getItemAsync(tokenKey);
  if (!token || !record.tmdbId) return null;
  const episode = record.card.kind === "episode";
  const ids = await tmdb(`/${episode ? "tv" : "movie"}/${record.tmdbId}/external_ids`, token);
  if (!ids.imdb_id) return { intro: null, recap: null, outro: null };
  const params = new URLSearchParams({ imdb_id: ids.imdb_id });
  if (episode) { params.set("season", String(record.card.seasonNumber)); params.set("episode", String(record.card.episodeNumber)); }
  else params.set("is_movie", "true");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`https://api.introdb.app/segments?${params}`, { signal: controller.signal });
    if (response.status === 404) return { intro: null, recap: null, outro: null };
    if (!response.ok) throw new Error("Skip markers are temporarily unavailable");
    return localSegments(await response.json());
  } finally { clearTimeout(timer); }
}

export const localLibrary = new LocalLibrary({
  async load() {
    // Unlike the generic preference reader, storage errors must not reset a library.
    const json = await AsyncStorage.getItem(databaseKey);
    return json ? JSON.parse(json) as LocalState : null;
  },
  save: state => AsyncStorage.setItem(databaseKey, JSON.stringify(state)), walk, metadata, markers,
});
async function subtitleTracks(fileId: number): Promise<SubtitleTrack[]> {
  const record = localLibrary.record(fileId);
  const root = localLibrary.state.roots.find(r => r.uri === record.root)!;
  const files = await walk(record.file.directoryUri ? { ...root, uri: record.file.directoryUri } : root);
  const stem = (record.file.directoryUri ? record.file.name : record.file.relativePath).replace(/\.[^.]+$/, "");
  return files.filter(f => /\.(srt|vtt)$/i.test(f.name)
    && (f.relativePath.replace(/\.[^.]+$/, "") === stem || f.relativePath.startsWith(stem + ".")))
    .map(f => ({ track: f.uri, kind: "sidecar", title: f.name,
      language: f.name.match(/\.([a-z]{2,3})\.(?:srt|vtt)$/i)?.[1] || null }));
}
export const localApi = new LocalApi(localLibrary, uri => new File(uri).text(), subtitleTracks);
localLibrary.subscribe(invalidateLocalResources);
let restored = false;
export const localRuntime = {
  api: localApi,
  needsSetup: () => localLibrary.state.roots.length === 0,
  async restore() {
    if (restored) return;
    await localLibrary.restore();
    const connection = await NetInfo.fetch();
    online = !!connection.isConnected;
    NetInfo.addEventListener(s => {
      const reconnect = !online && !!s.isConnected;
      online = !!s.isConnected;
      if (reconnect) { requests.clear(); void localLibrary.scan().catch(() => {}); }
    });
    restored = true;
  },
  async refresh() { requests.clear(); await localLibrary.scan(); },
  Settings: LocalSettings,
  Thumbnail: LocalThumbnail,
};

function LocalSettings({ back }: { back?: () => void }) {
  const [, update] = useState(0);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { preferences, updatePreferences } = useClient();
  useEffect(() => localLibrary.subscribe(() => update(n => n + 1)), []);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const add = async (kind: LocalRoot["kind"]) => {
    const folder = await Directory.pickDirectoryAsync();
    await localLibrary.addRoot({ uri: folder.uri, name: displayName(folder.uri), kind });
  };
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 18, paddingBottom: 100 }}>
    {back && <Button label="Back" onPress={back} />}
    <Heading>On this device</Heading>
    <Label>Videos stay in their original folders. Your library, posters and watch progress are saved on this device.</Label>
    {!!message && <Notice message={message} />}
    {localLibrary.issues.map(issue => <Notice key={issue} message={issue} />)}
    <Button label="Add movie folder" disabled={busy} onPress={() => void action(() => add("movies"))} />
    <Button label="Add series folder" disabled={busy} onPress={() => void action(() => add("tv"))} />
    {localLibrary.state.roots.map(root => <View key={root.uri} style={{ gap: 8 }}>
      <Text style={{ color: "white", fontSize: 16 }}>{root.name} · {root.kind}</Text>
      <Button label="Remove from library" disabled={busy} onPress={() => Alert.alert("Remove this folder?", "The original files will stay untouched.", [
        { text: "Cancel" }, { text: "Remove", onPress: () => void action(() => localLibrary.removeRoot(root.uri)) },
      ])} />
    </View>)}
    <Button label={localLibrary.scanning ? "Checking files and metadata…" : "Check files and refresh metadata"}
      disabled={busy || localLibrary.scanning} onPress={() => void action(() => localRuntime.refresh())} />
    <Heading>Movie and series information</Heading>
    <Label>Add your TMDB API read access token to fetch titles, posters and cast. Cached information remains available offline.</Label>
    <TextInput value={token} onChangeText={setToken} placeholder="TMDB read access token" placeholderTextColor="#999"
      secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel="TMDB read access token"
      style={{ color: "white", backgroundColor: "#202020", borderRadius: 12, padding: 16 }} />
    <Button label="Save token and refresh" disabled={busy || !token.trim()} onPress={() => void action(async () => {
      if (online) await tmdb("/configuration", token.trim());
      await SecureStore.setItemAsync(tokenKey, token.trim()); setToken(""); requests.clear();
      for (const r of localLibrary.state.records) r.metadataAt = 0;
      await localLibrary.scan(); setMessage("Token saved. Metadata will refresh when online.");
    })} />
    <Label>This product uses the TMDB API but is not endorsed or certified by TMDB.</Label>
    <Heading>Playback</Heading>
    <Label>Original files only. No conversion or extra video copies. Format support depends on this device.</Label>
    <Button label={`Subtitles: ${preferences.autoSubtitles ? "automatic" : "off"}`}
      onPress={() => updatePreferences({ autoSubtitles: !preferences.autoSubtitles })} />
    <Button label={`Auto skip intros: ${preferences.autoSkip ? "on" : "off"}`}
      onPress={() => updatePreferences({ autoSkip: !preferences.autoSkip })} />
    <Button label={`Next episode: ${preferences.autoNext ? "automatic" : "manual"}`}
      onPress={() => updatePreferences({ autoNext: !preferences.autoNext })} />
  </ScrollView>;
}
