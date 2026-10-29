/// Blocks the app until the selected Plexy server answers.
///
/// A hosted web build has no local API, so "no server detected" is the normal
/// first-run state. A desktop build usually passes immediately because its
/// bundled backend is already running. If the bundled backend fails to start,
/// the Electron window loads a static copy of the UI and this gate offers the
/// same connection form.
import { useEffect, useState, type ReactNode } from "react";
import { ConnectScreen } from "./connect-screen";
import { PairScreen } from "./pair-screen";
import { getApiBase, isElectron, probeServer } from "../server-config";
import { getAuthDevice } from "../auth";

type GateState =
  | { phase: "checking" }
  | { phase: "ready" }
  | { phase: "auth"; serverUrl: string }
  | { phase: "down"; error?: string; originUrl?: string };

export function ServerGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: "checking" });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const base = getApiBase();
      const primary = await probeServer(base);
      if (cancelled) return;

      if (primary.ok) {
        const device = await getAuthDevice();
        if (cancelled) return;
        if (!device) {
          setState({ phase: "auth", serverUrl: primary.url });
          return;
        }
        setState({ phase: "ready" });
        return;
      }

      // If an explicit address is wrong but the page itself is being served by
      // a working Plexy server, offer that same-origin server as a one-click
      // recovery. Skip the extra request when the page origin is the address
      // that just failed.
      let originUrl: string | undefined;
      const origin = window.location.origin;
      if (base !== origin) {
        const fallback = await probeServer(origin);
        if (cancelled) return;
        if (fallback.ok) originUrl = fallback.url;
      }

      // On a hosted first visit the "server" being probed is the static site
      // itself, so its "not a Plexy server" error would be noise before the
      // viewer has typed anything. Keep it for the desktop fallback, where the
      // message explains that the bundled backend did not start.
      const firstHostedVisit = base === origin && !isElectron();

      setState({
        phase: "down",
        error: firstHostedVisit ? undefined : primary.error,
        originUrl,
      });
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // A revoked token during a session: drop back to the pairing screen instead
  // of leaving every page showing request errors.
  useEffect(() => {
    const onUnauthorized = () => {
      setState({ phase: "auth", serverUrl: getApiBase() });
    };
    window.addEventListener("plexy:unauthorized", onUnauthorized);
    return () => window.removeEventListener("plexy:unauthorized", onUnauthorized);
  }, []);

  // The dedicated connection page must stay reachable from the pairing screen.
  if (typeof window !== "undefined" && window.location.pathname === "/connect") {
    return <>{children}</>;
  }

  if (state.phase === "checking") {
    return <ConnectionSplash />;
  }

  if (state.phase === "down") {
    return (
      <ConnectScreen initialError={state.error} originUrl={state.originUrl} />
    );
  }

  if (state.phase === "auth") {
    return (
      <PairScreen
        serverUrl={state.serverUrl}
        onPaired={() => window.location.reload()}
      />
    );
  }

  return <>{children}</>;
}

function ConnectionSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <img src="/icon.svg" alt="Plexy" className="h-12 w-12 animate-pulse" />
        <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand"
            aria-hidden="true"
          />
          Looking for your Plexy server…
        </div>
      </div>
    </div>
  );
}
