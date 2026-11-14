/// Settings dashboard landing page: identity, catalog snapshot, device summary,
/// and the actions people actually reach for.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Captions,
  CheckCircle2,
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
  UserRound,
  Users,
} from "lucide-react";
import { accountRequest, listDevices, type AccountUser, type AuthDevice } from "../../auth";
import { queries } from "../../queries";
import type { LibraryItem } from "../../client";
import { cx } from "../../lib/cx";

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
      <ProfileCard
        me={me.data}
        admin={admin}
        scanning={scan?.status === "running"}
        online={Boolean(status.data)}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          icon={Film}
          label="Movies"
          value={movieTitles.toLocaleString()}
          detail={`${movies.length} librar${movies.length === 1 ? "y" : "ies"}`}
        />
        <StatTile
          icon={Tv}
          label="TV shows"
          value={showTitles.toLocaleString()}
          detail={`${shows.length} librar${shows.length === 1 ? "y" : "ies"}`}
        />
        <StatTile
          icon={Library}
          label="Libraries"
          value={String(libraryList.length)}
          detail={needsReview > 0 ? `${needsReview} need review` : "All matched"}
          tone={needsReview > 0 ? "warning" : undefined}
        />
        <StatTile
          icon={MonitorSmartphone}
          label="Devices"
          value={String(activeDevices)}
          detail="signed in"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <LibrarySnapshot libraries={libraryList} admin={admin} loading={libraries.isLoading} />
        <div className="space-y-5">
          <QuickActions admin={admin} />
          <ServerHealth admin={admin} />
        </div>
      </div>

      <RecentActivity admin={admin} />
    </div>
  );
}

