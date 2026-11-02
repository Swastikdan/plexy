/// Viewer entrypoint (PRD 4).
///
/// Creates the query + router clients and mounts them. React Query Devtools
/// are intentionally omitted: the audience is a living-room viewer.
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hydrateServerUrl } from "./server-config";
import { registerAppShellServiceWorker } from "./lib/app-shell-sw";
import { queries } from "./queries";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // API reads own their bounded retry policy. Avoid stacking TanStack's
      // retries on top of transport retries, while refreshing cached data when
      // the browser returns online or to the foreground.
      retry: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Catalog responses are cheap but repeated navigation should not re-fetch
      // them; live screens (scan, optimizer) opt into polling themselves.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});

/** Refresh catalog queries when a background or manual scan completes. */
function ScanCatalogRefresh() {
  const { data } = useQuery(queries.serverStatus());
  const queryClient = useQueryClient();
  const scanWasRunning = useRef(false);
  const lastSeenScan = useRef("");

  useEffect(() => {
    if (data?.scan?.status === "running") {
      scanWasRunning.current = true;
      return;
    }
    if (scanWasRunning.current && data?.scan?.status) {
      scanWasRunning.current = false;
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["title"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
    }
  }, [data?.scan?.status, queryClient]);

  // Fast scans can finish between two polls, so a running→idle transition is
  // not always observed. The newest scans-table row is authoritative: a new id
  // (or a newly finished row) also marks the catalog as changed.
  useEffect(() => {
    const latest = data?.recentScans?.[0];
    if (!latest || latest.status === "running") return;
    const fingerprint = `${latest.id}:${latest.finished_at ?? ""}`;
    const previous = lastSeenScan.current;
    if (previous && previous !== fingerprint) {
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["title"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
    }
    lastSeenScan.current = fingerprint;
  }, [data?.recentScans, queryClient]);

  return null;
}

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 15_000,
});

// Type the router for the rest of the app's route-aware calls.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Remove the inline boot splash once the first route is actually rendered. */
function dismissBootSplash(): void {
  const el = document.getElementById("boot");
  if (!el) return;
  el.classList.add("done");
  // Keep it in the tree for the fade, then drop it entirely.
  setTimeout(() => el.remove(), 250);
}

async function bootstrap() {
  // Installable client shell: one shared worker serves the app shell for every
  // viewer and the artwork cache for local ones (see lib/app-shell-sw.ts).
  registerAppShellServiceWorker();

  // Electron stores the chosen server outside the page origin so it survives
  // the dynamic local port changing between launches.
  await hydrateServerUrl();

  const app = document.getElementById("root")!;
  ReactDOM.createRoot(app).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ScanCatalogRefresh />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );

  // Everything above is synchronous (no route chunks left to fetch), so the
  // real UI paints within the first couple of frames. Dismiss after two
  // frames so a slow first commit never blanks the window.
  requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
}

void bootstrap();
