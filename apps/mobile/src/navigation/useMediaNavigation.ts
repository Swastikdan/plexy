import { useRouter } from "expo-router";
import type { DownloadEntry } from "../../../../packages/native-client/src/downloads";

/** Route params contain stable identifiers; live download data stays in the client. */
export function useMediaNavigation() {
  const router = useRouter();
  return {
    open: (id: string | number) => router.push({ pathname: "/item/[id]", params: { id: String(id) } }),
    play: (fileId: number, offline?: DownloadEntry) => router.push({ pathname: "/player/[fileId]", params: { fileId: String(fileId), ...(offline ? { downloadId: offline.id } : {}) } }),
    back: () => router.canGoBack() ? router.back() : router.replace("/"),
    openDownloads: () => router.push("/downloads"),
  };
}