function ProfileCard({
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
  const initial = me?.user.username.slice(0, 1).toUpperCase() ?? "?";
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_68%)]"
      />
      <div className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface-secondary font-sans text-xl font-bold text-foreground">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-sans text-xl font-bold tracking-tight text-foreground">
              {me?.user.username ?? "Your account"}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold text-muted">
              {me?.user.role === "admin" ? <Users size={11} /> : <UserRound size={11} />}
              {me?.user.role === "admin" ? "Administrator" : "Viewer"}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MonitorSmartphone size={12} />
              {me?.device.name ?? "This device"}
            </span>
            <span aria-hidden className="text-muted/40">/</span>
            <span className="inline-flex items-center gap-1.5">
              <Server size={12} />
              {statusLabel(scanning, online)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to="/settings"
            search={{ tab: "devices" }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 text-xs font-semibold text-foreground transition-[background-color,transform] duration-150 hover:bg-surface-tertiary active:scale-[0.97]"
          >
            <MonitorSmartphone size={14} />
            Pair a device
          </Link>
          {admin && (
            <Link
              to="/add-library"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97]"
            >
              <Plus size={14} />
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
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Icon size={15} className="text-muted/70" />
      </div>
      <p className="mt-2 font-sans text-2xl font-bold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      <p className={cx("mt-0.5 text-[11px]", tone === "warning" ? "font-medium text-warning-soft-foreground" : "text-muted")}>
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
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Your libraries</h2>
          <p className="mt-0.5 text-xs text-muted">
            What Plexy is scanning on this server.
          </p>
        </div>
        {admin && (
          <Link
            to="/settings"
            search={{ tab: "libraries" }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          >
            Manage
            <ChevronRight size={13} />
          </Link>
        )}
      </header>

      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-surface-secondary/70" />
          ))}
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-5 py-8">
          <FolderOpen size={22} className="text-muted" />
          <p className="text-sm font-semibold text-foreground">No libraries yet</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted">
            {admin
              ? "Add a media type, point Plexy at its folders, and the catalog builds in the background."
              : "Ask an administrator to share a library with your account."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {libraries.map((library) => {
            const Icon = TYPE_ICON[library.type] ?? Film;
            const review = library.counts.review ?? 0;
            return (
              <li key={library.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-secondary text-foreground">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{library.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {TYPE_LABEL[library.type] ?? "Library"}
                    <span className="px-1.5 text-muted/40">/</span>
                    {library.paths.length} folder{library.paths.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {library.counts.items.toLocaleString()}
                  </p>
                  <p className={cx("text-[11px]", review > 0 ? "text-warning-soft-foreground" : "text-muted")}>
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
          { to: "/settings" as const, search: { tab: "matches" as const }, label: "Fix a match", detail: "Correct a poster or metadata result", icon: ScanLine },
          { to: "/settings" as const, search: { tab: "libraries" as const }, label: "Manage libraries", detail: "Folders, rescans, and library names", icon: Library },
        ]
      : []),
    { to: "/settings" as const, search: { tab: "playback" as const }, label: "Playback defaults", detail: "Subtitles, audio, and diagnostics", icon: Captions },
    { to: "/settings" as const, search: { tab: "appearance" as const }, label: "Change appearance", detail: "Light, dark, or follow the system", icon: Sparkles },
  ];
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <header className="border-b border-border px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">Quick actions</h2>
      </header>
      <ul>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <li key={action.label} className="border-b border-border/60 last:border-b-0">
              <Link
                to={action.to}
                search={action.search}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-secondary/60 sm:px-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-muted transition-colors group-hover:text-foreground">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-foreground">{action.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">{action.detail}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-muted/50 transition-transform group-hover:translate-x-0.5" />
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
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Server health</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold text-muted">
          <span
            aria-hidden
            className={cx("h-1.5 w-1.5 rounded-full", data ? "bg-success" : "bg-warning")}
          />
          {data ? "Online" : "Connecting"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <HealthItem label="Version" value={data?.version ? `v${data.version}` : "…"} />
        <HealthItem label="Uptime" value={data?.uptimeSeconds != null ? formatUptime(data.uptimeSeconds) : "…"} />
        <HealthItem label="Address" value={data?.bind ? `${data.bind}:${data.port}` : "…"} mono />
        <HealthItem label="Scan" value={data?.scan?.status === "running" ? "Running" : "Idle"} />
      </dl>
      {admin && (
        <Link
          to="/settings"
          search={{ tab: "server" }}
          className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-foreground"
        >
          Open server settings
          <ArrowUpRight size={13} />
        </Link>
      )}
    </section>
  );
}

function HealthItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={cx("mt-0.5 truncate text-xs font-medium text-foreground", mono && "font-mono text-[11px]")}>
        {value}
      </dd>
    </div>
  );
}

function RecentActivity({ admin }: { admin: boolean }) {
  const status = useQuery(queries.serverStatus());
  const scans = status.data?.recentScans ?? [];
  if (!admin || scans.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Recent scans</h2>
          <p className="mt-0.5 text-xs text-muted">Library discovery runs in the background.</p>
        </div>
        <Link
          to="/settings"
          search={{ tab: "libraries" }}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-foreground"
        >
          All libraries
          <ChevronRight size={13} />
        </Link>
      </header>
      <ul className="divide-y divide-border/60">
        {scans.slice(0, 4).map((scan) => (
          <li key={scan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs sm:px-5">
            <CheckCircle2
              size={14}
              className={cx("shrink-0", scan.status === "failed" ? "text-danger-soft-foreground" : "text-muted")}
            />
            <span className="font-medium text-foreground">
              {scan.status === "running" ? "Scanning" : scan.status === "failed" ? "Scan failed" : "Scan complete"}
            </span>
            <span className="text-muted">
              {scan.files_seen?.toLocaleString() ?? 0} files
            </span>
            <span className="text-muted">
              {scan.issues ? `${scan.issues} issues` : "No issues"}
            </span>
            <span className="ml-auto tabular-nums text-muted">
              {formatWhen(scan.finished_at ?? scan.started_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
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

function formatWhen(value: string | null | undefined): string {
  if (!value) return "Just now";
  try {
    const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return value;
    const now = Date.now();
    const delta = now - date.getTime();
    if (delta < 60_000) return "Just now";
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return value;
  }
}
