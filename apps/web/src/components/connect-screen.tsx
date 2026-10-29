/// Connection screen for hosted web builds and for a desktop app whose bundled
/// backend could not start. The address is verified before it is saved, then
/// the page reloads so every query and media URL uses the new server.
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Server,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { Button } from "./ui/button";
import { BackButton } from "./back-button";
import { isElectronMac } from "../lib/platform";
import {
  getApiBase,
  getServerOverride,
  isLoopbackServerUrl,
  isSecurePage,
  normalizeServerUrl,
  probeServer,
  setServerUrl,
} from "../server-config";

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
  const [value, setValue] = useState(
    () => initialValue ?? getServerOverride(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [connectedVersion, setConnectedVersion] = useState<string | null>(null);

  const secure = isSecurePage();
  const normalized = normalizeServerUrl(value);
  const mixedContentRisk =
    secure && normalized.startsWith("http://") && !isLoopbackServerUrl(normalized);
  const attempted = safeBase();
  const attemptedIsPageOrigin =
    Boolean(attempted) &&
    attempted === normalizeServerUrl(window.location.origin);
  const showAttempted =
    Boolean(attempted) && (Boolean(getServerOverride()) || !attemptedIsPageOrigin);

  function finish() {
    if (onConnected) onConnected();
    else if (window.location.pathname === "/connect") window.location.assign("/");
    else window.location.reload();
  }

  async function connect(url = value) {
    const target = normalizeServerUrl(url);
    if (!target) {
      setError("Enter a valid server address, for example http://192.168.1.20:8765.");
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

    setServerUrl(target);
    setConnectedVersion(result.status.version);
    // Reload so the API client, image URLs and stream URLs are rebuilt against
    // the chosen server. A tiny delay lets the success state register.
    window.setTimeout(finish, 220);
  }

  function useOrigin() {
    if (!originUrl) return;
    setServerUrl(originUrl);
    finish();
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      {onCancel && (
        <div
          className="absolute left-3 top-3 z-10 sm:left-6"
          style={{ left: isElectronMac() ? 96 : undefined }}
        >
          <BackButton onClick={onCancel} label="Back to Plexy" />
        </div>
      )}

      <section className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-sm border border-line bg-surface">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Connect to your server
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            Point this client at the Mac or home server that holds your film and TV library.
          </p>
        </div>

        <div className="border border-line bg-surface p-5 sm:p-7">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
            className="space-y-3"
          >
            <label htmlFor="plexy-server-url" className="block space-y-2">
              <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
                <Server size={13} />
                Server address
              </span>
              <input
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
                className="h-10 w-full rounded-sm border border-line bg-surface-2 px-3.5 text-sm text-ink placeholder:text-ink-muted/50 outline-none transition-colors focus:border-line-strong disabled:opacity-50"
              />
            </label>

            <Button
              type="submit"
              variant="primary"
              disabled={busy || !value.trim() || Boolean(connectedVersion)}
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
            <div className="mt-3 flex items-start gap-2.5 border border-red-500/20 bg-red-500/8 p-3 text-xs leading-relaxed text-red-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {connectedVersion && (
            <div className="mt-3 flex items-center gap-2 border border-white/10 bg-white/5 p-3 text-xs font-medium text-ink">
              <CheckCircle2 size={14} className="shrink-0 text-ink-muted" />
              Connected to Plexy v{connectedVersion}. Opening your library…
            </div>
          )}

          {mixedContentRisk && (
            <div className="mt-3 flex items-start gap-2.5 border border-amber-500/20 bg-amber-500/8 p-3 text-xs leading-relaxed text-amber-300">
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
                  className="inline-flex max-w-full items-center gap-1.5 border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2"
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
              className="mt-3 flex w-full items-center justify-between gap-3 border border-line bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-surface-hover"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Wifi size={14} className="shrink-0 text-ink-muted" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink">
                    Use the server serving this page
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {originUrl}
                  </span>
                </span>
              </span>
              <ArrowRight size={14} className="shrink-0 text-ink-muted" />
            </button>
          )}

          <div className="mt-5 space-y-2.5 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
            {showAttempted && (
              <p>
                Tried <span className="font-medium text-ink">{attempted}</span>
                {getServerOverride() ? " from the address saved on this device." : "."}
              </p>
            )}
            <p>
              On your Mac, open <span className="font-medium text-ink">Plexy → Settings → Network &amp; Access</span> to
              see the server address. On Wi-Fi it usually looks like{" "}
              <span className="whitespace-nowrap font-medium text-ink">http://192.168.1.20:8765</span>.
            </p>
            {error && (
              <p>
                Check that Plexy is running, LAN access is enabled, both devices
                are on the same Wi-Fi, and the computer firewall allows Plexy.
                After connecting, enter the pairing code shown in the server's
                Security settings.
              </p>
            )}
            {secure && (
              <p className="flex items-start gap-2">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
                A hosted HTTPS page can only call an HTTPS server. Plain HTTP
                works when you open Plexy directly on your own network.
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-muted/60">
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
