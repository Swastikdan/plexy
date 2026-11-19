/// Personal settings panels: appearance, account security, paired devices, and
/// playback defaults. These follow the viewer across every screen and never
/// assume administrator access.
///
/// Every panel is one column of the same `SettingsSection` building block, with
/// one header rhythm and one control row. Wide screens get breathing room, not
/// a different layout per page.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accessibility,
  Activity,
  AlertCircle,
  Captions,
  Check,
  Copy,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
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
import { ProfilePhotoEditor } from "../profile-photo";
import { SettingsSection, SettingsToggleRow } from "./section";
import type { ThemePreference } from "../../theme";

interface MeResponse {
  user: AccountUser;
  device: AuthDevice;
}

const THEME_CHOICES: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
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
    <div className="space-y-4">
      <SettingsSection icon={Palette} title="Theme">
        <div className="grid gap-3 sm:grid-cols-3">
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
                  "group relative flex flex-col items-start gap-3 overflow-hidden rounded-xl border p-3 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2",
                  selected
                    ? "border-accent/55 bg-surface-secondary/70"
                    : "border-border bg-surface hover:border-foreground/20 hover:bg-surface-secondary/50",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background text-foreground">
                    <Icon size={14} aria-hidden />
                  </span>
                  {selected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Check size={11} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </span>
                <span className="text-[12px] font-semibold text-foreground">{choice.label}</span>
                <ThemeSwatch mode={choice.value} />
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <p className="flex items-center gap-2 px-1 text-[11px] leading-relaxed text-muted">
        <Accessibility size={13} aria-hidden />
        Plexy follows your operating system's reduced-motion setting.
      </p>
    </div>
  );
}

