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
import { Button, Input, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/use-theme";
import type { ThemePreference } from "../theme";


const THEME_CHOICES: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

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
        <p className="mt-2 text-sm text-muted">
          {me.data?.user.username} · {me.data?.user.role}
        </p>
      </header>
      {certificate.data?.fingerprint && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-bold">Server certificate</h2>
          <p className="mt-2 text-sm text-muted">
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
        <p role="alert" className="text-danger-soft-foreground">
          {error}
        </p>
      )}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div>
          <h2 className="text-xl font-bold">Appearance</h2>
          <p className="mt-2 text-sm text-muted">
            Choose a theme for this device. System follows your operating
            system’s light or dark appearance.
          </p>
        </div>
        <ThemePicker />
      </section>
      <section className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="text-xl font-bold">Pair another device</h2>
        <p className="text-sm text-muted">
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
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              className="mt-2"
            />
          </label>
          <Button isDisabled={busy} type="submit">
            Create my pairing code
          </Button>
        </form>
        {key && (
          <div className="space-y-2">
            <p className="rounded-lg border border-border bg-surface p-4 font-mono text-center text-3xl tracking-[0.3em] tabular-nums select-all">
              {key.code}
            </p>
            <p className="text-xs text-muted">
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
      <section className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="text-xl font-bold">My devices</h2>
        {devices.data
          ?.filter((d) => !d.revoked)
          .map((device) => (
            <div
              key={device.id}
              className="flex justify-between gap-4 border-t border-border pt-3"
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
      <section className="space-y-4 rounded-xl border border-border p-5">
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
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              className="mt-2"
            />
          </label>
          <label className="block text-sm">
            New password
            <Input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              className="mt-2"
            />
          </label>
          <p className="text-xs text-muted">
            Changing your password signs out your other devices and invalidates
            pairing codes.
          </p>
          <Button isDisabled={busy} type="submit">
            Change password
          </Button>
        </form>
      </section>
      <Button
        onPress={() =>
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

/// Light / dark / system picker. The choice is stored per device, so a phone
/// can follow the system while the desktop stays dark.
function ThemePicker() {
  const { preference, setPreference } = useTheme();

  return (
    <ToggleButtonGroup
      aria-label="Theme"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[preference]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === "light" || next === "dark" || next === "system") {
          setPreference(next);
        }
      }}
      className="flex flex-wrap"
    >
      {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
        <ToggleButton key={value} id={value} className="gap-2 px-4 text-sm">
          <Icon size={15} />
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
