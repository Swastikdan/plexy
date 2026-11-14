/// Personal settings panels: appearance, account security, paired devices, and
/// playback defaults. These follow the viewer across every screen and never
/// assume administrator access.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Captions,
  Check,
  Copy,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Sun,
  Volume2,
} from "lucide-react";
import { Button, Input, ListBox, Select, Switch } from "@heroui/react";
import {
  accountRequest,
  createPairingCode,
  listDevices,
  logout,
  removeRevokedDevice,
  revokeDevice,
  type AccountUser,
  type AuthDevice,
  type PairingCode,
} from "../../auth";
import { api } from "../../client";
import { queries } from "../../queries";
import { useTheme } from "../../lib/use-theme";
import { isPlaybackDiagnosticsEnabled, setPlaybackDiagnosticsEnabled } from "../../lib/playback-diagnostics-consent";
import {
  getPlaybackPreferences,
  savePlaybackPreferences,
  type PlaybackPreferences,
} from "../../lib/playback-preferences";
import { cx } from "../../lib/cx";
import type { ThemePreference } from "../../theme";

interface MeResponse {
  user: AccountUser;
  device: AuthDevice;
}

const THEME_CHOICES: Array<{
  value: ThemePreference;
  label: string;
  hint: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", hint: "Bright surfaces, dark text", icon: Sun },
  { value: "dark", label: "Dark", hint: "Dim room, low glare", icon: Moon },
  { value: "system", label: "System", hint: "Follows this device", icon: Monitor },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
] as const;

export function AppearancePanel() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Theme</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
          Saved on this device only. Your phone can follow the system while the
          desktop app stays dark.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {THEME_CHOICES.map((choice) => {
            const Icon = choice.icon;
            const selected = preference === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setPreference(choice.value)}
                className={cx(
                  "group relative flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2",
                  selected
                    ? "border-foreground/30 bg-surface-secondary"
                    : "border-border bg-surface hover:border-foreground/20 hover:bg-surface-secondary/50",
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background text-foreground">
                  <Icon size={17} />
                </span>
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {choice.label}
                    {selected && <Check size={13} className="text-foreground" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{choice.hint}</span>
                </span>
                <ThemeSwatch mode={choice.value} />
              </button>
            );
          })}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Accessibility</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
          Plexy follows your operating system's reduced-motion setting. Page
          transitions and hover physics collapse to simple fades when it is on.
        </p>
      </section>
    </div>
  );
}

function ThemeSwatch({ mode }: { mode: ThemePreference }) {
  return (
    <span
      aria-hidden
      className={cx(
        "mt-auto flex h-12 w-full items-end gap-1 overflow-hidden rounded-lg border border-border/70 p-2",
        mode === "dark" ? "bg-[#0b0b0c]" : mode === "light" ? "bg-[#f4f4f5]" : "bg-[linear-gradient(90deg,#f4f4f5_50%,#0b0b0c_50%)]",
      )}
    >
      <span className={cx("h-full w-2 rounded-sm", mode === "light" ? "bg-zinc-300" : "bg-zinc-700")} />
      <span className={cx("h-3 w-2 rounded-sm", mode === "light" ? "bg-zinc-400" : "bg-zinc-500")} />
      <span className={cx("h-5 w-2 rounded-sm", mode === "light" ? "bg-zinc-300" : "bg-zinc-700")} />
      <span className={cx("ml-auto h-6 w-6 rounded-full", mode === "light" ? "bg-zinc-400" : "bg-zinc-600")} />
    </span>
  );
}

