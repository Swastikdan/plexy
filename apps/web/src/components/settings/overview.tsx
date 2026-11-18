/// Settings dashboard landing page: identity, catalog snapshot, device summary,
/// and the actions people actually reach for.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Camera,
  Captions,
  ChevronRight,
  Film,
  FolderOpen,
  Library,
  MonitorSmartphone,
  Plus,
  ScanLine,
  Server,
  Sparkles,
  Tv,
} from "lucide-react";
import { accountRequest, listDevices, type AccountUser, type AuthDevice } from "../../auth";
import { queries } from "../../queries";
import type { LibraryItem } from "../../client";
import { cx } from "../../lib/cx";
import { UserAvatar } from "../user-avatar";

interface MeResponse {
  user: AccountUser;
  device: AuthDevice;
}

const TYPE_ICON: Record<string, typeof Film> = {
  movies: Film,
  tv: Tv,
  anime: Sparkles,
};

const TYPE_LABEL: Record<string, string> = {
  movies: "Movies",
  tv: "TV shows",
  anime: "Anime",
};

export function OverviewPanel({ admin }: { admin: boolean }) {
  const me = useQuery<MeResponse>({
    queryKey: ["account"],
    queryFn: () => accountRequest<MeResponse>("/me"),
  });
  const libraries = useQuery(queries.libraries());
  const status = useQuery(queries.serverStatus());
  const devices = useQuery({ queryKey: ["my-devices"], queryFn: listDevices });

  const libraryList = libraries.data ?? [];
  const movies = libraryList.filter((library) => library.type === "movies");
  const shows = libraryList.filter((library) => library.type === "tv" || library.type === "anime");
  const movieTitles = sumCount(movies, "items");
  const showTitles = sumCount(shows, "items");
  const needsReview = sumCount(libraryList, "review");
  const activeDevices = (devices.data ?? []).filter((device) => !device.revoked).length;
  const scan = status.data?.scan;

  return (
    <div className="space-y-5">
      <ProfileBanner
        me={me.data}
        admin={admin}
        scanning={scan?.status === "running"}
        online={Boolean(status.data)}
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius)*1.8)] border border-border bg-border xl:grid-cols-4">
        <StatTile icon={Film} label="Movies" value={movieTitles.toLocaleString()} detail={`${movies.length} ${movies.length === 1 ? "library" : "libraries"}`} />
        <StatTile icon={Tv} label="TV shows" value={showTitles.toLocaleString()} detail={`${shows.length} ${shows.length === 1 ? "library" : "libraries"}`} />
        <StatTile
          icon={Library}
          label="Libraries"
          value={String(libraryList.length)}
          detail={needsReview > 0 ? `${needsReview} to review` : "All matched"}
          tone={needsReview > 0 ? "warning" : undefined}
        />
        <StatTile icon={MonitorSmartphone} label="Devices" value={String(activeDevices)} detail="signed in" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)]">
        <LibrarySnapshot libraries={libraryList} admin={admin} loading={libraries.isLoading} />

        <div className="space-y-5">
          <QuickActions admin={admin} />
          <ServerHealth admin={admin} />
        </div>
      </div>
    </div>
  );
}

