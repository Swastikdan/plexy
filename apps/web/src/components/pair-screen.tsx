import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { login, pairDevice } from "../auth";
import { cx } from "../lib/cx";

export function PairScreen({
  serverUrl,
  onPaired,
}: {
  serverUrl: string;
  onPaired: () => void;
}) {
  const [mode, setMode] = useState<"password" | "pair">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <div className="rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-sm space-y-6">
        <header className="text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Sign in to Plexy</h1>
          <p className="mt-1.5 break-all text-xs text-muted">{serverUrl}</p>
        </header>

        <div className="flex rounded-full bg-surface-secondary p-1 border border-border/60">
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError("");
            }}
            aria-pressed={mode === "password"}
            className={cx(
              "flex-1 rounded-full py-1.5 text-xs transition-all text-center font-medium",
              mode === "password"
                ? "bg-surface text-foreground font-semibold shadow-xs"
                : "text-muted hover:text-foreground",
            )}
          >
            Username & password
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("pair");
              setError("");
            }}
            aria-pressed={mode === "pair"}
            className={cx(
              "flex-1 rounded-full py-1.5 text-xs transition-all text-center font-medium",
              mode === "pair"
                ? "bg-surface text-foreground font-semibold shadow-xs"
                : "text-muted hover:text-foreground",
            )}
          >
            Pairing code
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (mode === "password") await login(username, password);
              else {
                const result = await pairDevice(key);
                if (!result.ok) throw new Error(result.error);
              }
              onPaired();
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Sign in failed.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "password" ? (
            <>
              <label className="block text-xs font-medium text-muted">
                Username
                <Input
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  fullWidth
                  className="mt-1.5 text-foreground"
                />
              </label>
              <label className="block text-xs font-medium text-muted">
                Password
                <Input
                  required
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  className="mt-1.5 text-foreground"
                />
              </label>
            </>
          ) : (
            <label className="block text-xs font-medium text-muted">
              Your pairing code
              <Input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                fullWidth
                className="mt-1.5 text-center font-mono text-2xl tracking-[0.3em] tabular-nums text-foreground"
              />
              <span className="mt-2 block text-[11px] leading-relaxed text-muted">
                Create a six-digit code in My account on a device where you are signed in.
                The code signs in to that same account and works once.
              </span>
            </label>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-danger/20 bg-danger/8 p-3 text-xs text-danger-soft-foreground">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || (mode === "pair" && key.length !== 6)}
            className="h-11 w-full font-semibold"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {!window.electronAPI?.localOnly && (
          <div className="text-center pt-1">
            <a href="/connect" className="text-xs text-muted hover:text-foreground underline transition-colors">
              Choose a different server
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
