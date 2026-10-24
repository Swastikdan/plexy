/// Viewer entrypoint (PRD 4).
///
/// Creates the query + router clients and mounts them. React Query Devtools
/// are intentionally omitted: the audience is a living-room viewer.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hydrateServerUrl } from "./server-config";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Catalog responses are cheap but repeated navigation should not re-fetch
      // them; live screens (scan, optimizer) opt into polling themselves.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});

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

async function bootstrap() {
  // Electron stores the chosen server outside the page origin so it survives
  // the dynamic local port changing between launches.
  await hydrateServerUrl();

  const app = document.getElementById("root")!;
  ReactDOM.createRoot(app).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
