import { useState } from "react";
import { Button } from "./ui/button";
import { login, pairDevice } from "../auth";

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header>
        <img src="/icon.svg" alt="" className="mb-5 h-12 w-12" />
        <h1 className="text-3xl font-bold text-ink">Sign in to Plexy</h1>
        <p className="mt-2 break-all text-sm text-ink-muted">{serverUrl}</p>
      </header>
      <div className="flex gap-4 text-sm">
        <button
          onClick={() => {
            setMode("password");
            setError("");
          }}
          aria-pressed={mode === "password"}
        >
          Username & password
        </button>
        <button
          onClick={() => {
            setMode("pair");
            setError("");
          }}
          aria-pressed={mode === "pair"}
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
            <label className="block text-sm">
              Username
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-line bg-surface px-3"
              />
            </label>
            <label className="block text-sm">
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-line bg-surface px-3"
              />
            </label>
          </>
        ) : (
          <label className="block text-sm">
            Your pairing code
            <input
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              className="mt-2 w-full rounded-lg border border-line bg-surface p-3 font-mono text-center text-2xl tracking-[0.3em] tabular-nums"
            />
            <span className="mt-2 block text-xs text-ink-muted">
              Create a six-digit code in My account on a device where you are signed in.
              The code signs in to that same account and works once.
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || (mode === "pair" && key.length !== 6)}
          className="h-11 w-full"
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {!window.electronAPI?.localOnly && <a href="/connect" className="text-sm underline text-ink-muted">
        Choose a different server
      </a>}
    </main>
  );
}
