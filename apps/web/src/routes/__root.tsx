/// App root: top navigation and mobile bottom navigation around every page except the player.
import { createRootRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { TopNav } from "../components/topnav";
import { BottomNav } from "../components/bottomnav";

function Shell() {
  // The player is chrome-less fullscreen; keep it free of top and bottom bars.
  const matchRoute = useMatchRoute();
  const watching = matchRoute({ to: "/watch/$fileId", fuzzy: true });

  return (
    <>
      {!watching && <TopNav />}
      <div className={!watching ? "pb-20 sm:pb-0" : ""}>
        <Outlet />
      </div>
      {!watching && <BottomNav />}
    </>
  );
}

export const Route = createRootRoute({ component: Shell });