function ProfileBanner({
  me,
  admin,
  scanning,
  online,
}: {
  me?: MeResponse;
  admin: boolean;
  scanning: boolean;
  online: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-[calc(var(--radius)*2.4)] border border-border bg-surface p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_64%)]"
      />
      <img
        src="/icon.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-10 top-1/2 hidden h-48 w-48 -translate-y-1/2 rotate-[-8deg] opacity-[0.07] sm:block"
      />

      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-5">
        <div className="flex min-w-0 items-center gap-4 xl:gap-5">
          <Link
            to="/settings"
            search={{ tab: "account" }}
            aria-label="Change profile photo"
            title="Change profile photo"
            className="group/avatar relative shrink-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <UserAvatar user={me?.user} size={58} className="rounded-2xl" />
            <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50 text-white opacity-0 transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
              <Camera size={16} />
            </span>
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-sans text-xl font-extrabold tracking-[-0.035em] text-foreground sm:text-2xl">
                {me?.user.username ?? "Your account"}
              </h2>
              <span className="text-[10px] font-medium text-muted">
                {me?.user.role === "admin" ? "Administrator" : "Viewer"}
              </span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MonitorSmartphone size={11} className="shrink-0" />
                <span className="truncate">{me?.device.name ?? "This device"}</span>
              </span>
              <span aria-hidden className="text-muted/35">/</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", online ? "bg-[var(--success)]" : "bg-[var(--warning)]")} />
                {statusLabel(scanning, online)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:ml-auto xl:shrink-0">
          <Link
            to="/settings"
            search={{ tab: "devices" }}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background/45 px-3 text-[11px] font-semibold text-foreground backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-surface-secondary active:scale-[0.97] sm:max-w-[12rem] sm:flex-none xl:flex-none"
          >
            <MonitorSmartphone size={13} />
            Pair a device
          </Link>
          {admin && (
            <Link
              to="/add-library"
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-[11px] font-semibold text-background transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] sm:max-w-[12rem] sm:flex-none xl:flex-none"
            >
              <Plus size={13} />
              Add library
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function statusLabel(scanning: boolean, online: boolean): string {
  if (scanning) return "Scanning libraries";
  return online ? "Server online" : "Connecting to server";
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  detail: string;
  tone?: "warning";
}) {
  return (
    <div className="bg-surface px-4 py-4 sm:px-5 sm:py-4.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted">{label}</span>
        <Icon size={13} className="text-muted/50" aria-hidden />
      </div>
      <p className="mt-2 font-sans text-[1.8rem] font-extrabold leading-none tracking-[-0.05em] text-foreground tabular-nums sm:text-[2rem]">
        {value}
      </p>
      <p className={cx("mt-1.5 text-[10px]", tone === "warning" ? "font-medium text-warning-soft-foreground" : "text-muted")}>
        {detail}
      </p>
    </div>
  );
}

function LibrarySnapshot({
  libraries,
  admin,
  loading,
}: {
  libraries: LibraryItem[];
  admin: boolean;
  loading: boolean;
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Your libraries</h2>
        </div>
        {admin && (
          <Link
            to="/settings"
            search={{ tab: "libraries" }}
            className="group inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          >
            Manage
            <ChevronRight size={12} className="transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>

      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-5 py-7">
          <FolderOpen size={20} className="text-muted" />
          <p className="text-[13px] font-semibold text-foreground">No libraries yet</p>
          <p className="max-w-sm text-[11px] leading-relaxed text-muted">
            {admin
              ? "Add a media type, point Plexy at its folders, and the catalog builds in the background."
              : "Ask an administrator to share a library with your account."}
          </p>
          {admin && (
            <Link
              to="/add-library"
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-secondary px-2.5 py-1.5 text-[10.5px] font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
            >
              <Plus size={12} /> Add a library
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {libraries.map((library) => {
            const Icon = TYPE_ICON[library.type] ?? Film;
            const review = library.counts.review ?? 0;
            return (
              <li key={library.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-secondary/40 sm:px-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-foreground">
                  <Icon size={14} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-foreground">{library.name}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">
                    {TYPE_LABEL[library.type] ?? "Library"}
                    <span className="px-1.5 text-muted/30">/</span>
                    {library.paths.length} folder{library.paths.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[12px] font-semibold tabular-nums text-foreground">
                    {library.counts.items.toLocaleString()}
                  </p>
                  <p className={cx("text-[10px]", review > 0 ? "text-warning-soft-foreground" : "text-muted")}>
                    {review > 0 ? `${review} to review` : "titles"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function QuickActions({ admin }: { admin: boolean }) {
  const actions = [
    ...(admin
      ? [
          { to: "/settings" as const, search: { tab: "matches" as const }, label: "Fix a match", icon: ScanLine },
          { to: "/settings" as const, search: { tab: "libraries" as const }, label: "Manage libraries", icon: Library },
        ]
      : []),
    { to: "/settings" as const, search: { tab: "playback" as const }, label: "Playback defaults", icon: Captions },
    { to: "/settings" as const, search: { tab: "appearance" as const }, label: "Change appearance", icon: Sparkles },
  ];
  return (
    <section className="panel overflow-hidden">
      <header className="border-b border-border/70 px-4 py-3.5 sm:px-5">
        <h2 className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Quick actions</h2>
      </header>
      <ul>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <li key={action.label} className="border-b border-border/45 last:border-b-0">
              <Link
                to={action.to}
                search={action.search}
                className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-secondary/45 sm:px-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-muted transition-colors group-hover:text-foreground">
                  <Icon size={14} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">{action.label}</span>
                <ChevronRight size={13} className="shrink-0 text-muted/40 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ServerHealth({ admin }: { admin: boolean }) {
  const status = useQuery(queries.serverStatus());
  const data = status.data;
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Server health</h2>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted">
          <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", data ? "bg-[var(--success)]" : "bg-[var(--warning)]")} />
          {data ? "Online" : "Connecting"}
        </span>
      </div>
      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3">
        <HealthItem label="Version" value={data?.version ? `v${data.version}` : "…"} />
        <HealthItem label="Uptime" value={data?.uptimeSeconds != null ? formatUptime(data.uptimeSeconds) : "…"} />
        <HealthItem label="Address" value={data?.bind ? `${data.bind}:${data.port}` : "…"} mono />
        <HealthItem label="Scan" value={data?.scan?.status === "running" ? "Running" : "Idle"} />
      </dl>
      {admin && (
        <Link
          to="/settings"
          search={{ tab: "server" }}
          className="group mt-4 inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted transition-colors hover:text-foreground"
        >
          Open server settings
          <ArrowUpRight size={12} className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      )}
    </section>
  );
}

function HealthItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{label}</dt>
      <dd className={cx("mt-0.5 truncate text-[11px] font-medium text-foreground", mono && "font-mono text-[10px]")}>
        {value}
      </dd>
    </div>
  );
}

function sumCount(libraries: LibraryItem[], key: "items" | "review"): number {
  return libraries.reduce((total, library) => total + (library.counts[key] ?? 0), 0);
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
