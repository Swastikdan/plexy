/// Connection screen for hosted web builds and for a desktop app whose bundled
/// backend could not start. The address is verified before it is saved, then
/// the page reloads so every query and media URL uses the new server.
import { DesktopServerSettings } from "./desktop-server-settings";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Server,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { Button, Input } from "@heroui/react";
import { BackButton } from "./back-button";
import { isElectronMac } from "@/lib/platform";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { cx } from "@/lib/cx";
import {
  activateServerUrl,
  forgetServerCandidate,
  getApiBase,
  getConfiguredServerBase,
  getServerCandidates,
  getServerOverride,
  isLoopbackServerUrl,
  isSecurePage,
  normalizeServerUrl,
  probeServer,
  rememberServerCandidate,
} from "@/server-config";

interface ConnectScreenProps {
  /** Error from the automatic probe that showed this screen. */
  initialError?: string;
  /** A same-origin Plexy server, when one answered the fallback probe. */
  originUrl?: string | null;
  /** Prefill for the address field (for example the currently connected server). */
  initialValue?: string;
  /** Called after a successful connection. Defaults to a full reload. */
  onConnected?: () => void;
  /** Called when the viewer leaves without changing servers (route mode only). */
  onCancel?: () => void;
}

export function ConnectScreen({
  initialError,
  originUrl,
  initialValue,
  onConnected,
  onCancel,
}: ConnectScreenProps) {
  const isFullscreen = useIsFullscreen();
  const [value, setValue] = useState(() => initialValue ?? getServerOverride());
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [saved, setSaved] = useState(() => getServerCandidates());
  const [discovered, setDiscovered] = useState<
    Array<{ id: string; name: string; url: string; reachable?: boolean; latencyMs?: number | null }>
  >([]);
  const [discovering, setDiscovering] = useState(false);
  const discover = async () => {
    if (!window.electronAPI?.discoverServers) return;
    setDiscovering(true);
    try {
      setDiscovered(await window.electronAPI.discoverServers());
    } catch {
      /* manual address remains available */
    } finally {
      setDiscovering(false);
    }
  };
  useEffect(() => {
    void discover();
  }, []);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [connectedVersion, setConnectedVersion] = useState<string | null>(null);

  const secure = isSecurePage();
  const normalized = normalizeServerUrl(value);
  const mixedContentRisk =
    secure &&
    normalized.startsWith("http://") &&
    !isLoopbackServerUrl(normalized);
  const attempted = safeBase();
  const activeSaved = normalizeServerUrl(getConfiguredServerBase());
  const attemptedIsPageOrigin =
    Boolean(attempted) &&
    attempted === normalizeServerUrl(window.location.origin);
  const showAttempted =
    Boolean(attempted) &&
    (Boolean(getServerOverride()) || !attemptedIsPageOrigin);

  function finish() {
    if (onConnected) onConnected();
    else if (window.location.pathname === "/connect")
      window.location.assign("/");
    else window.location.reload();
  }

  async function connect(url = value, label?: string) {
    const target = normalizeServerUrl(url);
    if (!target) {
      setError(
        "Enter a valid server address, for example http://192.168.1.20:8765.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setConnectedVersion(null);

    const result = await probeServer(target);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    setSwitching(true);
    try {
      await activateServerUrl(target);
      rememberServerCandidate(target, label, result.status.serverId);
      setSaved(getServerCandidates());
      if (
        window.electronAPI &&
        (await window.electronAPI.getLocalServerEnabled())
      ) {
        await window.electronAPI.setLocalServerEnabled(false);
        return;
      }
      setConnectedVersion(result.status.version);
      // Reload so the API client, image URLs and stream URLs are rebuilt against
      // the chosen server. A tiny delay lets the success state register.
      window.setTimeout(finish, 220);
      window.setTimeout(() => {
        setSwitching(false);
        setBusy(false);
      }, 8_000);
    } catch (cause) {
      setSwitching(false);
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Could not switch servers.");
    }
  }

  function useOrigin() {
    if (!originUrl) return;
    setSwitching(true);
    void activateServerUrl(originUrl).then(finish).catch(() => {
      setSwitching(false);
      setError("Could not switch to this server.");
    });
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      {switching && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm" role="status" aria-live="polite">
          <Loader2 size={28} className="animate-spin text-muted" />
          <p className="text-sm font-semibold text-foreground">Switching server…</p>
          <p className="max-w-xs text-center text-xs text-muted">
            Verifying the new address and rebuilding the connection.
          </p>
        </div>
      )}
      <div
        className="absolute left-3 top-3 z-10 flex items-center gap-1.5 sm:left-6"
        style={{ left: isElectronMac() && !isFullscreen ? 96 : undefined }}
      >
        {onCancel && <BackButton onClick={onCancel} label="Back to Plexy" />}
        <span className="truncate font-sans text-sm font-bold tracking-[-0.02em] text-foreground sm:text-[15px]">
          Server
        </span>
      </div>

      <section className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Choose a server
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Point this client at the Mac or home server that holds your film and
            TV library.
          </p>
        </div>

        <DesktopServerSettings />
        <div className="rounded-3xl border border-border bg-surface p-5 sm:p-7 shadow-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
            className="space-y-3"
          >
            <div className="space-y-2">
              {saved.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Saved servers
                  </span>
                  {saved.map((candidate) => {
                    const active = candidate.url === activeSaved;
                    return (
                      <div
                        key={candidate.url}
                        className={cx(
                          "flex items-center gap-2 rounded-lg border p-1.5 pl-3 text-left",
                          active ? "border-success/30 bg-success/5" : "border-border",
                        )}
                      >
                        <button
                          type="button"
                          disabled={busy || switching}
                          onClick={() => void connect(candidate.url, candidate.label)}
                          className="min-w-0 flex-1 py-1.5 text-left disabled:opacity-50"
                        >
                          <span className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {candidate.label}
                            </span>
                            {active && (
                              <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-success-soft-foreground">
                                Active
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-muted">
                            {candidate.url}
                          </span>
                        </button>
                        {!active && (
                          <button
                            type="button"
                            onClick={() => {
                              forgetServerCandidate(candidate.url);
                              setSaved(getServerCandidates());
                            }}
                            className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold text-muted transition-colors hover:bg-danger/10 hover:text-danger-soft-foreground"
                          >
                            Forget
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[10px] leading-relaxed text-muted">
                    Plexy tries the active address first and falls back to another
                    saved address if it stops responding.
                  </p>
                </div>
              )}
              {window.electronAPI?.discoverServers && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={discovering}
                    onClick={() => void discover()}
                    className="text-left text-sm underline disabled:opacity-60"
                  >
                    {discovering
                      ? "Looking for servers on your network…"
                      : "Find servers on this network"}
                  </button>
                  <button
                    type="button"
                    disabled={discovering}
                    onClick={() => void discover()}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10.5px] font-semibold text-muted transition-colors hover:bg-surface-secondary disabled:opacity-50"
                  >
                    <Wifi size={11} /> Refresh
                  </button>
                </div>
              )}
              {discovered.map((server) => (
                <button
                  type="button"
                  key={server.id}
                  disabled={busy || switching}
                  onClick={() => void connect(server.url, server.name)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-secondary disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {server.name}
                    </span>
                    <span className="block truncate text-xs text-muted">{server.url}</span>
                  </span>
                  <span
                    className={cx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      server.reachable
                        ? "bg-success/10 text-success-soft-foreground"
                        : "bg-surface-secondary text-muted",
                    )}
                  >
                    {server.reachable
                      ? server.latencyMs != null
                        ? `${server.latencyMs} ms`
                        : "Online"
                      : "No answer"}
                  </span>
                </button>
              ))}
              {window.electronAPI?.discoverServers && !discovering && discovered.length === 0 && (
                <p className="text-xs text-muted">
                  No servers found automatically. Enter the address shown in
                  Plexy → Settings → Network &amp; Access.
                </p>
              )}
              {!window.electronAPI?.discoverServers && (
                <p className="text-xs text-muted">
                  Open your server’s client link or enter its address. Automatic
                  network discovery is available in the desktop app.
                </p>
              )}
            </div>
            <label htmlFor="plexy-server-url" className="block space-y-2">
              <span className="flex items-center gap-2 text-xs font-medium text-muted">
                <Server size={13} />
                Server address
              </span>
              <Input
                id="plexy-server-url"
                type="text"
                inputMode="url"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={value}
                disabled={busy || Boolean(connectedVersion)}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="http://192.168.1.20:8765"
                fullWidth
              />
            </label>

            <Button
              type="submit"
              isDisabled={busy || !value.trim() || Boolean(connectedVersion)}
              className="h-10 w-full px-5 text-sm font-semibold"
            >
              {connectedVersion ? (
                <>
                  <CheckCircle2 size={16} />
                  Connected
                </>
              ) : busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  Connect
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>

          {error && !mixedContentRisk && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/8 p-3 text-xs leading-relaxed text-danger-soft-foreground">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {connectedVersion && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface-secondary p-3 text-xs font-medium text-foreground">
              <CheckCircle2 size={14} className="shrink-0 text-muted" />
              Connected to Plexy v{connectedVersion}. Opening your library…
            </div>
          )}

          {mixedContentRisk && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/8 p-3 text-xs leading-relaxed text-warning-soft-foreground">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0 space-y-2">
                <p>
                  This page is served over HTTPS, so the browser blocks a plain
                  HTTP server. Your server already serves this same app over
                  HTTP — open it there instead:
                </p>
                <button
                  type="button"
                  onClick={() => window.location.assign(normalized)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-semibold text-warning-soft-foreground transition-colors hover:bg-warning/20 focus-visible:outline-2 focus-visible:outline-warning-soft-foreground focus-visible:outline-offset-2"
                >
                  <span className="truncate">Open {normalized}</span>
                  <ArrowRight size={13} className="shrink-0" />
                </button>
              </div>
            </div>
          )}

          {originUrl && !connectedVersion && (
            <button
              type="button"
              onClick={useOrigin}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary px-3.5 py-3 text-left transition-colors hover:bg-surface-tertiary"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Wifi size={14} className="shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">
                    Use the server serving this page
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {originUrl}
                  </span>
                </span>
              </span>
              <ArrowRight size={14} className="shrink-0 text-muted" />
            </button>
          )}

          <div className="mt-5 space-y-2.5 border-t border-border pt-4 text-xs leading-relaxed text-muted">
            {showAttempted && (
              <p>
                Tried <span className="font-medium text-foreground">{attempted}</span>
                {getServerOverride()
                  ? " from the address saved on this device."
                  : "."}
              </p>
            )}
            <p>
              On your Mac, open{" "}
              <span className="font-medium text-foreground">
                Plexy → Settings → Network &amp; Access
              </span>{" "}
              to see the server address. On Wi-Fi it usually looks like{" "}
              <span className="whitespace-nowrap font-medium text-foreground">
                http://192.168.1.20:8765
              </span>
              .
            </p>
            {error && (
              <p>
                Check that Plexy is running, LAN access is enabled, both devices
                are on the same Wi-Fi, and the computer firewall allows Plexy.
                After connecting, sign in with your username and password or a
                pairing code from your account.
              </p>
            )}
            {secure && (
              <p className="flex items-start gap-2">
                <ShieldAlert
                  size={13}
                  className="mt-0.5 shrink-0 text-warning-soft-foreground/80"
                />
                A hosted HTTPS page can only call an HTTPS server. Plain HTTP
                works when you open Plexy directly on your own network.
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted/60">
          The address is saved on this device only.
        </p>
      </section>
    </main>
  );
}

function safeBase(): string {
  try {
    return getApiBase();
  } catch {
    return "";
  }
}
