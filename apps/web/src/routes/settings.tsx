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
import { Page } from "../components/page";
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
    <Page className="pt-4 sm:pt-6">
      {/* Mobile section switcher */}
      <div className="relative -mx-4 mb-6 lg:hidden">
        <div className="scroll-row overflow-x-auto px-4 pb-1">
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
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted hover:bg-surface-secondary hover:text-foreground",
                )}
              >
                <Icon size={12} />
                {entry.label}
              </Link>
            );
          })}
        </nav>
        </div>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background via-background/75 to-transparent" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[14.5rem_minmax(0,1fr)] xl:gap-12">
        <aside className="hidden lg:block">
          <nav className="sticky top-[5.75rem] space-y-7" aria-label="Settings sections">
            <NavGroup title="Your account" items={PERSONAL_TABS} active={effectiveTab} />
            {admin && <NavGroup title="Server" items={SERVER_TABS} active={effectiveTab} />}
          </nav>
        </aside>

        <section key={effectiveTab} className="page-enter min-w-0" aria-label={meta.title}>
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
            <div className="min-w-0">
              <h1 className="font-sans text-xl font-bold tracking-[-0.03em] text-foreground sm:text-2xl">
                {meta.title}
              </h1>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted sm:text-[13px]">{meta.description}</p>
            </div>
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
    </Page>
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
      <p className="eyebrow px-2 pb-1.5">{title}</p>
      <ul className="space-y-0.5">
        {items.map((entry) => {
          const Icon = entry.icon;
          const selected = active === entry.key;
          return (
            <li key={entry.key}>
              <Link
                to="/settings"
                search={{ tab: entry.key }}
                aria-current={selected ? "page" : undefined}
                data-active={selected || undefined}
                className="side-link"
              >
                <Icon size={15} strokeWidth={1.9} className={selected ? "" : "text-muted"} />
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
