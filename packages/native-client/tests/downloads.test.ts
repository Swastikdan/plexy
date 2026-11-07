import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PlexyApi, ItemCard, Playability } from "../src/api";
const files = new Map<string, { size: number; text?: string }>();
let network = { isConnected: false, type: "wifi" };
let responseStatus = 200;
let responseSize = 1000;
let resumeSeen: string | undefined;
let block = false;
let release: (() => void) | undefined;
const subscriptions = new Set<(s: typeof network) => void>();
mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "file:///private/",
  getInfoAsync: async (uri: string) => ({
    exists: files.has(uri),
    size: files.get(uri)?.size || 0,
  }),
  getFreeDiskStorageAsync: async () => 100 * 1024 ** 3,
  makeDirectoryAsync: async () => {},
  deleteAsync: async (uri: string) => {
    files.delete(uri);
  },
  readAsStringAsync: async (uri: string) => files.get(uri)?.text || "",
  writeAsStringAsync: async (uri: string, text: string) => {
    files.set(uri, { text, size: text.length });
  },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    files.set(to, { ...files.get(from)! });
  },
  createDownloadResumable: (
    _url: string,
    uri: string,
    _options: unknown,
    progress: (data: unknown) => void,
    resumeData?: string,
  ) => {
    resumeSeen = resumeData;
    let cancelled = false;
    const run = async () => {
      if (block) {
        files.set(uri, { size: 400 });
        progress({ totalBytesWritten: 400, totalBytesExpectedToWrite: 1000 });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (cancelled) return undefined;
      const size =
        responseStatus === 206
          ? 1000
          : responseSize + (resumeData ? Number(resumeData) : 0);
      files.set(uri, { size });
      return {
        status: responseStatus,
        uri,
        headers:
          responseStatus === 206
            ? { "Content-Range": `bytes ${resumeData}-999/1000` }
            : { "Content-Length": String(responseSize) },
      };
    };
    return {
      downloadAsync: run,
      resumeAsync: run,
      pauseAsync: async () => {
        cancelled = true;
        release?.();
        return { resumeData: String(files.get(uri)?.size || 0) };
      },
    };
  },
}));
mock.module("@react-native-community/netinfo", () => ({
  default: {
    fetch: async () => network,
    addEventListener: (fn: (s: typeof network) => void) => {
      subscriptions.add(fn);
      return () => subscriptions.delete(fn);
    },
  },
}));
// Storage's native imports are irrelevant to the transfer manager's filesystem index.
mock.module("../src/storage", () => ({
  scopeKey: (s: string) => s.replaceAll(":", "_"),
}));
const { DownloadManager } = await import("../src/downloads");
let etag = '"source-1"';
const api = {
  request: async () => ({ etag, size: 1000 }),
  download: () => "https://nas.example/api/download/7",
  headers: () => ({ Authorization: "Bearer secret" }),
  skips: async () => ({ intro: null, recap: null, outro: null }),
} as unknown as PlexyApi;
const prefs = {
  wifiOnly: true,
  downloadCapGb: 20,
} as import("../src/storage").Preferences;
const item = { id: 1, name: "Movie" } as ItemCard;
const manifest = {
  fileId: 7,
  itemId: 1,
  versions: [{ fileId: 7, size: 1000 }],
  tracks: [],
} as unknown as Playability;
const managers: InstanceType<typeof DownloadManager>[] = [];
const manager = () => {
  const m = new DownloadManager("server:1", api, () => prefs);
  managers.push(m);
  return m;
};
async function until(check: () => boolean) {
  const end = Date.now() + 1000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Transfer did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
afterEach(async () => {
  for (const m of managers.splice(0)) await m.dispose();
  files.clear();
  network = { isConnected: false, type: "wifi" };
  responseStatus = 200;
  responseSize = 1000;
  resumeSeen = undefined;
  block = false;
  release = undefined;
  etag = '"source-1"';
});
describe("persistent download queue", () => {
  test("keeps queued media off cellular and never serializes request credentials", async () => {
    network = { isConnected: true, type: "cellular" };
    const m = manager();
    await m.restore();
    await m.enqueue(item, manifest, 7, "Source");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(m.entries[0]?.state).toBe("queued");
    expect([...files.values()].some((v) => v.text?.includes("secret"))).toBe(
      false,
    );
  });
  test("pauses safely, restores its index and resumes source bytes using the validator", async () => {
    network = { isConnected: true, type: "wifi" };
    block = true;
    const first = manager();
    await first.restore();
    await first.enqueue(item, manifest, 7, "Source");
    await until(() => !!release);
    await first.pauseActive();
    expect(first.entries[0]?.resumeData).toBe("400");
    await first.dispose();
    block = false;
    responseStatus = 206;
    const second = manager();
    await second.restore();
    expect(second.entries[0]?.state).toBe("paused");
    await second.retry(second.entries[0]!.id);
    await until(() => second.entries[0]?.state === "completed");
    expect(resumeSeen).toBe("400");
    expect(second.entries[0]?.bytes).toBe(1000);
  });
  test("does not accept an appended full response when the server ignores Range", async () => {
    network = { isConnected: true, type: "wifi" };
    block = true;
    const m = manager();
    await m.restore();
    await m.enqueue(item, manifest, 7, "Source");
    await until(() => !!release);
    await m.pauseActive();
    block = false;
    await m.retry(m.entries[0]!.id);
    await until(() => m.entries[0]?.state === "failed");
    expect(files.has(m.entries[0]!.uri)).toBe(false);
    expect(m.entries[0]?.error).toContain("resume");
  });
  test("restarts generated downloads instead of appending interrupted conversion bytes", async () => {
    network = { isConnected: true, type: "wifi" };
    block = true;
    const m = manager();
    await m.restore();
    await m.enqueue(item, manifest, 7, "720p generated", 720);
    await until(() => !!release);
    await m.pauseActive();
    block = false;
    await m.retry(m.entries[0]!.id);
    await until(() => m.entries[0]?.state === "completed");
    expect(resumeSeen).toBeUndefined();
    expect(m.entries[0]?.bytes).toBe(1000);
  });
});