export function AccountPanel({ admin }: { admin: boolean }) {
  const me = useQuery<MeResponse>({
    queryKey: ["account"],
    queryFn: () => accountRequest<MeResponse>("/me"),
  });
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    setBusy(true);
    setError("");
    try {
      await accountRequest("/password", { password, newPassword });
      setPassword("");
      setNewPassword("");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  const user = me.data?.user;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Your sign-in details for this Plexy server.
            </p>
          </div>
          {admin && (
            <Link
              to="/settings"
              search={{ tab: "users" }}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-secondary px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
            >
              Manage users
            </Link>
          )}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-2">
          <Detail label="Username" value={user?.username ?? "…"} />
          <Detail label="Role" value={user?.role === "admin" ? "Administrator" : "Viewer"} />
          <Detail label="This device" value={me.data?.device.name ?? "…"} />
          <Detail
            label="Maturity limit"
            value={
              user?.maxAge == null
                ? "No limit"
                : `Up to ${user.maxAge}${user.blockUnrated ? ", unrated hidden" : ""}`
            }
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Change password</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
          Changing your password signs out your other devices and invalidates
          pairing codes. You stay signed in here.
        </p>
        <form
          className="mt-4 max-w-md space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void changePassword();
          }}
        >
          <Field label="Current password">
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              fullWidth
            />
          </Field>
          <Field label="New password" hint="At least 12 characters.">
            <Input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              fullWidth
            />
          </Field>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-xs leading-relaxed text-danger-soft-foreground">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end pt-1">
            <Button type="submit" isDisabled={busy} className="h-9 px-4 text-xs font-semibold">
              {busy ? "Changing…" : "Change password"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Sign out</h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              Ends this session on this device. Other paired devices stay signed in.
            </p>
          </div>
          <Button
            variant="secondary"
            onPress={() => {
              void logout().then(() => window.location.assign("/"));
            }}
            className="h-9 shrink-0 px-3 text-xs font-semibold"
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}

