/// App root: every page sits behind the server connection gate, and the top /
/// bottom navigation wraps every page except the player and server connection.
import { createRootRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { TopNav } from "../components/topnav";
import { BottomNav } from "../components/bottomnav";
import { ServerGate } from "../components/server-gate";

function Shell() {
  // The player and the connection screen are chrome-less full-screen views.
  const matchRoute = useMatchRoute();
  const watching = matchRoute({ to: "/watch/$fileId", fuzzy: true });
  const connecting = matchRoute({ to: "/connect", fuzzy: true });
  const chrome = !watching && !connecting;

  return (
    <ServerGate>
      {chrome && <TopNav />}
      <div className={chrome ? "pb-20 sm:pb-0" : ""}>
        <Outlet />
      </div>
      {chrome && <BottomNav />}
    </ServerGate>
  );
}

export const Route = createRootRoute({ component: Shell });
