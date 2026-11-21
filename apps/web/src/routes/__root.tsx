/// App root: every page sits behind the server connection gate, and the app
/// chrome (top bar and mobile bar) wraps every page except the player.
import { createRootRoute, Outlet, useMatchRoute, useRouterState } from "@tanstack/react-router";
import { TopNav } from "@/components/topnav";
import { BottomNav } from "@/components/bottomnav";
import { cx } from "@/lib/cx";
import { isElectronMac } from "@/lib/platform";
import { ServerGate } from "@/components/server-gate";
import { useLibrarySync, usePrefetchRuntime } from "@/lib/prefetch-config";

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
  const electronMac = isElectronMac();

  return (
    <ServerGate>
      <a href="#app-content" className="skip-link">
        Skip to content
      </a>
      {chrome ? (
        <div className="app-main">
          <TopNav />
          <div id="app-content" tabIndex={-1} className={cx("pb-20 outline-none lg:pb-0", electronMac && "md:pb-0")}>
            {/* Keyed by pathname so each route gets one quiet entrance. */}
            <div key={pathname} className="page-enter">
              <Outlet />
            </div>
          </div>
          <BottomNav className={electronMac ? "md:hidden" : undefined} />
        </div>
      ) : (
        <div id="app-content" tabIndex={-1} className="app-main outline-none">
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        </div>
      )}
    </ServerGate>
  );
}

export const Route = createRootRoute({ component: Shell });
