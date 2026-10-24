/// Dedicated server-connection page, reachable from Settings so a connected
/// user can point the client at a different Plexy server.
import { createFileRoute } from "@tanstack/react-router";
import { ConnectScreen } from "../components/connect-screen";
import { getApiBase } from "../server-config";

function ConnectRoute() {
  return (
    <ConnectScreen
      initialValue={getApiBase()}
      onCancel={() => window.location.assign("/")}
      onConnected={() => {
        // Re-enter through the root so the connection gate re-probes and all
        // route loaders start against the new server.
        window.location.assign("/");
      }}
    />
  );
}

export const Route = createFileRoute("/connect")({ component: ConnectRoute });
