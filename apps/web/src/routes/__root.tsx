/// App root: top navigation around every page except the player.
import { createRootRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { TopNav } from "../components/topnav";

function Shell() {
  // The player is chrome-less fullscreen; keep it free of the top bar.
  const matchRoute = useMatchRoute();
  const watching = matchRoute({ to: "/watch/$fileId", fuzzy: true });

  return (
    <>
      {!watching && <TopNav />}
      <Outlet />
    </>
  );
}

export const Route = createRootRoute({ component: Shell });
