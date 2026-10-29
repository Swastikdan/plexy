/// Blocks the app until the selected Plexy server answers.
///
/// A hosted web build has no local API, so "no server detected" is the normal
/// first-run state. A desktop build usually passes immediately because its
/// bundled backend is already running. If the bundled backend fails to start,
/// the Electron window loads a static copy of the UI and this gate offers the
/// same connection form.
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { ConnectScreen } from "./connect-screen";
import { PairScreen } from "./pair-screen";
import { getApiBase, isElectron, probeServer } from "../server-config";
import { getAuthDevice } from "../auth";
import { reportConnectionHealth, subscribeConnectionHealth, type ConnectionHealth } from "../lib/connection-health";

type GateState =
  | { phase: "checking" }
  | { phase: "ready" }
  | { phase: "auth"; serverUrl: string }
  | { phase: "down"; error?: string; originUrl?: string };

export function ServerGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GateState>({ phase: "checking" });
  const [health, setHealth] = useState<ConnectionHealth>("online");
  const [retrying, setRetrying] = useState(false);

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

  useEffect(() => subscribeConnectionHealth(setHealth), []);

  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    const result = await probeServer(getApiBase());
    if (!result.ok) {
      setHealth(result.error.includes("HTTP 5") ? "unavailable" : "offline");
      setRetrying(false);
      return;
    }
    const device = await getAuthDevice();
    if (!device) {
      setState({ phase: "auth", serverUrl: result.url });
      setRetrying(false);
      return;
    }
    reportConnectionHealth("online");
    setRetrying(false);
    await queryClient.invalidateQueries();
  };

  useEffect(() => {
    if (state.phase !== "ready" || health === "online") return;
    let cancelled = false;
    let delay = 5_000;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      if (cancelled) return;
      const result = await probeServer(getApiBase());
      if (cancelled) return;
      if (result.ok) {
        const device = await getAuthDevice();
        if (cancelled) return;
        if (!device) {
          setState({ phase: "auth", serverUrl: result.url });
          return;
        }
        reportConnectionHealth("online");
        await queryClient.invalidateQueries();
        return;
      }
      delay = Math.min(delay * 2, 60_000);
      timer = setTimeout(probe, delay);
    };
    timer = setTimeout(probe, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [health, queryClient, state.phase]);

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

  return (
    <>
      {state.phase === "ready" && health !== "online" && (
        <div className="sticky top-0 z-[100] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-surface px-4 py-2 text-xs text-ink shadow-lg">
          {retrying ? <Loader2 size={15} className="animate-spin" /> : <WifiOff size={15} />}
          <span>
            {health === "offline"
              ? `Cannot reach ${getApiBase()}. Your screen will reconnect automatically.`
              : "The server is reachable, but an API request failed. Retrying automatically."}
          </span>
          <button
            type="button"
            onClick={() => void retryConnection()}
            disabled={retrying}
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink hover:text-brand-text disabled:opacity-50"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {children}
    </>
  );
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