function ThemeSwatch({ mode }: { mode: ThemePreference }) {
  return (
    <span
      aria-hidden
      className={cx(
        "mt-auto flex h-12 w-full items-end gap-1 overflow-hidden rounded-md border border-border/70 p-2",
        mode === "dark" ? "bg-[#060607]" : mode === "light" ? "bg-[#f5f5f5]" : "bg-[linear-gradient(90deg,#f5f5f5_50%,#060607_50%)]",
      )}
    >
      <span className={cx("h-full w-2 rounded-sm", mode === "light" ? "bg-[#eaeaeb]" : "bg-[#232325]")} />
      <span className={cx("h-3 w-2 rounded-sm", mode === "light" ? "bg-[#efeff0]" : "bg-[#262728]")} />
      <span className={cx("h-5 w-2 rounded-sm", mode === "light" ? "bg-[#eaeaeb]" : "bg-[#18181b]")} />
      <span className="ml-auto h-6 w-6 rounded-full bg-[#0485f7]" />
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
    <div className="space-y-4">
      <SettingsSection
        icon={UserRound}
        title="Account"
        action={
          admin ? (
            <Link
              to="/settings"
              search={{ tab: "users" }}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-secondary px-2.5 text-[10.5px] font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
            >
              Manage users
            </Link>
          ) : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-4">
          <Detail label="Username" value={user?.username ?? "…"} />
          <Detail label="Role" value={user?.role === "admin" ? "Administrator" : "User"} />
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
      </SettingsSection>

      <ProfilePhotoEditor user={user} />

      <SettingsSection icon={KeyRound} title="Password">
        <form
          className="space-y-3.5"
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
          <Field label="New password">
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
            <p role="alert" className="flex items-start gap-2 text-[11px] leading-relaxed text-danger-soft-foreground">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end pt-1">
            <Button type="submit" isDisabled={busy} className="h-9 px-4 text-[11px] font-semibold">
              {busy ? "Changing…" : "Change password"}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={LogOut}
        title="Sign out"
        action={
          <Button
            variant="secondary"
            onPress={() => {
              void logout().then(() => window.location.assign("/"));
            }}
            className="h-9 shrink-0 px-3 text-[11px] font-semibold"
          >
            <LogOut size={13} />
            Sign out
          </Button>
        }
      />
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
    <div className="space-y-4">
      <SettingsSection
        icon={KeyRound}
        title="Pair a device"
        action={
          <Button
            isDisabled={busy}
            onPress={() => void mint()}
            className="h-8 px-3 text-[10.5px] font-semibold"
          >
            {busy ? "Creating…" : pairing ? "New code" : "Create pairing code"}
          </Button>
        }
      >
        {pairing ? (
          <div className="page-enter flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary/50 p-4">
            <div className="min-w-0">
              <p className="select-all font-mono text-[1.8rem] font-semibold leading-none tracking-[0.22em] tabular-nums text-foreground">
                {pairing.code}
              </p>
              <p className="mt-2 text-[10.5px] text-muted">
                Expires {formatPairingExpiry(pairing.expiresAt)}. Generating another code cancels this one.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[10.5px] font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
              >
                {copied ? <Check size={12} className="text-success-soft-foreground" /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setPairing(null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[10.5px] font-semibold text-muted transition-colors hover:text-foreground"
              >
                <RefreshCcw size={12} />
                Hide
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className={cx("text-[10.5px] text-danger-soft-foreground", pairing && "mt-3")}>
            {error}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        icon={Laptop}
        title="This device"
      >
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <Detail label="Name" value={me.data?.device.name ?? "…"} icon={Laptop} />
          <Detail label="Last seen" value={formatPairingExpiry(me.data?.device.lastSeen)} />
          <Detail label="Address" value={me.data?.device.lastIp ?? "Not reported"} mono />
        </dl>
      </SettingsSection>

      <SettingsSection
        icon={Smartphone}
        title="Paired devices"
        flush
      >
        <ul className="divide-y divide-border/50">
          {(devices.data ?? []).map((device) => {
            const current = device.id === currentDeviceId;
            return (
              <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-muted">
                  {device.name.toLowerCase().includes("phone") ? <Smartphone size={14} /> : <Laptop size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-foreground">
                    <span className="truncate">{device.name}</span>
                    {current && <span className="text-[9.5px] font-medium text-muted">This device</span>}
                    {device.revoked && (
                      <span className="text-[9px] font-semibold text-danger-soft-foreground">Revoked</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted">
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
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
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
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[10px] font-semibold text-muted transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger-soft-foreground"
                  >
                    Sign out
                  </button>
                )}
              </li>
            );
          })}
          {!devices.isLoading && active.length === 0 && (
            <li className="px-4 py-6 text-[11px] text-muted sm:px-5">No paired devices yet.</li>
          )}
        </ul>
      </SettingsSection>

      {certificate.data?.fingerprint && (
        <SettingsSection
          icon={ShieldCheck}
          title="Server certificate"
        >
          <p className="select-all break-all rounded-lg border border-border bg-surface-secondary/50 p-3 font-mono text-[10px] text-foreground">
            {certificate.data.fingerprint}
          </p>
        </SettingsSection>
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
    <div className="space-y-4">
      <SettingsSection
        icon={Captions}
        title="Subtitles"
      >
        <div className="divide-y divide-border/60">
          <SettingsToggleRow label="Turn on subtitles">
            <Switch
              size="sm"
              aria-label="Turn on subtitles"
              className="switch--compact"
              isSelected={prefs.autoSubtitles}
              onChange={(selected) => update({ autoSubtitles: selected })}
            >
              <Switch.Content>
                <span className="sr-only">Turn on subtitles</span>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </SettingsToggleRow>

          <div className="grid gap-3 pt-3.5 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
            <p className="min-w-0 text-[11.5px] font-semibold text-foreground">Preferred subtitle language</p>
            <Select
              aria-label="Preferred subtitle language"
              selectedKey={prefs.subtitleLanguage}
              onSelectionChange={(key) => update({ subtitleLanguage: String(key) })}
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
          </div>
        </div>
      </SettingsSection>

      {admin && (
        <SettingsSection
          icon={Captions}
          title="Audio language"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
            <p className="min-w-0 text-[11.5px] font-semibold text-foreground">Preferred audio language</p>
            <div className="w-full">
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
                <p role="alert" className="mt-2 text-[10.5px] text-danger-soft-foreground">
                  {saveError}
                </p>
              )}
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        icon={Activity}
        title="Playback diagnostics"
      >
        <SettingsToggleRow label="Share playback diagnostics">
          <Switch
            size="sm"
            aria-label="Share playback diagnostics"
            className="switch--compact"
            isSelected={diagnostics}
            onChange={(enabled) => {
              setDiagnostics(enabled);
              setPlaybackDiagnosticsEnabled(enabled);
            }}
          >
            <Switch.Content>
              <span className="sr-only">Share playback diagnostics</span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </SettingsToggleRow>
      </SettingsSection>
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
      <dt className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted">
        {Icon && <Icon size={11} />}
        {label}
      </dt>
      <dd className={cx("mt-1 truncate text-[12px] font-medium text-foreground", mono && "font-mono text-[11px]")}>
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
      <span className="block text-[11px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[10.5px] text-muted">{hint}</span>}
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
