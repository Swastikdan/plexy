/// Connection screen for hosted web builds and for a desktop app whose bundled
/// backend could not start. The address is verified before it is saved, then
/// the page reloads so every query and media URL uses the new server.
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Server,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { Button } from "./ui/button";
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
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-160px] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-120px] h-[380px] w-[520px] rounded-full bg-brand/10 blur-3xl" />
      </div>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="absolute left-4 top-14 z-10 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 sm:left-6 sm:top-16"
        >
          <ArrowLeft size={15} />
          Back to Plexy
        </button>
      )}

      <section className="relative w-full max-w-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line/80 bg-surface shadow-lg shadow-black/25">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Connect to your Plexy server
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            This client is ready. Point it at the Mac or home server that holds
            your film and TV library.
          </p>
        </div>

        <div className="rounded-2xl border border-line/80 bg-surface/95 p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-7">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
            className="space-y-3"
          >
            <label htmlFor="plexy-server-url" className="block space-y-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                <Server size={13} className="text-brand-text" />
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
                className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-sm text-ink placeholder:text-ink-muted/60 outline-none transition-colors focus:border-brand/70 disabled:opacity-60"
              />
            </label>

            <Button
              type="submit"
              variant="brand"
              disabled={busy || !value.trim() || Boolean(connectedVersion)}
              className="h-11 w-full px-5 text-sm font-semibold"
            >
              {connectedVersion ? (
                <>
                  <CheckCircle2 size={16} />
                  Connected
                </>
              ) : busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Checking server…
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
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs leading-relaxed text-red-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {connectedVersion && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-300">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
              Connected to Plexy v{connectedVersion}. Opening your library…
            </div>
          )}

          {mixedContentRisk && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="min-w-0 space-y-2">
                <p>
                  This page is served over HTTPS, so the browser blocks a plain
                  HTTP server. Your server already serves this same app over
                  HTTP — open it there instead:
                </p>
                <button
                  type="button"
                  onClick={() => window.location.assign(normalized)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2"
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
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-surface-hover"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Wifi size={15} className="shrink-0 text-brand-text" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink">
                    Use the server serving this page
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {originUrl}
                  </span>
                </span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-ink-muted" />
            </button>
          )}

          <div className="mt-5 space-y-2.5 border-t border-line/60 pt-4 text-xs leading-relaxed text-ink-muted">
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
            {secure && (
              <p className="flex items-start gap-2">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-300/80" />
                A hosted HTTPS page can only call an HTTPS server. Plain HTTP
                works when you open Plexy directly on your own network.
              </p>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-ink-muted/75">
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
