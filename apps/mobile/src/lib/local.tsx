import { loadLibrary, saveLibrary } from "./database";
import { LocalSettings } from "../screens/LocalSettings";
import Constants from "expo-constants";
import { fetchMetadata } from "../../../../packages/local-library/src/metadata";
import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";
import NetInfo from "@react-native-community/netinfo";
import { LocalThumbnail } from "../components/LocalThumbnail";
import { LocalApi } from "../../../../packages/native-client/src/local-api";
import { invalidateLocalResources } from "../../../../packages/native-client/src/hooks";
import { LocalLibrary, parseLocalName, localSegments, type LocalFile, type LocalRecord, type LocalRoot } from "../../../../packages/local-library/src/library";
import type { SubtitleTrack } from "../../../../packages/api-client/src/types";

const tokenKey = "plexy.local.tmdb-token";
let online = true;
const imageDirectory = new Directory(Paths.document, "library-artwork");
const requests = new Map<string, Promise<any>>();

export function displayName(uri: string) {
  uri = uri.replace(/\/+$/, "");
  try { return decodeURIComponent(uri.split("/").at(-1)!).split("/").at(-1)!; }
  catch { return uri.split("/").at(-1)!; }
}
async function walk(root: LocalRoot): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  if (root.singleFile) {
    const file = new File(root.uri);
    const info = file.info();
    if (!info.exists) throw new Error("File access is unavailable");
    return [{ uri: file.uri, name: displayName(file.uri), relativePath: displayName(file.uri),
      size: info.size || 0, modified: info.modificationTime || 0 }];
  }
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
    if (requests.size > 256) requests.delete(requests.keys().next().value!);
    request.catch(() => requests.delete(key));
  }
  return request;
}
async function downloadArtwork(path: string | null | undefined, size: string) {
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
const imageDownloads = new Map<string, Promise<string | null>>();
async function artwork(path: string | null | undefined, size: string) {
  if (!path) return null;
  const key = `${size}:${path}`;
  let download = imageDownloads.get(key);
  if (!download) {
    download = downloadArtwork(path, size).finally(() => imageDownloads.delete(key));
    imageDownloads.set(key, download);
  }
  return download;
}
export const bundledMetadata = !!Constants.expoConfig?.extra?.tmdbToken;
async function token() { return Constants.expoConfig?.extra?.tmdbToken || await SecureStore.getItemAsync(tokenKey); }
async function metadata(record: LocalRecord): Promise<Partial<LocalRecord> | null> {
  if (!online) return null;
  const key = await token();
  if (!key) throw new Error("This build has no TMDB configuration.");
  return fetchMetadata(record, { request: path => tmdb(path, key), artwork, settings: localLibrary.metadataSettings });
}
export async function searchTitles(query: string, kind: "movies" | "tv") {
  const key = await token();
  if (!key) throw new Error("TMDB is not configured in this build.");
  const trimmed = query.trim();
  const directId = trimmed.match(/^(?:https?:\/\/(?:www\.)?themoviedb\.org\/(?:movie|tv)\/)?(\d+)/i);
  if (directId) {
    try {
      const explicit = await tmdb(`/${kind === "movies" ? "movie" : "tv"}/${directId[1]}?language=${localLibrary.metadataSettings.language}`, key);
      if (explicit && explicit.id) return [explicit];
    } catch {}
  }

  const yearMatch = trimmed.match(/\b((?:19|20)\d{2})\b/);
  const cleanQuery = yearMatch && trimmed.length > 5 ? trimmed.replace(new RegExp(`\\b${yearMatch[1]}\\b`, "g"), "").trim() : trimmed;
  const params: Record<string, string> = {
    query: cleanQuery || trimmed,
    include_adult: "false",
    language: localLibrary.metadataSettings.language,
    region: localLibrary.metadataSettings.region,
  };
  if (yearMatch) {
    if (kind === "movies") params.primary_release_year = yearMatch[1];
    else params.first_air_date_year = yearMatch[1];
  }

  const response = await tmdb(`/search/${kind === "movies" ? "movie" : "tv"}?${new URLSearchParams(params)}`, key);
  if (response.results?.length) return response.results;
  if (yearMatch && cleanQuery) {
    const fallback = await tmdb(`/search/${kind === "movies" ? "movie" : "tv"}?${new URLSearchParams({
      query: trimmed,
      include_adult: "false",
      language: localLibrary.metadataSettings.language,
      region: localLibrary.metadataSettings.region,
    })}`, key);
    return fallback.results || [];
  }
  return response.results || [];
}

async function animeSkipMarkers(title: string, episodeNumber: number) {
  try {
    const jikanController = new AbortController();
    const jikanTimer = setTimeout(() => jikanController.abort(), 3500);
    const jikanRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`, { signal: jikanController.signal });
    clearTimeout(jikanTimer);
    if (!jikanRes.ok) return null;
    const jikanData = await jikanRes.json();
    const malId = jikanData.data?.[0]?.mal_id;
    if (!malId) return null;

    const skipController = new AbortController();
    const skipTimer = setTimeout(() => skipController.abort(), 3500);
    const skipRes = await fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${episodeNumber}?types[]=op&types[]=ed`, { signal: skipController.signal });
    clearTimeout(skipTimer);
    if (!skipRes.ok) return null;
    const skipData = await skipRes.json();
    if (!skipData.found || !Array.isArray(skipData.results)) return null;

    const intro = skipData.results.find((r: any) => r.skipType === "op")?.interval;
    const outro = skipData.results.find((r: any) => r.skipType === "ed")?.interval;
    return localSegments({
      intro: intro ? { start: intro.startTime, end: intro.endTime } : null,
      outro: outro ? { start: outro.startTime, end: outro.endTime } : null,
      recap: null,
    });
  } catch {
    return null;
  }
}

