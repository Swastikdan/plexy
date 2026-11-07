import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountRequest,
  createPairingCode,
  listDevices,
  logout,
  revokeDevice,
  type AccountUser,
  type PairingCode,
} from "../auth";
import { Button } from "../components/ui/button";

const input =
  "mt-2 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm";
function AccountRoute() {
  const me = useQuery({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
  });
  const certificate = useQuery({
    queryKey: ["server-certificate"],
    queryFn: () =>
      accountRequest<{ fingerprint: string | null }>("/certificate"),
  });
  const devices = useQuery({ queryKey: ["my-devices"], queryFn: listDevices });
  const cache = useQueryClient();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [key, setKey] = useState<PairingCode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-10">
      <header>
        <h1 className="text-3xl font-bold">My account</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {me.data?.user.username} · {me.data?.user.role}
        </p>
      </header>
      {certificate.data?.fingerprint && (
        <section className="rounded-xl border border-line p-5">
          <h2 className="text-lg font-bold">Server certificate</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Compare this fingerprint before trusting the server on another
            device. Browsers need their own certificate trust step when using
            the local HTTPS address.
          </p>
          <p className="mt-3 break-all select-all font-mono text-xs">
            {certificate.data.fingerprint}
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <section className="space-y-4 rounded-xl border border-line p-5">
        <h2 className="text-xl font-bold">Pair another device</h2>
        <p className="text-sm text-ink-muted">
          A six-digit code grants access to your account. Share it only with a device you
          trust. It expires after ten minutes and can be used once. Generating a
          new code invalidates the previous one.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              setKey(await createPairingCode(password));
              setPassword("");
            });
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            Confirm your password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </label>
          <Button variant="primary" disabled={busy} type="submit">
            Create my pairing code
          </Button>
        </form>
        {key && (
          <div className="space-y-2">
            <p className="rounded-lg border border-line bg-surface p-4 font-mono text-center text-3xl tracking-[0.3em] tabular-nums select-all">
              {key.code}
            </p>
            <p className="text-xs text-ink-muted">
              Expires{" "}
              {new Date(
                key.expiresAt.replace(" ", "T") + "Z",
              ).toLocaleTimeString()}
            </p>
            <button
              className="text-sm underline"
              onClick={() => void navigator.clipboard.writeText(key.code)}
            >
              Copy code
            </button>
          </div>
        )}
      </section>
      <section className="space-y-4 rounded-xl border border-line p-5">
        <h2 className="text-xl font-bold">My devices</h2>
        {devices.data
          ?.filter((d) => !d.revoked)
          .map((device) => (
            <div
              key={device.id}
              className="flex justify-between gap-4 border-t border-line pt-3"
            >
              <span className="text-sm">{device.name}</span>
              <button
                className="text-sm underline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const current = await accountRequest<any>("/me");
                    await revokeDevice(device.id);
                    await cache.invalidateQueries({ queryKey: ["my-devices"] });
                    if (device.id === current?.device?.id)
                      window.location.reload();
                  })
                }
              >
                Sign out device
              </button>
            </div>
          ))}
      </section>
      <section className="space-y-4 rounded-xl border border-line p-5">
        <h2 className="text-xl font-bold">Change password</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await accountRequest("/password", { password, newPassword });
              setPassword("");
              setNewPassword("");
              setKey(null);
              window.location.reload();
            });
          }}
        >
          <label className="block text-sm">
            Current password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </label>
          <label className="block text-sm">
            New password
            <input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={input}
            />
          </label>
          <p className="text-xs text-ink-muted">
            Changing your password signs out your other devices and invalidates
            pairing codes.
          </p>
          <Button disabled={busy} type="submit">
            Change password
          </Button>
        </form>
      </section>
      <Button
        onClick={() =>
          void action(async () => {
            await logout();
            window.location.assign("/");
          })
        }
      >
        Sign out
      </Button>
    </main>
  );
}
export const Route = createFileRoute("/account")({ component: AccountRoute });
