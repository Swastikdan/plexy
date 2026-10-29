/// Pairing screen: shown when the server requires a credential and this device
/// does not have one. The server machine itself can sign in with one click;
/// anything else needs the six-digit code from Settings → Security.
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  Laptop,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  isLocalPage,
  loginOnServerMachine,
  pairDevice,
} from "../auth";
import { isLoopbackServerUrl } from "../server-config";

interface PairScreenProps {
  /** Base URL of the server that asked for authentication. */
  serverUrl: string;
  /** Called after a successful pairing; normally reloads the app. */
  onPaired: () => void;
}

export function PairScreen({ serverUrl, onPaired }: PairScreenProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const digits = code.replace(/\D/g, "").slice(0, 6);
  const canPair = digits.length === 6 && !busy && !done;
  const onServerMachine = isLocalPage() || isLoopbackServerUrl(serverUrl);

  async function finish(message?: string) {
    setDone(true);
    if (message) setError(null);
    window.setTimeout(onPaired, message ? 250 : 200);
  }

  async function pair() {
    if (!canPair) return;
    setBusy(true);
    setError(null);
    const result = await pairDevice(digits);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not pair this device.");
      return;
    }
    void finish("paired");
  }

  async function useThisMachine() {
    setBusy(true);
    setError(null);
    const result = await loginOnServerMachine();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not sign in on this machine.");
      return;
    }
    void finish("local");
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-160px] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-120px] h-[380px] w-[520px] rounded-full bg-brand/10 blur-3xl" />
      </div>

      <section className="relative w-full max-w-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line/80 bg-surface shadow-lg shadow-black/25">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Pair this device
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            Your Plexy server now requires a sign-in. Pair once and this device
            stays signed in.
          </p>
        </div>

        <div className="rounded-2xl border border-line/80 bg-surface/95 p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-7">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
            className="space-y-3"
          >
            <label htmlFor="plexy-pair-code" className="block space-y-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                <KeyRound size={13} className="text-brand-text" />
                Pairing code
              </span>
              <input
                id="plexy-pair-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={digits}
                disabled={busy || done}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="123456"
                className="h-14 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-center font-mono text-2xl tracking-[0.5em] text-ink placeholder:text-ink-muted/40 outline-none transition-colors focus:border-brand/70 disabled:opacity-60"
              />
            </label>

            <Button
              type="submit"
              variant="brand"
              disabled={!canPair}
              className="h-11 w-full px-5 text-sm font-semibold"
            >
              {done ? (
                <>
                  <CheckCircle2 size={16} />
                  Paired
                </>
              ) : busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Pairing…
                </>
              ) : (
                <>
                  Pair this device
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>

          {error && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs leading-relaxed text-red-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {onServerMachine && (
            <button
              type="button"
              onClick={() => void useThisMachine()}
              disabled={busy || done}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Laptop size={15} className="shrink-0 text-brand-text" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink">
                    This is the server machine
                  </span>
                  <span className="block text-[11px] text-ink-muted">
                    Sign in automatically — no code needed
                  </span>
                </span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-ink-muted" />
            </button>
          )}

          <div className="mt-5 space-y-2.5 border-t border-line/60 pt-4 text-xs leading-relaxed text-ink-muted">
            <p className="flex items-start gap-2">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-brand-text" />
              <span>
                Find the code in{" "}
                <span className="font-medium text-ink">Plexy → Settings → Security</span>{" "}
                on the computer or home server that runs Plexy. Codes are valid
                for 10 minutes and work once.
              </span>
            </p>
            <p>
              Server: <span className="font-medium text-ink">{serverUrl}</span>
            </p>
            <button
              type="button"
              onClick={() => window.location.assign("/connect")}
              className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-brand-text transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            >
              Use a different server
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