async function markers(record: LocalRecord) {
  if (!online) return null;
  if (record.isAnime && record.card.episodeNumber != null) {
    const animeTitle = record.card.parentTitle || record.card.name;
    const animeMarkers = await animeSkipMarkers(animeTitle, record.card.episodeNumber);
    if (animeMarkers && (animeMarkers.intro || animeMarkers.outro)) return animeMarkers;
  }
  const accessToken = await token();
  if (!accessToken || !record.tmdbId) return null;
  const episode = record.card.kind === "episode";
  const ids = await tmdb(`/${episode ? "tv" : "movie"}/${record.tmdbId}/external_ids`, accessToken);
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

async function deleteFile(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) {
      await file.delete();
    }
  } catch (err) {
    console.warn("Could not delete file:", uri, err);
  }
}

export const localLibrary = new LocalLibrary({
  load: loadLibrary, save: saveLibrary, walk, metadata, markers, deleteFile,
});
async function subtitleTracks(fileId: number): Promise<SubtitleTrack[]> {
  const record = localLibrary.record(fileId);
  const root = localLibrary.state.roots.find(r => r.uri === record.root)!;
  const files = root.singleFile ? [] : await walk(record.file.directoryUri ? { ...root, uri: record.file.directoryUri } : root);
  const stem = (record.file.directoryUri ? record.file.name : record.file.relativePath).replace(/\.[^.]+$/, "");
  return [...(record.externalSubtitles || []), ...files.filter(f => /\.(srt|vtt)$/i.test(f.name)
    && (f.relativePath.replace(/\.[^.]+$/, "") === stem || f.relativePath.startsWith(stem + ".")))
    .map(f => ({ track: f.uri, kind: "sidecar" as const, title: f.name,
      language: f.name.match(/\.([a-z]{2,3})\.(?:srt|vtt)$/i)?.[1] || null }))];
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
  async refresh() {
    const connection = await NetInfo.fetch();
    online = !!connection.isConnected;
    if (!online) return;
    requests.clear();
    await localLibrary.scan();
  },
  clearMetadataCache() { requests.clear(); },
  async refreshMetadata() { requests.clear(); await localLibrary.refreshMetadata(); },
  async testMetadata() {
    const key = await token();
    if (!key) throw new Error("TMDB is not configured in this build.");
    requests.clear();
    await tmdb("/configuration", key);
  },
  async pickSubtitle(fileId: number): Promise<SubtitleTrack | null> {
    const picked = await File.pickFileAsync({});
    if (picked.canceled) return null;
    const file = picked.result;
    if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error("Choose an SRT or VTT subtitle file.");
    const directory = new Directory(Paths.document, "external-subtitles");
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, `${fileId}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    await file.copy(destination);
    const track: SubtitleTrack = { track: destination.uri, kind: "sidecar", title: file.name, language: null };
    await localLibrary.addSubtitle(fileId, track);
    return track;
  },
  Settings: LocalSettings,
  Thumbnail: LocalThumbnail,
  getAttentionCount: () =>
    localLibrary.state.records.filter(r => r.card.matchStatus !== "matched" || !!r.metadataError).length + localLibrary.issues.length,
  getAttentionFingerprint: () =>
    `${localLibrary.issues.join("|")}::${localLibrary.state.records.filter(r => r.card.matchStatus !== "matched" || !!r.metadataError).map(r => r.id).sort().join(",")}`,
  subscribe: (fn: () => void) => localLibrary.subscribe(fn),
};
