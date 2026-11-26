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
import { accountRequest, getSignedInUser, type AccountUser, type AuthDevice } from "@/auth";
import { getClientRuntime } from "@/runtime-config";
import { queries } from "@/queries";
import { cx } from "@/lib/cx";
import { Page } from "@/components/page";
import { OverviewPanel } from "@/components/settings/overview";
import {
  AccountPanel,
  AppearancePanel,
  DevicesPanel,
  PlaybackPanel,
} from "@/components/settings/panels";
import {
  LibrariesPanel,
  MatchesPanel,
  ServerPreferencesPanel,
} from "@/components/server/panels";
import { UserManagement } from "@/components/user-management";

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

const TAB_META: Record<SettingsTab, { title: string; group: string }> = {
  overview: {
    group: "Your account",
    title: "Overview",
  },
  account: {
    group: "Your account",
    title: "Account",
  },
  playback: {
    group: "Your account",
    title: "Playback",
  },
  devices: {
    group: "Your account",
    title: "Devices",
  },
  appearance: {
    group: "Your account",
    title: "Appearance",
  },
  libraries: {
    group: "Server",
    title: "Libraries",
  },
  matches: {
    group: "Server",
    title: "Fix matches",
  },
  users: {
    group: "Server",
    title: "Users",
  },
  server: {
    group: "Server",
    title: "Server",
  },
};

function SettingsRoute() {
  const { tab } = Route.useSearch();
  const me = useQuery<{ user: AccountUser; device: AuthDevice }>({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser; device: AuthDevice }>("/me"),
  });
  const status = useQuery({
    ...queries.serverStatus(),
    // Only the admin gate matters here. Without a narrowed selection, the
    // uptime field would re-render the entire settings tree on every poll.
    select: (data) => data.adminAvailable,
  });
  const runtime = getClientRuntime();
  const role = me.data?.user.role ?? getSignedInUser()?.role;
  const admin =
    role === "admin" && (status.data ?? runtime.canManageServer);

  const serverTab = SERVER_TABS.some((entry) => entry.key === tab);
  const effectiveTab: SettingsTab = serverTab && !admin ? "overview" : (tab as SettingsTab);
  const meta = TAB_META[effectiveTab];

  return (
    <Page className="pt-4 sm:pt-6">
      {/* Mobile section switcher */}
      <div className="relative -mx-4 mb-6 lg:hidden">
        <div className="scroll-smooth overflow-x-auto px-4 pb-1 [scroll-snap-type:x_proximity] [scroll-padding-inline:var(--row-inset)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
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
      <p className="text-[0.6875rem] font-semibold tracking-[0.01em] leading-[1.25] text-muted px-2 pb-1.5">{title}</p>      <ul className="space-y-0.5">
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
                className={cx(
                  "relative flex items-center gap-[0.7rem] rounded-[calc(var(--radius)*0.8)] px-[0.65rem] py-[0.56rem] text-[0.8125rem] font-semibold tracking-[-0.01em]",
                  "transition-[color,background-color] duration-[160ms] ease-[var(--ease-out)]",
                  "hover:text-foreground hover:bg-[color-mix(in_oklab,var(--surface-secondary)_72%,transparent)]",
                  selected
                    ? "bg-surface-secondary text-foreground before:absolute before:-left-[0.65rem] before:top-1/2 before:h-[1.15rem] before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent before:content-[''] [&>svg]:text-accent"
                    : "text-muted",
                )}
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
