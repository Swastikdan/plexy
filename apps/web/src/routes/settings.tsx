/// Unified settings dashboard. Personal account, playback, device, and
/// appearance controls sit beside server management, so people stop bouncing
/// between a phone-sized account page and a separate admin screen.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Captions,
  LayoutDashboard,
  Library,
  MonitorSmartphone,
  Palette,
  ScanSearch,
  Server,
  Users,
  UserRound,
} from "lucide-react";
import { accountRequest, getSignedInUser, type AccountUser, type AuthDevice } from "../auth";
import { getClientRuntime } from "../runtime-config";
import { queries } from "../queries";
import { cx } from "../lib/cx";
import { OverviewPanel } from "../components/settings/overview";
import {
  AccountPanel,
  AppearancePanel,
  DevicesPanel,
  PlaybackPanel,
} from "../components/settings/panels";
import {
  LibrariesPanel,
  MatchesPanel,
  ServerPreferencesPanel,
} from "../components/server/panels";
import { UserManagement } from "../components/user-management";

const PERSONAL_TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "account", label: "Account", icon: UserRound },
  { key: "playback", label: "Playback", icon: Captions },
  { key: "devices", label: "Devices", icon: MonitorSmartphone },
  { key: "appearance", label: "Appearance", icon: Palette },
] as const;

const SERVER_TABS = [
  { key: "libraries", label: "Libraries", icon: Library },
  { key: "matches", label: "Fix matches", icon: ScanSearch },
  { key: "users", label: "Users", icon: Users },
  { key: "server", label: "Server", icon: Server },
] as const;

type PersonalTab = (typeof PERSONAL_TABS)[number]["key"];
type ServerTab = (typeof SERVER_TABS)[number]["key"];
type SettingsTab = PersonalTab | ServerTab;

const ALL_TABS: ReadonlySet<string> = new Set([
  ...PERSONAL_TABS.map((tab) => tab.key),
  ...SERVER_TABS.map((tab) => tab.key),
]);

const TAB_META: Record<SettingsTab, { title: string; description: string; group: string }> = {
  overview: {
    group: "Your account",
    title: "Overview",
    description: "Your profile, catalog snapshot, and the controls you use most.",
  },
  account: {
    group: "Your account",
    title: "Account",
    description: "Sign-in details, password, and the session on this device.",
  },
  playback: {
    group: "Your account",
    title: "Playback",
    description: "Subtitle defaults, audio preferences, and diagnostics for this device.",
  },
  devices: {
    group: "Your account",
    title: "Devices",
    description: "Pair a new phone, tablet, or TV and review the devices signed in to your account.",
  },
  appearance: {
    group: "Your account",
    title: "Appearance",
    description: "Choose how Plexy looks on this device. The preference follows this profile, not the server.",
  },
  libraries: {
    group: "Server",
    title: "Libraries",
    description: "Add media folders, rescan a collection, or change an existing library.",
  },
  matches: {
    group: "Server",
    title: "Fix matches",
    description: "Correct a wrong poster or metadata match, or remap a title that Plexy could not identify.",
  },
  users: {
    group: "Server",
    title: "Users",
    description: "Create accounts, set roles and maturity limits, and grant library access.",
  },
  server: {
    group: "Server",
    title: "Server",
    description: "Metadata, network access, playback preparation, updates, and diagnostics.",
  },
};

function SettingsRoute() {
  const { tab } = Route.useSearch();
  const me = useQuery<{ user: AccountUser; device: AuthDevice }>({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser; device: AuthDevice }>("/me"),
  });
  const status = useQuery(queries.serverStatus());
  const runtime = getClientRuntime();
  const role = me.data?.user.role ?? getSignedInUser()?.role;
  const admin =
    role === "admin" && (status.data?.adminAvailable ?? runtime.canManageServer);

  const serverTab = SERVER_TABS.some((entry) => entry.key === tab);
  const effectiveTab: SettingsTab = serverTab && !admin ? "overview" : (tab as SettingsTab);
  const meta = TAB_META[effectiveTab];

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8 lg:pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div className="min-w-0">
          <h1 className="font-sans text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Settings
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Your account and every server control in one place.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted sm:inline-flex">
            <span
              aria-hidden
              className={cx("h-1.5 w-1.5 rounded-full", status.data ? "bg-success" : "bg-warning")}
            />
            {status.data ? `Server v${status.data.version}` : "Connecting"}
          </span>
        </div>
      </header>

      {/* Mobile section switcher */}
      <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1 lg:hidden">
        <nav className="flex min-w-max items-center gap-1 rounded-xl border border-border bg-surface p-1" aria-label="Settings sections">
          {[...PERSONAL_TABS, ...(admin ? SERVER_TABS : [])].map((entry) => {
            const Icon = entry.icon;
            const active = effectiveTab === entry.key;
            return (
              <Link
                key={entry.key}
                to="/settings"
                search={{ tab: entry.key }}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted hover:bg-surface-secondary hover:text-foreground",
                )}
              >
                <Icon size={13} />
                {entry.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-6" aria-label="Settings sections">
            <NavGroup title="Your account" items={PERSONAL_TABS} active={effectiveTab} />
            {admin && <NavGroup title="Server" items={SERVER_TABS} active={effectiveTab} />}
          </nav>
        </aside>

        <section key={effectiveTab} className="page-enter min-w-0" aria-label={meta.title}>
          <header className="mb-5 border-b border-border pb-4">
            <p className="text-[11px] font-semibold text-muted">{meta.group}</p>
            <h2 className="mt-0.5 font-sans text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {meta.title}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{meta.description}</p>
          </header>

          {effectiveTab === "overview" && <OverviewPanel admin={admin} />}
          {effectiveTab === "account" && <AccountPanel admin={admin} />}
          {effectiveTab === "playback" && <PlaybackPanel admin={admin} />}
          {effectiveTab === "devices" && <DevicesPanel />}
          {effectiveTab === "appearance" && <AppearancePanel />}
          {effectiveTab === "libraries" && <LibrariesPanel />}
          {effectiveTab === "matches" && <MatchesPanel />}
          {effectiveTab === "users" && <UserManagement />}
          {effectiveTab === "server" && <ServerPreferencesPanel />}
        </section>
      </div>
    </main>
  );
}

function NavGroup({
  title,
  items,
  active,
}: {
  title: string;
  items: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof LayoutDashboard }>;
  active: SettingsTab;
}) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold text-muted">{title}</p>
      <ul className="mt-2 space-y-0.5">
        {items.map((entry) => {
          const Icon = entry.icon;
          const selected = active === entry.key;
          return (
            <li key={entry.key}>
              <Link
                to="/settings"
                search={{ tab: entry.key }}
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
                  selected
                    ? "bg-surface-secondary text-foreground"
                    : "text-muted hover:bg-surface-secondary/60 hover:text-foreground",
                )}
              >
                <Icon size={15} className={selected ? "text-foreground" : "text-muted"} />
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => {
    const raw = String(search.tab ?? "overview");
    // Legacy admin tabs keep old bookmarks working.
    const mapped =
      raw === "review" ? "matches" : raw === "settings" ? "server" : raw === "logs" ? "server" : raw;
    return { tab: (ALL_TABS.has(mapped) ? mapped : "overview") as SettingsTab };
  },
});
