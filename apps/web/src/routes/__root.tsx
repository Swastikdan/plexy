/// App root: every page sits behind the server connection gate, and the top /
/// bottom navigation wraps every page except the player and server connection.
import { createRootRoute, Outlet, useMatchRoute, useRouterState } from "@tanstack/react-router";
import { TopNav } from "../components/topnav";
import { BottomNav } from "../components/bottomnav";
import { ServerGate } from "../components/server-gate";
import { useLibrarySync, usePrefetchRuntime } from "../lib/prefetch-config";

function Shell() {
  // The offline cache follows the saved preferences everywhere in the app and
  // refreshes itself after scans, so every screen can render without internet.
  usePrefetchRuntime();
  useLibrarySync();
  // The player and the connection screen are chrome-less full-screen views.
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const watching = matchRoute({ to: "/watch/$fileId", fuzzy: true });
  const connecting = matchRoute({ to: "/connect", fuzzy: true });
  const chrome = !watching && !connecting && pathname !== "/setup";

  return (
    <ServerGate>
      {chrome && <TopNav />}
      <div className={chrome ? "pb-20 sm:pb-0" : ""}>
        {/* Keyed by pathname so each route gets one quiet entrance. */}
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </div>
      {chrome && <BottomNav />}
    </ServerGate>
  );
}

export const Route = createRootRoute({ component: Shell });
