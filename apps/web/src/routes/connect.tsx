/// Dedicated server-connection page, reachable from Settings so a connected
/// user can point the client at a different Plexy server.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ConnectScreen } from "../components/connect-screen";
import { getApiBase } from "../server-config";

function ConnectRoute() {
  const router = useRouter();
  return (
    <ConnectScreen
      initialValue={getApiBase()}
      onCancel={() => {
        // Match the app header: return to the previous screen when there is
        // one, otherwise fall back to Home (direct links, fresh tabs).
        if (window.history.length > 1) router.history.back();
        else window.location.assign("/");
      }}
      onConnected={() => {
        // Re-enter through the root so the connection gate re-probes and all
        // route loaders start against the new server.
        window.location.assign("/");
      }}
    />
  );
}

export const Route = createFileRoute("/connect")({ component: ConnectRoute });
