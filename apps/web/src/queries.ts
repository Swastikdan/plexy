/// Query option factories for TanStack Query.
///
/// Centralising stale times here keeps screens snappy: catalog data is
/// effectively static while browsing, watch state and scan progress are the
/// only live pieces.
import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { api } from "./client";

export const queries = {
  serverStatus: () =>
    queryOptions({
      queryKey: ["server-status"],
      queryFn: api.serverStatus,
      refetchInterval: (q) => {
        // Poll faster while a scan or preparation job is running; lazy when idle.
        const data = q.state.data;
        if (data?.scan?.status === "running") return 1500;
        if (data?.optimizer?.running || (data?.optimizer?.queued ?? 0) > 0) return 2500;
        return 30_000;
      },
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
      placeholderData: keepPreviousData,
    }),

  title: (id: number | string) =>
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

  play: (fileId: number, caps?: string, audioIndex = -1) =>
    queryOptions({
      queryKey: ["play", fileId, caps ?? "", audioIndex],
      queryFn: () => api.play(fileId, caps ? JSON.parse(caps) : undefined, audioIndex),
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // Trickplay extraction runs in the background after the first play.
      // Poll until it finishes so the scrub preview appears without a reload.
      refetchInterval: (q) => {
        const status = q.state.data?.trickplay?.status;
        return status === "queued" || status === "running" ? 3000 : false;
      },
    }),

  optimizer: () =>
    queryOptions({
      queryKey: ["optimizer"],
      queryFn: api.optimizeStatus,
      refetchInterval: (q) =>
        q.state.data?.running || q.state.data?.queued ? 2000 : 30_000,
    }),

  // --- admin ---

  libraries: () =>
    queryOptions({
      queryKey: ["libraries"],
      queryFn: () => api.libraries().then((r) => r.libraries),
      refetchInterval: 15_000,
    }),

  settings: () =>
    queryOptions({ queryKey: ["settings"], queryFn: api.settings }),

  review: (params?: {
    status?: "attention" | "all" | "matched" | "review" | "unmatched";
    q?: string;
  }) =>
    queryOptions({
      queryKey: ["review", params?.status ?? "attention", params?.q ?? ""],
      queryFn: () => api.review(params),
      refetchInterval: 20_000,
      placeholderData: keepPreviousData,
    }),

  logs: (filter?: { level?: string; component?: string; search?: string }) =>
    queryOptions({
      queryKey: ["logs", filter?.level ?? "", filter?.component ?? "", filter?.search ?? ""],
      queryFn: () => api.logs(filter).then((r) => r.lines),
      refetchInterval: 10_000,
      placeholderData: keepPreviousData,
    }),

  crashes: () =>
    queryOptions({
      queryKey: ["crashes"],
      queryFn: () => api.crashes().then((r) => r.crashes),
    }),
};
