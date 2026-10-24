/// Query option factories for TanStack Query.
///
/// Centralising stale times here keeps screens snappy: catalog data is
/// effectively static while browsing, watch state and scan progress are the
/// only live pieces.
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const queries = {
  serverStatus: () =>
    queryOptions({
      queryKey: ["server-status"],
      queryFn: api.serverStatus,
      refetchInterval: (q) =>
        // Poll faster while a scan runs; lazy when idle.
        q.state.data?.scan?.status === "running" ? 1500 : 15_000,
    }),

  home: () =>
    queryOptions({
      queryKey: ["home"],
      queryFn: api.home,
      staleTime: 60_000,
    }),

  items: (query: { kind?: "movie" | "series"; libraryId?: number; sort?: string; unwatched?: boolean }) =>
    queryOptions({
      queryKey: ["items", query],
      queryFn: () => api.items({ ...query, limit: 200 }),
      staleTime: 60_000,
    }),

  title: (id: number) =>
    queryOptions({
      queryKey: ["title", id],
      queryFn: () => api.title(id),
      staleTime: 60_000,
    }),

  search: (q: string) =>
    queryOptions({
      queryKey: ["search", q],
      queryFn: () => api.search(q),
      enabled: q.trim().length > 0,
    }),

  subtitles: (fileId: number) =>
    queryOptions({
      queryKey: ["subtitles", fileId],
      queryFn: () => api.subtitles(fileId),
      staleTime: Infinity,
    }),

  playability: (fileId: number, caps: string) =>
    queryOptions({
      queryKey: ["playability", fileId, caps],
      queryFn: () => api.playability(fileId, JSON.parse(caps)),
      staleTime: 10_000,
    }),

  // --- admin ---

  libraries: () =>
    queryOptions({
      queryKey: ["libraries"],
      queryFn: () => api.libraries().then((r) => r.libraries),
      refetchInterval: 4000,
    }),

  settings: () =>
    queryOptions({ queryKey: ["settings"], queryFn: api.settings }),

  review: () =>
    queryOptions({
      queryKey: ["review"],
      queryFn: () => api.review().then((r) => r.items),
      refetchInterval: 8000,
    }),

  logs: (search?: string) =>
    queryOptions({
      queryKey: ["logs", search ?? ""],
      queryFn: () => api.logs(search ? { search } : undefined).then((r) => r.lines),
      refetchInterval: 3000,
    }),

  crashes: () =>
    queryOptions({
      queryKey: ["crashes"],
      queryFn: () => api.crashes().then((r) => r.crashes),
    }),
};