export function DevicesPanel() {
  const queryClient = useQueryClient();
  const me = useQuery<MeResponse>({
    queryKey: ["account"],
    queryFn: () => accountRequest<MeResponse>("/me"),
  });
  const devices = useQuery({ queryKey: ["my-devices"], queryFn: listDevices });
  const certificate = useQuery({
    queryKey: ["server-certificate"],
    queryFn: () => accountRequest<{ fingerprint: string | null }>("/certificate"),
  });
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mint = async () => {
    setBusy(true);
    setError("");
    try {
      setPairing(await createPairingCode());
      setCopied(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!pairing) return;
    void navigator.clipboard
      .writeText(pairing.code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  const currentDeviceId = me.data?.device.id;
  const active = (devices.data ?? []).filter((device) => !device.revoked);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground">
              <KeyRound size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Pair a device</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Create a six-digit code and enter it on the other device. It
                expires after ten minutes and works once.
              </p>
            </div>
          </div>

          {pairing ? (
            <div className="mt-4 rounded-2xl border border-border bg-surface-secondary/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="select-all font-mono text-3xl font-semibold tracking-[0.24em] tabular-nums text-foreground">
                  {pairing.code}
                </p>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
                >
                  {copied ? <Check size={13} className="text-success-soft-foreground" /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Expires {formatPairingExpiry(pairing.expiresAt)}. Generating another
                code cancels this one.
              </p>
            </div>
          ) : null}

          {error && (
            <p role="alert" className="mt-3 text-xs text-danger-soft-foreground">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              isDisabled={busy}
              onPress={() => void mint()}
              className="h-9 px-4 text-xs font-semibold"
            >
              {busy ? "Creating…" : pairing ? "Create a new code" : "Create pairing code"}
            </Button>
            {pairing && (
              <button
                type="button"
                onClick={() => setPairing(null)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
              >
                <RefreshCcw size={13} />
                Hide
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">This device</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Everything below belongs to your account on this server.
          </p>
          <dl className="mt-4 space-y-3">
            <Detail label="Name" value={me.data?.device.name ?? "…"} icon={Laptop} />
            <Detail label="Last seen" value={formatPairingExpiry(me.data?.device.lastSeen)} />
            <Detail label="Address" value={me.data?.device.lastIp ?? "Not reported"} mono />
          </dl>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Paired devices</h2>
            <p className="mt-0.5 text-xs text-muted">
              {active.length} device{active.length === 1 ? "" : "s"} signed in to your account.
            </p>
          </div>
        </header>
        <ul className="divide-y divide-border/60">
          {(devices.data ?? []).map((device) => {
            const current = device.id === currentDeviceId;
            return (
              <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-secondary text-muted">
                  {device.name.toLowerCase().includes("phone") ? <Smartphone size={15} /> : <Laptop size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="truncate">{device.name}</span>
                    {current && (
                      <span className="rounded-full border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                        This device
                      </span>
                    )}
                    {device.revoked && (
                      <span className="rounded-full border border-danger/25 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger-soft-foreground">
                        Revoked
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {device.revoked
                      ? "No longer signed in"
                      : device.lastSeen
                        ? `Last seen ${formatPairingExpiry(device.lastSeen)}`
                        : "Not used yet"}
                    {device.lastIp ? ` from ${device.lastIp}` : ""}
                  </p>
                </div>
                {device.revoked ? (
                  <button
                    type="button"
                    onClick={() =>
                      void removeRevokedDevice(device.id).then(() =>
                        queryClient.invalidateQueries({ queryKey: ["my-devices"] }),
                      )
                    }
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Sign out ${device.name}?`)) return;
                      void revokeDevice(device.id)
                        .then(async () => {
                          await queryClient.invalidateQueries({ queryKey: ["my-devices"] });
                          if (current) window.location.reload();
                        })
                        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not revoke the device."));
                    }}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger-soft-foreground"
                  >
                    Sign out
                  </button>
                )}
              </li>
            );
          })}
          {!devices.isLoading && active.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted sm:px-5">No paired devices yet.</li>
          )}
        </ul>
      </section>

      {certificate.data?.fingerprint && (
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground">
              <ShieldCheck size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Server certificate</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                Compare this fingerprint before trusting the server on another
                device. Browsers still need their own certificate trust step
                for the local HTTPS address.
              </p>
              <p className="mt-3 select-all break-all rounded-lg border border-border bg-surface-secondary/50 p-3 font-mono text-[11px] text-foreground">
                {certificate.data.fingerprint}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export function PlaybackPanel({ admin }: { admin: boolean }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ ...queries.settings(), enabled: admin });
  const [prefs, setPrefs] = useState<PlaybackPreferences>(getPlaybackPreferences);
  const [diagnostics, setDiagnostics] = useState(isPlaybackDiagnosticsEnabled);
  const [saveError, setSaveError] = useState("");

  const update = (patch: Partial<PlaybackPreferences>) => {
    setPrefs(savePlaybackPreferences(patch));
  };

  const save = (patch: Record<string, unknown>) => {
    setSaveError("");
    void api
      .updateSettings(patch)
      .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
      .catch((caught) => {
        setSaveError(caught instanceof Error ? caught.message : "Could not save that preference.");
      });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground">
            <Captions size={16} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Subtitles</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
              Applied when playback starts on this device. You can still switch
              tracks inside the player.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-surface-secondary/40 p-3.5">
            <Switch
              size="sm"
              isSelected={prefs.autoSubtitles}
              onChange={(selected) => update({ autoSubtitles: selected })}
              className="w-full"
            >
              <Switch.Content className="flex w-full items-center justify-between gap-4">
                <span className="text-xs font-semibold text-foreground">Turn on subtitles</span>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Pick a matching track automatically when the file has one.
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-surface-secondary/40 p-3.5">
            <span className="block text-xs font-semibold text-foreground">Preferred subtitle language</span>
            <Select
              aria-label="Preferred subtitle language"
              selectedKey={prefs.subtitleLanguage}
              onSelectionChange={(key) => update({ subtitleLanguage: String(key) })}
              className="mt-2 w-full"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>
      </section>

      {admin && (
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground">
              <Volume2 size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Audio language</h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                Server-wide default for every viewer. Individual devices can
                still change the audio track in the player.
              </p>
            </div>
          </div>
          <div className="mt-4 max-w-sm">
            <Select
              aria-label="Preferred audio language"
              selectedKey={settings.data?.settings.preferredAudioLanguage ?? "en"}
              isDisabled={!settings.data}
              onSelectionChange={(key) => save({ preferredAudioLanguage: String(key) })}
              className="w-full"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {saveError && (
              <p role="alert" className="mt-2 text-xs text-danger-soft-foreground">
                {saveError}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Playback diagnostics</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
          Shares startup, rebuffer, and error details from this device with the
          server. The server keeps the latest 100 events in memory.
        </p>
        <div className="mt-3">
          <Switch
            size="sm"
            isSelected={diagnostics}
            onChange={(enabled) => {
              setDiagnostics(enabled);
              setPlaybackDiagnosticsEnabled(enabled);
            }}
            className="w-full"
          >
            <Switch.Content className="flex w-full items-center justify-between gap-4">
              <span className="text-xs font-semibold text-foreground">Share playback diagnostics</span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  icon: Icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: typeof Laptop;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] text-muted">
        {Icon && <Icon size={11} />}
        {label}
      </dt>
      <dd className={cx("mt-0.5 truncate text-xs font-medium text-foreground", mono && "font-mono text-[11px]")}>
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

/** SQLite timestamps are UTC without a timezone suffix. */
function formatPairingExpiry(value: string | null | undefined): string {
  if (!value) return "Not yet";
  try {
    const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}
