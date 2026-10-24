/// Viewer entrypoint (PRD 4).
///
/// Creates the query + router clients and mounts them. React Query Devtools
/// are intentionally omitted: the audience is a living-room viewer.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
});

// Type the router for the rest of the app's route-aware calls.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const app = document.getElementById("root")!;
ReactDOM.createRoot(app).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
