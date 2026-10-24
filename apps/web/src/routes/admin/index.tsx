/// Admin (PRD 10.4, loopback-only server-side): libraries + scans, the
/// matching review queue, settings (including the light/dark appearance
/// toggle) and the live log tail. Everything here is reachable only when the
/// browser is the host machine; the server enforces this and reports
/// `adminAvailable: false` otherwise.
import { useState, useEffect, useMemo, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  ScanLine,
  Moon,
  Sun,
  CheckCircle2,
  RotateCw,
  Search,
  ExternalLink,
  Film,
  Download,
  Folder,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api, type ReviewEntry } from "../../client";
import { queries } from "../../queries";
import { Button, cx } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Dialog } from "../../components/ui/dialog";
import { getTheme, setTheme, type Theme } from "../../theme";
import { cleanSearchTitle, extractYear } from "../../components/fix-match-modal";

const ERROR_TEXT = "text-red-500";

const ADMIN_TABS = ["libraries", "review", "settings", "logs"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

function AdminRoute() {
  const { tab = "libraries" } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery(queries.serverStatus());
  const [refreshing, setRefreshing] = useState(false);

  const tabs = [
    ["libraries", "Libraries"],
    ["review", "Fix matches"],
    ["settings", "Settings"],
    ["logs", "Logs"],
  ] as const;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["server-status"] }),
        queryClient.invalidateQueries({ queryKey: ["libraries"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["logs"] }),
        queryClient.invalidateQueries({ queryKey: ["optimizer"] }),
        queryClient.invalidateQueries({ queryKey: ["crashes"] }),
      ]);
    } finally {
      window.setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-[1120px] px-4 pb-24 pt-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Server</h1>
          <p className="mt-1 text-xs text-ink-muted">
            v{status.data?.version ?? "…"}
            {status.data?.uptimeSeconds != null && ` · up ${formatUptime(status.data.uptimeSeconds)}`}
            {status.data?.bind && ` · ${status.data.bind}:${status.data.port}`}
          </p>
        </div>
        <Button
          variant="surface"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="h-8 px-3 text-xs font-medium"
          title="Refresh the server status, matches and logs"
        >
          <RotateCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <nav
        className="sticky top-16 z-30 -mx-4 mt-6 overflow-x-auto border-b border-line bg-canvas/95 px-4 backdrop-blur sm:-mx-8 sm:px-8"
        aria-label="Admin sections"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => void navigate({ to: "/admin", search: { tab: key }, replace: true })}
              aria-current={tab === key ? "page" : undefined}
              className={cx(
                "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
                tab === key
                  ? "border-brand-text text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-8">
        {tab === "libraries" && <Libraries />}
        {tab === "review" && <Review />}
        {tab === "settings" && <Settings />}
        {tab === "logs" && <Logs />}
      </div>
      {status.data?.scan?.status === "running" && (
        <div className="mt-10 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted" role="status">
          Scanning: {status.data.scan.filesSeen} files seen, currently{" "}
          <span className="text-ink">{status.data.scan.currentFile}</span>
        </div>
      )}
    </main>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export const Route = createFileRoute("/admin/")({
  component: AdminRoute,
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab } => {
    const tab = String(search.tab ?? "");
    return (ADMIN_TABS as readonly string[]).includes(tab) ? { tab: tab as AdminTab } : {};
  },
});

// --- libraries ---------------------------------------------------------------

function Libraries() {
  const { data, isLoading, isError } = useQuery(queries.libraries());
  const status = useQuery(queries.serverStatus());
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLibrary(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["libraries"] }),
  });

  const rescan = async (id: number) => {
    if (scanning != null) return;
    setScanning(id);
    try {
      await api.scanLibrary(id);
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
    } finally {
      window.setTimeout(() => setScanning(null), 800);
    }
  };

  if (isError) {
    return <p className={`text-sm ${ERROR_TEXT}`}>Administrative tools work only on the machine running Plexy.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">Active Libraries</h2>
        <a href="/setup">
          <Button variant="surface" className="h-8 text-xs font-medium">
            + Add Library
          </Button>
        </a>
      </div>
      {isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {data?.map((lib) => (
        <div key={lib.id} className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold">{lib.name}</p>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">{lib.paths.join(", ")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-[13px]">
            <span className="tabular-nums"><span className="text-ink">{lib.counts.items}</span> <span className="text-ink-muted">matched</span></span>
            {lib.counts.review > 0 && (
              <span className="tabular-nums"><span className="text-amber">{lib.counts.review}</span> <span className="text-ink-muted">review</span></span>
            )}
            {lib.counts.unmatched > 0 && (
              <span className="tabular-nums"><span className="text-ink-muted">{lib.counts.unmatched}</span> unmatched</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton label={`Rescan ${lib.name}`} onClick={() => void rescan(lib.id)} disabled={scanning != null}>
              <ScanLine size={15} className={scanning === lib.id ? "animate-pulse" : ""} />
            </IconButton>
            <IconButton label={`Remove ${lib.name}`} onClick={() => { if (window.confirm(`Remove ${lib.name}? Library records go with it.`)) remove.mutate(lib.id); }}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>
      ))}
      {data?.length === 0 && (
        <p className="text-sm text-ink-muted">No libraries yet. Head to the homepage to add one.</p>
      )}

      {status.data?.recentScans && status.data.recentScans.length > 0 && (
        <div className="pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">Recent scans</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {status.data.recentScans.map((scan) => (
              <li key={scan.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
                <span className="flex items-center gap-2 text-ink">
                  <span className={cx(
                    "h-1.5 w-1.5 rounded-full",
                    scan.status === "done" ? "bg-emerald-400" : scan.status === "failed" ? "bg-red-400" : "bg-amber-400",
                  )} />
                  Scan #{scan.id} · {scan.status}
                </span>
                <span className="text-ink-muted">
                  {scan.files_seen ?? 0} files · {scan.issues ?? 0} issues
                </span>
                <span className="text-ink-muted">{formatDateTime(scan.started_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

// --- review queue ------------------------------------------------------------

type ReviewFilter = "attention" | "all" | "matched" | "review" | "unmatched";

const REVIEW_FILTERS: Array<{ key: ReviewFilter; label: string }> = [
  { key: "all", label: "All titles" },
  { key: "attention", label: "Needs attention" },
  { key: "matched", label: "Matched" },
];

function Review() {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const { data, isLoading, isError } = useQuery(
    queries.review({ status: filter, q: debounced || undefined }),
  );
  const [open, setOpen] = useState<ReviewEntry | null>(null);

  const items = data?.items ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-1" role="group" aria-label="Match filter">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-surface-hover text-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {f.label}
              {counts && (
                <span className={cx(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  filter === f.key ? "bg-brand/15 text-brand-text" : "bg-surface-2 text-ink-muted",
                )}>
                  {f.key === "attention" ? counts.attention : f.key === "matched" ? counts.matched : counts.all}
                </span>
              )}
            </button>
          ))}
        </div>

        <label className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink-muted transition-colors focus-within:border-brand/70 lg:w-80">
          <Search size={15} className="shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or file name…"
            aria-label="Search titles and file names"
            className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
          />
        </label>
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        {filter === "attention"
          ? "Plexy is unsure about these titles. Pick the right result, or search TMDB manually."
          : filter === "matched"
            ? "Every matched title is listed here so a wrong poster or metadata match can be remapped. Choosing a new result locks it."
            : "Every movie and show in the library, including correct and incorrect matches. Use search to find the title with the wrong poster."}
      </p>

      {counts && filter === "all" && !debounced && counts.all > items.length && (
        <p className="text-xs text-ink-muted">
          Showing the first {items.length} of {counts.all} titles. Use search to narrow the list.
        </p>
      )}

      {isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {isError && (
        <p className={`text-sm ${ERROR_TEXT}`}>Could not load matches. Administrative tools work only on the machine running Plexy.</p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          {debounced
            ? `No titles match “${debounced}”.`
            : filter === "attention"
              ? "Nothing needs attention. Every title is matched or clearly unmatched."
              : "No titles in this filter."}
        </p>
      )}

      {items.map((entry) => (
        <div key={entry.id} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-surface-2">
            {entry.poster ? (
              <img src={entry.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-muted">
                <Film size={16} aria-hidden />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="truncate font-display font-semibold">{entry.name}</p>
              {entry.year && <span className="text-xs text-ink-muted">{entry.year}</span>}
              <MatchBadge status={entry.matchStatus} />
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted" title={entry.fileName ?? entry.reason ?? undefined}>
              {entry.fileName ?? entry.reason ?? `${entry.matchStatus} match`}
            </p>
            {entry.matchStatus === "matched" && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Currently matched{entry.matchedBy ? ` by ${entry.matchedBy}` : ""}
                {entry.score != null ? ` · ${Math.round(entry.score * 100)}% confidence` : ""}
                {entry.tmdbId ? ` · TMDB ${entry.tmdbId}` : ""}
              </p>
            )}
          </div>

          <Button variant="surface" onClick={() => setOpen(entry)} className="shrink-0">
            {entry.matchStatus === "matched" ? "Remap" : "Fix"}
          </Button>
        </div>
      ))}

      <Dialog.Root open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[min(94vw,640px)]">
            <Dialog.Title>Match {open?.name}</Dialog.Title>
            <p className="mt-1 text-sm text-ink-muted">
              Pick the correct title, or search for a better one. Applying a match locks it; rescans never overwrite manual matches.
            </p>
            {open && <FixMatch entry={open} onDone={() => setOpen(null)} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function MatchBadge({ status }: { status: string }) {
  const style = status === "matched"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : status === "review"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : "border-line bg-surface-2 text-ink-muted";
  const label = status === "matched" ? "Matched" : status === "review" ? "Needs review" : "Unmatched";
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", style)}>
      {label}
    </span>
  );
}

function FixMatch({ entry, onDone }: { entry: ReviewEntry; onDone: () => void }) {
  const queryClient = useQueryClient();
  const type: "movie" | "tv" = entry.kind === "movie" ? "movie" : "tv";
  const searchSource = entry.originalName ?? entry.fileName ?? entry.name;
  const [query, setQuery] = useState(() =>
    cleanSearchTitle(searchSource) || entry.name,
  );
  const [year, setYear] = useState(() =>
    extractYear(searchSource) || (entry.year ? String(entry.year) : ""),
  );
  const search = useMutation({
    mutationFn: (text: string) => api.matchSearch(type, text, year ? Number(year) : undefined),
  });
  const apply = useMutation({
    mutationFn: (p: { tmdbId: number }) => api.applyMatch(entry.id, p.tmdbId, type),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["title", entry.id] }),
      ]);
      onDone();
    },
  });

  // Open with useful results already on screen. Search from the file name,
  // not the current (possibly wrong) matched title.
  const didSearch = useRef(false);
  useEffect(() => {
    if (didSearch.current || !query.trim()) return;
    didSearch.current = true;
    search.mutate(query.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
        {entry.originalName && entry.originalName !== entry.fileName && (
          <p className="truncate" title={entry.originalName}>
            Library entry: <span className="text-ink">{entry.originalName}</span>
          </p>
        )}
        {entry.fileName && (
          <p className="truncate" title={entry.fileName}>
            File: <span className="text-ink">{entry.fileName}</span>
          </p>
        )}
        {entry.matchStatus === "matched" && (
          <p>
            Currently matched to <span className="text-ink">{entry.name}</span>
            {entry.tmdbId ? ` (TMDB ${entry.tmdbId})` : ""}. Choosing another result replaces and locks it.
          </p>
        )}
        <a
          href={`/title/${entry.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand-text hover:underline"
        >
          Open title page <ExternalLink size={12} aria-hidden />
        </a>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()); }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search TMDB title…"
          aria-label="TMDB search title"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand/70"
        />
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          placeholder="Year"
          aria-label="Year"
          inputMode="numeric"
          className="h-9 w-20 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand/70"
        />
        <Button variant="surface" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "Searching…" : "Search"}
        </Button>
      </form>

      {search.isError && (
        <p className={`text-sm ${ERROR_TEXT}`}>{search.error.message}</p>
      )}

      {search.data && (
        <div className="space-y-1">
          {search.data.results.map((r) => (
            <button
              key={r.tmdbId}
              onClick={() => apply.mutate({ tmdbId: r.tmdbId })}
              disabled={apply.isPending}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {r.poster && <img src={r.poster} alt="" className="h-14 w-10 rounded object-cover" loading="lazy" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block text-[13px] text-ink-muted">{r.year} · {r.overview?.slice(0, 90) ?? ""}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-brand-text">Use this</span>
            </button>
          ))}
          {search.data.results.length === 0 && (
            <p className="text-sm text-ink-muted">TMDB has nothing for that search.</p>
          )}
        </div>
      )}

      {!search.data && !search.isPending && entry.candidates.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-ink-muted">Auto candidates</p>
          <div className="mt-2 space-y-1">
            {entry.candidates.map((c) => (
              <button
                key={c.tmdbId}
                onClick={() => apply.mutate({ tmdbId: c.tmdbId })}
                disabled={apply.isPending}
                className="flex w-full items-center justify-between gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{c.title} {c.year ? `(${c.year})` : ""}</span>
                  <span className="block text-[13px] text-ink-muted" title={c.reason}>{c.reason}</span>
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-brand-text">{Math.round(c.score * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {apply.isError && <p className={`text-sm ${ERROR_TEXT}`}>{apply.error.message}</p>}
    </div>
  );
}

// --- settings ----------------------------------------------------------------

function Settings() {
  const { data, isError } = useQuery(queries.settings());
  const queryClient = useQueryClient();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [token, setToken] = useState("");
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const applyTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  if (isError || !data) {
    return <p className="text-sm text-ink-muted">Settings are only visible on the machine running Plexy.</p>;
  }
  const s = data.settings;

  return (
    <div className="space-y-8">
      <Section title="Appearance">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-ink-muted">Choose the interface look. The player always stays dark.</p>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex shrink-0 items-center gap-1 rounded-none border border-line bg-surface p-1"
          >
            {(["dark", "light"] as const).map((mode) => (
              <button
                key={mode}
                role="radio"
                aria-checked={theme === mode}
                onClick={() => applyTheme(mode)}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-none px-3 text-[13px] font-medium capitalize transition-colors",
                  theme === mode
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {mode === "dark" ? <Moon size={14} /> : <Sun size={14} />}
                {mode}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="TMDB">
        <p className="text-sm text-ink-muted">
          Token {s.hasTmdbToken ? `present (${s.tokenSource})` : "missing"}. Metadata language {s.metadataLanguage}, region {s.metadataRegion}, posters {s.imageQuality}.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (token.trim()) { await api.updateSettings({ tmdbToken: token.trim() }); setToken(""); }
            const r = await api.testTmdb();
            setTest(r);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={s.hasTmdbToken ? "Replace token" : "TMDB read-access token"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-brand/70"
          />
          <Button variant="surface">Save + test</Button>
        </form>
        {test && (
          <p className={cx("mt-2 flex items-center gap-1.5 text-sm", test.ok ? "text-ink" : ERROR_TEXT)}>
            {test.ok && <CheckCircle2 size={14} className="text-brand-text" />}
            {test.message}
          </p>
        )}
      </Section>

      <Section title="Server">
        <p className="text-sm text-ink-muted">Port {s.port}, binds {s.bindAddress}. The log tail below keeps the last {MAX_LOGS} lines.</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-ink-muted">Log level</span>
          <Select.Root
            value={data.logLevel}
            onValueChange={(v) => save.mutate({ logLevel: String(v) })}
            items={["debug", "info", "warn", "error"].map((l) => ({ value: l, label: l }))}
          >
            <Select.Trigger className="min-w-32">
              <Select.Value />
              <Select.Icon />
            </Select.Trigger>
            <Select.Positioner>
              {["debug", "info", "warn", "error"].map((l) => (
                <Select.Item key={l} value={l}><Select.ItemText>{l}</Select.ItemText></Select.Item>
              ))}
            </Select.Positioner>
          </Select.Root>
        </div>
      </Section>

      <Section title="Playback preparation">
        <OptimizerSettings />
      </Section>

      <Crashes />
    </div>
  );
}

function OptimizerSettings() {
  const { data } = useQuery(queries.optimizer());
  const { data: settingsData } = useQuery(queries.settings());
  const queryClient = useQueryClient();
  const [cap, setCap] = useState("0");
  const [message, setMessage] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settingsData) setCap(String(settingsData.settings.optimizeMaxCacheGb ?? 0));
  }, [settingsData]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["optimizer"] });
    void queryClient.invalidateQueries({ queryKey: ["server-status"] });
  };

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const run = useMutation({
    mutationFn: api.runOptimization,
    onSuccess: (r) => {
      setMessage(`Queued ${r.requested} file${r.requested === 1 ? "" : "s"}.`);
      refresh();
    },
  });

  const clear = useMutation({
    mutationFn: api.clearOptimizationCache,
    onSuccess: (r) => {
      setMessage(`Removed ${r.removed} prepared cop${r.removed === 1 ? "y" : "ies"}.`);
      refresh();
    },
  });

  if (!data) return <p className="text-sm text-ink-muted">Preparation status unavailable.</p>;

  const done = data.counts.done ?? 0;
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  const cacheGb = (data.cacheBytes / 1024 ** 3).toFixed(2);
  const current = data.current;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {done} of {total} files ready, {cacheGb} GB cached
        {data.running
          ? current
            ? `, preparing file ${current.fileId} (${Math.round(current.progress * 100)}%)`
            : ", preparing"
          : data.queued
            ? `, ${data.queued} queued`
            : ""}
        . Original files are never modified or deleted.
      </p>

      {data.cacheDir && (
        <div className="rounded-xl border border-line bg-surface p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              <Folder size={14} className="text-brand-text" />
              <span>Local Storage Location</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(data.cacheDir!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover transition-colors"
              title="Copy cache directory path"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy path"}</span>
            </button>
          </div>
          <p className="font-mono text-xs text-ink break-all select-all bg-surface-2/60 rounded-lg p-2 border border-line/60">
            {data.cacheDir}
          </p>
        </div>
      )}

      {data.files && data.files.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFiles(!showFiles)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-text hover:underline"
          >
            {showFiles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showFiles ? "Hide prepared files" : `Show prepared local files (${data.files.length})`}</span>
          </button>
          {showFiles && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface divide-y divide-line text-xs">
              {data.files.map((file) => (
                <div key={file.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink truncate">{file.title || file.path.split("/").pop()}</p>
                    <p className="font-mono text-[11px] text-ink-muted truncate" title={file.optimizedPath ?? file.path}>
                      {file.optimizedPath ?? file.path}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-ink">{(file.optimizedSize / 1024 ** 2).toFixed(1)} MB</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={data.enabled}
          onChange={(e) => save.mutate({ autoOptimize: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-brand)]"
        />
        Prepare files automatically after scanning
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-ink-muted">
          <span className="block">Cache limit (GB, 0 = unlimited)</span>
          <input
            type="number"
            min={0}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="mt-1 h-9 w-32 rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink outline-none focus:border-brand/70"
          />
        </label>
        <Button
          variant="surface"
          onClick={() => save.mutate({ optimizeMaxCacheGb: Math.max(0, Math.round(Number(cap) || 0)) })}
        >
          Save limit
        </Button>
        <Button variant="surface" onClick={() => run.mutate()} disabled={run.isPending}>
          Prepare now
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (confirm("Delete every prepared copy? Original media is untouched.")) clear.mutate();
          }}
          disabled={clear.isPending}
        >
          Clear cache
        </Button>
      </div>

      {message && <p className="text-sm text-ink">{message}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// --- logs --------------------------------------------------------------------

const MAX_LOGS = 500;

type LogEntry = {
  raw: string;
  ts: string | null;
  level: string;
  component: string;
  message: string;
  context: unknown;
};

function parseLogLine(raw: string): LogEntry {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      raw,
      ts: typeof value.ts === "string" ? value.ts : null,
      level: typeof value.level === "string" ? value.level : "info",
      component: typeof value.component === "string" ? value.component : "server",
      message: typeof value.message === "string" ? value.message : raw,
      context: value.context,
    };
  } catch {
    return { raw, ts: null, level: "info", component: "raw", message: raw, context: undefined };
  }
}

const LOG_LEVELS = ["all", "debug", "info", "warn", "error"] as const;
type LogLevelFilter = (typeof LOG_LEVELS)[number];

const LEVEL_STYLE: Record<string, string> = {
  debug: "bg-surface-2 text-ink-muted",
  info: "bg-brand/10 text-brand-text",
  warn: "bg-amber/10 text-amber",
  error: "bg-red-500/10 text-red-400",
};

function logTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function Logs() {
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const [component, setComponent] = useState("all");
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const debounced = useDebounce(filter, 300);
  const { data, isError } = useQuery(
    queries.logs({ search: debounced || undefined }),
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const allEntries = useMemo(() => (data ?? []).map(parseLogLine), [data]);
  const components = useMemo(
    () => Array.from(new Set(allEntries.map((e) => e.component))).sort(),
    [allEntries],
  );
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const entry of allEntries) counts[entry.level] = (counts[entry.level] ?? 0) + 1;
    return counts;
  }, [allEntries]);
  const entries = useMemo(
    () => allEntries.filter((entry) =>
      (level === "all" || entry.level === level)
      && (component === "all" || entry.component === component)),
    [allEntries, level, component],
  );

  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, follow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entries.map((e) => e.raw).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard permission denied */
    }
  };

  const download = () => {
    const blob = new Blob([entries.map((e) => e.raw).join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plexy-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink-muted transition-colors focus-within:border-brand/70">
          <Search size={15} className="shrink-0" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter log messages…"
            aria-label="Filter log lines"
            className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
          />
        </label>

        <Select.Root
          value={component}
          onValueChange={(v) => setComponent(String(v))}
          items={[
            { value: "all", label: "All components" },
            ...components.map((c) => ({ value: c, label: c })),
          ]}
        >
          <Select.Trigger aria-label="Filter by component" className="min-w-40">
            <Select.Value />
            <Select.Icon />
          </Select.Trigger>
          <Select.Positioner>
            <Select.Item value="all"><Select.ItemText>All components</Select.ItemText></Select.Item>
            {components.map((c) => (
              <Select.Item key={c} value={c}><Select.ItemText>{c}</Select.ItemText></Select.Item>
            ))}
          </Select.Positioner>
        </Select.Root>

        <Button variant="surface" onClick={() => void copy()} className="h-9 shrink-0 px-3 text-xs">
          {copied ? <CheckCircle2 size={14} /> : null}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="surface" onClick={download} disabled={entries.length === 0} className="h-9 shrink-0 px-3 text-xs">
          <Download size={14} />
          Download
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by level">
          {LOG_LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
                level === l
                  ? "border-line-strong bg-surface-hover text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {l}
              <span className="tabular-nums opacity-60">
                {l === "all" ? allEntries.length : levelCounts[l] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
          />
          Follow newest
        </label>
      </div>

      <p className="text-xs text-ink-muted">
        Live tail · showing {entries.length} of {allEntries.length} kept lines (last {MAX_LOGS}) · refreshes every 3s
        {isError && <span className="text-red-500"> · could not read logs</span>}
      </p>

      <div
        ref={scrollRef}
        className="max-h-[560px] overflow-auto rounded-xl border border-line bg-surface font-mono"
        role="log"
        aria-live="polite"
      >
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            {allEntries.length === 0 ? "No log lines yet." : "No lines match these filters."}
          </p>
        ) : (
          entries.map((entry, i) => <LogRow key={`${entry.ts ?? "raw"}-${i}`} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const hasContext = entry.context !== undefined && entry.context !== null;
  return (
    <div className="border-b border-line/60 px-3 py-1.5 text-[12px] leading-relaxed last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
        <span className="w-[68px] shrink-0 pt-px text-[11px] tabular-nums text-ink-muted/70">
          {logTime(entry.ts)}
        </span>
        <span className={cx(
          "w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide",
          LEVEL_STYLE[entry.level] ?? "bg-surface-2 text-ink-muted",
        )}>
          {entry.level}
        </span>
        <span className="w-20 shrink-0 truncate pt-px text-[11px] text-brand-text">
          {entry.component}
        </span>
        <span className="min-w-0 flex-1 basis-full whitespace-pre-wrap break-words text-ink sm:basis-0">
          {entry.message}
        </span>
      </div>
      {hasContext && (
        <details className="mt-1 sm:pl-[108px]">
          <summary className="cursor-pointer list-none text-[11px] text-ink-muted transition-colors hover:text-ink">
            Details
          </summary>
          <pre className="mt-1 max-h-56 overflow-auto rounded bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
            {JSON.stringify(entry.context, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// --- crashes -----------------------------------------------------------------

function Crashes() {
  const { data } = useQuery(queries.crashes());
  if (!data?.length) return null;
  return (
    <Section title="Crash reports">
      <ul className="space-y-1 text-sm">
        {data.slice(0, 8).map((c) => (
          <li key={c.id}>
            <a
              href={`/api/crashes/${c.id}`}
              download
              className="text-ink-muted transition-colors hover:text-brand-text"
            >
              {c.ts.replace("T", " ").replace("Z", "")}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
