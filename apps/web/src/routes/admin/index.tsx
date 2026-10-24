/// Admin (PRD 10.4, loopback-only server-side): libraries + scans, the
/// matching review queue, settings (including the light/dark appearance
/// toggle) and the live log tail. Everything here is reachable only when the
/// browser is the host machine; the server enforces this and reports
/// `adminAvailable: false` otherwise.
import { useState, useEffect, useMemo, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  ScanLine,
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
  Server,
  HardDrive,
  FileText,
  X,
} from "lucide-react";
import { api, type ReviewEntry } from "../../client";
import { getApiBase, hasServerOverride } from "../../server-config";
import { queries } from "../../queries";
import { Button, cx } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Dialog } from "../../components/ui/dialog";
import { cleanSearchTitle, extractYear } from "../../components/fix-match-modal";
import { PageLoader } from "../../components/page-loader";

const ERROR_TEXT = "text-red-500";

const ADMIN_TABS = ["libraries", "review", "settings", "logs"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

function AdminRoute() {
  const { tab = "libraries" } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery(queries.serverStatus());
  const [refreshing, setRefreshing] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set([tab]));

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  const tabs = [
    ["libraries", "Libraries"],
    ["review", "Fix matches"],
    ["settings", "Settings"],
    ["logs", "Logs"],
  ] as const;

  const switchTab = (nextTab: AdminTab) => {
    if (nextTab === tab) return;

    // If scrolled past sticky navigation, gently align with tab header to prevent jump
    if (navRef.current) {
      const rect = navRef.current.getBoundingClientRect();
      if (rect.top < 64) {
        window.scrollTo({
          top: window.scrollY + rect.top - 68,
          behavior: "smooth",
        });
      }
    }

    void navigate({
      to: "/admin",
      search: { tab: nextTab },
      replace: true,
      resetScroll: false,
    });
  };

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
        ref={navRef}
        className="sticky top-14 sm:top-16 z-30 -mx-4 mt-6 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-8 sm:px-8 "
        aria-label="Admin sections"
      >
        <div className="inline-flex min-w-max items-center gap-1.5 p-1 rounded-xl bg-surface border border-line/60" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              id={`tab-${key}`}
              aria-controls={`panel-${key}`}
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
              className={cx(
                "rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 active:scale-95",
                tab === key
                  ? "bg-brand text-white shadow-xs"
                  : "text-ink-muted hover:text-ink hover:bg-surface-hover/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-8 min-h-[520px]">
        {visitedTabs.has("libraries") && (
          <div
            role="tabpanel"
            id="panel-libraries"
            aria-labelledby="tab-libraries"
            className={tab === "libraries" ? "block animate-in fade-in duration-150" : "hidden"}
          >
            <Libraries />
          </div>
        )}
        {visitedTabs.has("review") && (
          <div
            role="tabpanel"
            id="panel-review"
            aria-labelledby="tab-review"
            className={tab === "review" ? "block animate-in fade-in duration-150" : "hidden"}
          >
            <Review />
          </div>
        )}
        {visitedTabs.has("settings") && (
          <div
            role="tabpanel"
            id="panel-settings"
            aria-labelledby="tab-settings"
            className={tab === "settings" ? "block animate-in fade-in duration-150" : "hidden"}
          >
            <Settings />
          </div>
        )}
        {visitedTabs.has("logs") && (
          <div
            role="tabpanel"
            id="panel-logs"
            aria-labelledby="tab-logs"
            className={tab === "logs" ? "block animate-in fade-in duration-150" : "hidden"}
          >
            <Logs />
          </div>
        )}
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
      {isLoading && !data && <PageLoader />}
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
    </div>
  );
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
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.review({ status: filter, q: debounced || undefined }),
  );
  const [open, setOpen] = useState<ReviewEntry | null>(null);

  const items = data?.items ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-line/60 bg-surface p-1" role="group" aria-label="Match filter">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-all duration-150 active:scale-95",
                filter === f.key
                  ? "bg-brand text-white shadow-xs"
                  : "text-ink-muted hover:text-ink hover:bg-surface-hover/50",
              )}
            >
              <span>{f.label}</span>
              {counts && (
                <span className={cx(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                  filter === f.key ? "bg-white/20 text-white" : "bg-surface-2 text-ink-muted",
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

      {isLoading && !data && <PageLoader />}
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

      <div className={cx("space-y-3 transition-opacity duration-150", isFetching && "opacity-70")}>
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
      </div>

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
  const { data, isError, isLoading } = useQuery(queries.settings());
  const { data: streamTitles } = useQuery({
    queryKey: ["stream-preparation-titles"],
    queryFn: () => api.items({ limit: 5000 }),
  });
  const { data: streamStatus } = useQuery({
    queryKey: ["stream-preparation"],
    queryFn: api.streamPreparationStatus,
    refetchInterval: 2000,
  });
  const queryClient = useQueryClient();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [token, setToken] = useState("");
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [streamTitleSearch, setStreamTitleSearch] = useState("");
  const [selectedStreamTitleIds, setSelectedStreamTitleIds] = useState<number[]>([]);

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const clearCache = useMutation({
    mutationFn: api.clearTmdbCache,
    onSuccess: ({ removed }) => setCacheMessage(`Cleared ${removed} cached TMDB response${removed === 1 ? "" : "s"}.`),
  });

  const generateStreamVariants = useMutation({
    mutationFn: api.runStreamPreparation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-preparation"] });
    },
  });

  const cancelStreamVariants = useMutation({
    mutationFn: api.cancelStreamPreparation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-preparation"] });
    },
  });

  const resetLocalData = useMutation({
    mutationFn: api.resetLocalData,
    onSuccess: async ({ libraries, files, titles }) => {
      setResetOpen(false);
      setResetPhrase("");
      setResetMessage(`Reset complete. Cleared ${titles} titles and ${files} indexed files. Kept ${libraries} configured libraries and their folders; rescan them to rebuild the catalog.`);
      await queryClient.invalidateQueries();
    },
  });

  if (isLoading && !data) return <PageLoader className="min-h-[36vh]" />;

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">
        Settings are only accessible when connecting from the machine running Plexy.
      </div>
    );
  }
  const s = data.settings;
  const selectableStreamTitles = (streamTitles?.items ?? []).filter((item) => item.kind === "movie" || item.kind === "series");
  const filteredStreamTitles = selectableStreamTitles.filter((item) => item.name.toLowerCase().includes(streamTitleSearch.trim().toLowerCase()));
  const selectedStreamTitleSet = new Set(selectedStreamTitleIds);
  const toggleStreamTitle = (id: number) => setSelectedStreamTitleIds((ids) =>
    ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id],
  );

  return (
    <div className="space-y-6">

      {/* TMDB Metadata Card */}
      <div className="rounded-2xl border border-line/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
              <Film size={17} className="text-brand-text" />
              TMDB Metadata
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Matches files to TMDB. Titles, metadata, and watch progress stay in Plexy’s local database; images are cached locally after their first download.
            </p>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            {s.hasTmdbToken ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                <Check size={13} />
                Connected ({s.tokenSource})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 text-xs font-semibold text-amber-300">
                Token Required
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {([
            {
              label: "Metadata language",
              value: s.metadataLanguage,
              options: [
                { value: "en-US", label: "English (US)" },
                { value: "en-GB", label: "English (UK)" },
                { value: "hi-IN", label: "Hindi (India)" },
                { value: "ja-JP", label: "Japanese" },
                { value: "ko-KR", label: "Korean" },
                { value: "fr-FR", label: "French" },
                { value: "es-ES", label: "Spanish" },
              ],
              update: (value: string) => save.mutate({ metadataLanguage: value }),
            },
            {
              label: "Region",
              value: s.metadataRegion,
              options: [
                { value: "US", label: "United States" },
                { value: "IN", label: "India" },
                { value: "GB", label: "United Kingdom" },
                { value: "CA", label: "Canada" },
                { value: "AU", label: "Australia" },
                { value: "JP", label: "Japan" },
              ],
              update: (value: string) => save.mutate({ metadataRegion: value }),
            },
            {
              label: "Poster image size",
              value: s.imageQuality,
              options: [
                { value: "w342", label: "342 px wide" },
                { value: "w500", label: "500 px wide" },
                { value: "w780", label: "780 px wide" },
                { value: "original", label: "Original size" },
              ],
              update: (value: string) => save.mutate({ imageQuality: value }),
            },
          ] as const).map((setting) => {
            const options = setting.options.some((option) => option.value === setting.value)
              ? setting.options
              : [{ value: setting.value, label: setting.value }, ...setting.options];
            return (
              <label key={setting.label} className="min-w-0 space-y-1.5">
                <span className="block text-xs font-semibold text-ink-muted">{setting.label}</span>
                <Select.Root
                  value={setting.value}
                  onValueChange={(value) => setting.update(String(value))}
                  items={options}
                >
                  <Select.Trigger className="w-full min-w-0">
                    <Select.Value />
                    <Select.Icon />
                  </Select.Trigger>
                  <Select.Positioner>
                    {options.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        <Select.ItemText>{option.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Positioner>
                </Select.Root>
              </label>
            );
          })}
        </div>

        <p className="text-xs leading-relaxed text-ink-muted">
          The selected width is the TMDB poster source size: <strong className="font-semibold text-ink">w500</strong> means about 500 pixels wide. Larger sources look sharper on big displays and use more storage. Changes apply when metadata is refreshed; existing cached images are kept until then.
        </p>

        <div className="flex flex-col gap-2 border-t border-line/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-relaxed text-ink-muted">
            Clear TMDB responses if you need fresh data. This keeps your library and downloaded artwork.
          </p>
          <Button
            variant="surface"
            onClick={() => clearCache.mutate()}
            disabled={clearCache.isPending}
            className="h-9 shrink-0 px-3 text-xs font-semibold"
          >
            {clearCache.isPending && <RotateCw size={13} className="animate-spin" />}
            {clearCache.isPending ? "Clearing…" : "Clear TMDB cache"}
          </Button>
        </div>
        {cacheMessage && <p className="text-xs font-medium text-brand-text">{cacheMessage}</p>}

        {/* Token input & test */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setTesting(true);
            try {
              if (token.trim()) {
                await api.updateSettings({ tmdbToken: token.trim() });
                setToken("");
                void queryClient.invalidateQueries({ queryKey: ["settings"] });
              }
              const r = await api.testTmdb();
              setTest(r);
            } finally {
              setTesting(false);
            }
          }}
          className="flex flex-col sm:flex-row gap-2 pt-1"
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={s.hasTmdbToken ? "Replace TMDB token…" : "Paste TMDB Read-Access Token…"}
            className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-muted/70 outline-none focus:border-brand/70"
          />
          <Button
            variant="surface"
            disabled={testing}
            className="h-10 px-4 text-xs font-semibold shrink-0"
          >
            {testing ? <RotateCw size={14} className="animate-spin" /> : null}
            {testing ? "Testing…" : "Save & Test"}
          </Button>
        </form>

        {test && (
          <div
            className={cx(
              "flex items-center gap-2 rounded-xl border p-3 text-xs font-medium",
              test.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300",
            )}
          >
            {test.ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-400" /> : null}
            <span>{test.message}</span>
          </div>
        )}
      </div>

      {/* Network & Access Card */}
      <div className="rounded-2xl border border-line/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
            <Server size={17} className="text-brand-text" />
            Network & Access
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Configure how Plexy is accessed on your local network.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3.5 space-y-1.5">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider block">
              LAN Access (Bind Address)
            </span>
            <p className="text-xs text-ink-muted">Control whether phones, tablets and TVs on Wi-Fi can connect.</p>
            <div className="pt-1">
              <Select.Root
                value={s.bindAddress}
                onValueChange={(v) => save.mutate({ bindAddress: String(v) })}
                items={[
                  { value: "127.0.0.1", label: "127.0.0.1 (Local loopback only)" },
                  { value: "0.0.0.0", label: "0.0.0.0 (Allow LAN devices on Wi-Fi)" },
                ]}
              >
                <Select.Trigger className="w-full">
                  <Select.Value />
                  <Select.Icon />
                </Select.Trigger>
                <Select.Positioner>
                  {[
                    { value: "127.0.0.1", label: "127.0.0.1 (Local loopback only)" },
                    { value: "0.0.0.0", label: "0.0.0.0 (Allow LAN devices on Wi-Fi)" },
                  ].map((opt) => (
                    <Select.Item key={opt.value} value={opt.value}>
                      <Select.ItemText>{opt.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Positioner>
              </Select.Root>
            </div>
          </div>

          <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3.5 space-y-1.5">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider block">
              Logging Verbosity
            </span>
            <p className="text-xs text-ink-muted">Server port is {s.port}. Adjust detail level for server logs.</p>
            <div className="pt-1">
              <Select.Root
                value={data.logLevel}
                onValueChange={(v) => save.mutate({ logLevel: String(v) })}
                items={["debug", "info", "warn", "error"].map((l) => ({ value: l, label: `Level: ${l.toUpperCase()}` }))}
              >
                <Select.Trigger className="w-full">
                  <Select.Value />
                  <Select.Icon />
                </Select.Trigger>
                <Select.Positioner>
                  {["debug", "info", "warn", "error"].map((l) => (
                    <Select.Item key={l} value={l}>
                      <Select.ItemText>{`Level: ${l.toUpperCase()}`}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Positioner>
              </Select.Root>
            </div>
          </div>
        </div>
      </div>

      {/* Server Connection Card */}
      <div className="rounded-2xl border border-line/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
              <Server size={17} className="text-brand-text" />
              Server connection
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              This client is connected to{" "}
              <span className="font-medium text-ink">{getApiBase()}</span>.
              {hasServerOverride()
                ? " The address is saved on this device."
                : " It follows the address this page was opened from."}
            </p>
          </div>
          <Link
            to="/connect"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-xs font-semibold text-ink transition-[background-color,border-color,color,transform] duration-150 ease-out hover:bg-surface-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
          >
            Change server…
          </Link>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          Use this when Plexy is hosted on the web and should connect to a
          different Mac or home server. Playback, images and metadata all follow
          the selected address.
        </p>
      </div>

      {/* Playback Preparation Card */}
      <div className="rounded-2xl border border-line/70 bg-surface p-5 sm:p-6 shadow-sm">
        <h2 className="font-display text-base font-bold text-ink flex items-center gap-2 mb-4">
          <HardDrive size={17} className="text-brand-text" />
          Playback Preferences
        </h2>
        <div className="mb-5 grid gap-4 md:grid-cols-1">
          <label className="rounded-xl border border-line/60 bg-surface-2/60 p-3.5 space-y-1.5">
            <span className="block text-xs font-semibold text-ink-muted">Preferred audio language</span>
            <p className="text-xs text-ink-muted">Plexy selects the matching audio track when playback starts. English is the default.</p>
            <Select.Root
              value={s.preferredAudioLanguage}
              onValueChange={(value) => save.mutate({ preferredAudioLanguage: String(value) })}
              items={[
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
              ]}
            >
              <Select.Trigger className="w-full"><Select.Value /><Select.Icon /></Select.Trigger>
              <Select.Positioner>
                {[
                  { value: "en", label: "English" }, { value: "hi", label: "Hindi" },
                  { value: "es", label: "Spanish" }, { value: "fr", label: "French" },
                  { value: "de", label: "German" }, { value: "ja", label: "Japanese" },
                  { value: "ko", label: "Korean" }, { value: "zh", label: "Chinese" },
                  { value: "pt", label: "Portuguese" }, { value: "it", label: "Italian" },
                ].map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Positioner>
            </Select.Root>
          </label>
          <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3.5 space-y-3">
            <div>
              <span className="block text-xs font-semibold text-ink">Generate quality streams</span>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Select the titles to prepare at 360p, 480p, 720p, 1080p, and each video’s maximum source resolution. Choose Auto or a specific quality in the player. Plexy uses hardware acceleration when available and pauses background preparation so this finishes sooner. 4K encoding can still take a while and use extra storage.
              </p>
            </div>
            <label className="block">
              <span className="sr-only">Search titles to prepare</span>
              <input
                type="search"
                value={streamTitleSearch}
                onChange={(event) => setStreamTitleSearch(event.target.value)}
                placeholder="Search titles…"
                className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
              />
            </label>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line/60 bg-surface/60">
              {filteredStreamTitles.length ? filteredStreamTitles.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b border-line/40 px-3 py-2 last:border-b-0 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={selectedStreamTitleSet.has(item.id)}
                    onChange={() => toggleStreamTitle(item.id)}
                    className="accent-brand"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}{item.year ? ` (${item.year})` : ""}</span>
                  <span className="shrink-0 text-[11px] text-ink-muted">{item.kind === "series" ? "Series" : "Movie"}</span>
                </label>
              )) : <p className="p-3 text-sm text-ink-muted">{streamTitles ? "No titles match that search." : "Loading titles…"}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="font-medium text-brand-text hover:underline disabled:opacity-50"
                disabled={!filteredStreamTitles.length}
                onClick={() => setSelectedStreamTitleIds((ids) => [...new Set([...ids, ...filteredStreamTitles.map((item) => item.id)])])}
              >Select shown</button>
              <button
                type="button"
                className="font-medium text-ink-muted hover:text-ink disabled:opacity-50"
                disabled={!selectedStreamTitleIds.length}
                onClick={() => setSelectedStreamTitleIds([])}
              >Clear selection</button>
              <span className="ml-auto text-ink-muted">{selectedStreamTitleIds.length} selected</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="brand"
                disabled={!selectedStreamTitleIds.length || generateStreamVariants.isPending || Boolean(streamStatus?.queued || streamStatus?.running)}
                onClick={() => generateStreamVariants.mutate(selectedStreamTitleIds)}
                className="h-9 px-3 text-xs font-semibold"
              >
                {generateStreamVariants.isPending ? "Queueing…" : "Generate selected titles"}
              </Button>
              {Boolean(streamStatus?.queued || streamStatus?.running || generateStreamVariants.isPending) && (
                <Button
                  variant="danger"
                  disabled={cancelStreamVariants.isPending}
                  onClick={() => cancelStreamVariants.mutate()}
                  className="h-9 px-3 text-xs"
                >{cancelStreamVariants.isPending ? "Cancelling…" : "Cancel generation"}</Button>
              )}
              {streamStatus && streamStatus.total > 0 && (
                <span className="text-xs text-ink-muted">
                  {streamStatus.ready}/{streamStatus.total} ready
                  {streamStatus.queued ? ` · ${streamStatus.queued} queued` : ""}
                  {streamStatus.failed ? ` · ${streamStatus.failed} failed` : ""}
                  {streamStatus.cancelled ? ` · ${streamStatus.cancelled} cancelled` : ""}
                </span>
              )}
            </div>
            {streamStatus?.current && (
              <div className="space-y-1.5">
                <div className="flex justify-between gap-3 text-xs text-ink-muted">
                  <span className="truncate">Preparing {streamStatus.current.title}</span>
                  <span className="shrink-0">{Math.round(streamStatus.current.progress * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(streamStatus.current.progress * 100)}%` }} />
                </div>
              </div>
            )}
            {streamStatus?.error && <p role="alert" className="text-xs text-red-400">Last preparation error: {streamStatus.error}</p>}
            {generateStreamVariants.isError && <p role="alert" className="text-xs text-red-400">{generateStreamVariants.error.message}</p>}
            {cancelStreamVariants.isError && <p role="alert" className="text-xs text-red-400">{cancelStreamVariants.error.message}</p>}
          </div>
        </div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Preparation cache</h3>
        <OptimizerSettings />
      </div>

      <section className="rounded-2xl border border-red-500/25 bg-surface p-5 sm:p-6 shadow-sm">
        <h2 className="font-display text-base font-bold text-ink">Reset local Plexy data</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
          Clears the local catalog, watch progress, match history, scan history, TMDB cache, and downloaded artwork and playback caches. Your configured libraries and folders, video files, and Plexy preferences are kept. Rescan to rebuild the catalog.
        </p>
        <div className="mt-4 flex flex-col items-start gap-2">
          <Button variant="danger" onClick={() => { setResetPhrase(""); setResetOpen(true); }}>
            <Trash2 size={14} /> Reset local data…
          </Button>
          {resetMessage && <p className="text-xs font-medium text-brand-text">{resetMessage}</p>}
          {resetLocalData.isError && <p role="alert" className="text-xs text-red-400">{resetLocalData.error.message}</p>}
        </div>
        <Dialog.Root open={resetOpen} onOpenChange={(open) => { setResetOpen(open); if (!open) setResetPhrase(""); }}>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup>
              <Dialog.Title>Reset local Plexy data?</Dialog.Title>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                This permanently removes your catalog and watch progress, scan history, and cached images and playback files. Your configured libraries and folder paths, original media files, and Plexy preferences will remain untouched. Rescan your libraries to rebuild the catalog.
              </p>
              <label className="mt-5 block space-y-1.5">
                <span className="text-xs font-semibold text-ink-muted">Type RESET to continue</span>
                <input
                  autoFocus
                  value={resetPhrase}
                  onChange={(event) => setResetPhrase(event.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-red-500/60"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="surface" onClick={() => setResetOpen(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  disabled={resetPhrase !== "RESET" || resetLocalData.isPending}
                  onClick={() => resetLocalData.mutate()}
                >
                  {resetLocalData.isPending ? <RotateCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {resetLocalData.isPending ? "Resetting…" : "Reset data"}
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </section>

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
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const current = data.current;

  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3">
          <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block">Prepared Files</span>
          <p className="mt-1 text-lg font-bold text-ink">{done} <span className="text-xs text-ink-muted font-normal">/ {total}</span></p>
        </div>
        <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3">
          <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block">Storage Used</span>
          <p className="mt-1 text-lg font-bold text-ink">{cacheGb} <span className="text-xs text-ink-muted font-normal">GB</span></p>
        </div>
        <div className="rounded-xl border border-line/60 bg-surface-2/60 p-3">
          <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider block">Status</span>
          <p className="mt-1 text-sm font-semibold text-brand-text truncate">
            {data.running
              ? current
                ? `Preparing (${Math.round(current.progress * 100)}%)`
                : "Preparing files…"
              : data.queued
                ? `${data.queued} in queue`
                : "Idle"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-ink-muted">
            <span>Overall completion</span>
            <span>{percent}%</span>
          </div>
          <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden border border-line/40">
            <div
              className="bg-brand h-full rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Local storage directory */}
      {data.cacheDir && (
        <div className="rounded-xl border border-line/60 bg-surface-2/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
              <Folder size={14} className="text-brand-text" />
              <span>Storage Directory</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(data.cacheDir!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover active:scale-95 transition-all"
              title="Copy path"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <p className="font-mono text-xs text-ink break-all select-all bg-surface p-2 rounded-lg border border-line/50">
            {data.cacheDir}
          </p>
        </div>
      )}

      {/* Prepared files collapsible list */}
      {data.files && data.files.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFiles(!showFiles)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-text hover:underline"
          >
            {showFiles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showFiles ? "Hide prepared files" : `Show prepared files (${data.files.length})`}</span>
          </button>
          {showFiles && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface divide-y divide-line text-xs">
              {data.files.map((file) => (
                <div key={file.id} className="p-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink truncate">{file.title || file.path.split("/").pop()}</p>
                    <p className="font-mono text-[11px] text-ink-muted truncate" title={file.optimizedPath ?? file.path}>
                      {file.optimizedPath ?? file.path}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-ink text-xs">{(file.optimizedSize / 1024 ** 2).toFixed(1)} MB</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Background preparation is opt-in to keep idle machines quiet. */}
      <label className="flex items-center gap-2.5 text-xs sm:text-sm text-ink cursor-pointer select-none">
        <input
          type="checkbox"
          checked={data.enabled}
          onChange={(e) => save.mutate({ autoOptimize: e.target.checked })}
          className="h-4 w-4 rounded accent-[var(--color-brand)]"
        />
        <span>Automatically prepare files in the background</span>
      </label>

      {/* Actions and Cache limit */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-2">
        <div className="space-y-1">
          <span className="text-xs text-ink-muted font-medium">Cache limit (GB, 0 = unlimited)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="h-9 w-28 rounded-lg border border-line bg-surface-2 px-3 text-xs sm:text-sm text-ink outline-none focus:border-brand/70"
            />
            <Button
              variant="surface"
              onClick={() => save.mutate({ optimizeMaxCacheGb: Math.max(0, Math.round(Number(cap) || 0)) })}
              className="h-9 px-3 text-xs"
            >
              Save
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="surface"
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="h-9 px-3 text-xs font-semibold"
          >
            Prepare Now
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Delete every prepared copy? Original media is untouched.")) clear.mutate();
            }}
            disabled={clear.isPending}
            className="h-9 px-3 text-xs"
          >
            Clear Cache
          </Button>
        </div>
      </div>

      {message && <p className="text-xs text-brand-text font-medium">{message}</p>}
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
  debug: "bg-surface-2 text-ink-muted border border-white/10",
  info: "bg-brand/15 text-brand-text border border-brand/25",
  warn: "bg-amber/15 text-amber border border-amber/25",
  error: "bg-red-500/15 text-red-400 border border-red-500/25",
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
  const { data, isLoading, isFetching, isError } = useQuery(
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
    <div className="space-y-4">
      {/* Console toolbar */}
      <div className="rounded-2xl border border-line/70 bg-surface p-3.5 sm:p-4 space-y-3 shadow-sm">
        {/* Row 1: Search & Component filter & Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-xs sm:text-sm text-ink-muted transition-colors focus-within:border-brand/70">
            <Search size={14} className="shrink-0 text-ink-muted/80" aria-hidden />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search log messages…"
              aria-label="Filter log lines"
              className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="text-ink-muted hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </label>

          <div className="flex items-center gap-2 shrink-0">
            <Select.Root
              value={component}
              onValueChange={(v) => setComponent(String(v))}
              items={[
                { value: "all", label: "All Components" },
                ...components.map((c) => ({ value: c, label: c })),
              ]}
            >
              <Select.Trigger aria-label="Filter by component" className="h-9 min-w-36 text-xs">
                <Select.Value />
                <Select.Icon />
              </Select.Trigger>
              <Select.Positioner>
                <Select.Item value="all"><Select.ItemText>All Components</Select.ItemText></Select.Item>
                {components.map((c) => (
                  <Select.Item key={c} value={c}><Select.ItemText>{c}</Select.ItemText></Select.Item>
                ))}
              </Select.Positioner>
            </Select.Root>

            <Button
              variant="surface"
              onClick={() => void copy()}
              className="h-9 px-3 text-xs font-medium"
              title="Copy filtered logs"
            >
              {copied ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span className="hidden min-[400px]:inline">{copied ? "Copied" : "Copy"}</span>
            </Button>

            <Button
              variant="surface"
              onClick={download}
              disabled={entries.length === 0}
              className="h-9 px-3 text-xs font-medium"
              title="Download full log file"
            >
              <Download size={13} />
              <span className="hidden min-[400px]:inline">Export</span>
            </Button>

            {typeof window !== "undefined" && window.electronAPI?.openLogs && (
              <Button
                variant="surface"
                onClick={() => void window.electronAPI?.openLogs()}
                className="h-9 px-3 text-xs font-medium"
                title="Reveal Logs in Finder"
              >
                <Folder size={13} />
                <span className="hidden min-[400px]:inline">Finder</span>
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: Level pills & Auto-scroll status */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-line/40">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by level">
            {LOG_LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-all active:scale-95",
                  level === l
                    ? "bg-brand text-white shadow-xs"
                    : "bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-hover",
                )}
              >
                <span>{l}</span>
                <span className={cx(
                  "tabular-nums text-[10px] px-1 py-0.2 rounded font-bold",
                  level === l ? "bg-white/20 text-white" : "text-ink-muted/70",
                )}>
                  {l === "all" ? allEntries.length : levelCounts[l] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
            <span className={cx(
              "h-2 w-2 rounded-full transition-colors",
              follow ? "bg-emerald-400 animate-pulse" : "bg-zinc-600",
            )} />
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--color-brand)]"
            />
            <span>Follow newest</span>
          </label>
        </div>
      </div>

      {/* Info indicator */}
      <div className="flex items-center justify-between text-xs text-ink-muted px-1">
        <span>Showing {entries.length} of {allEntries.length} lines (buffer {MAX_LOGS})</span>
        {isError && <span className="text-red-400 font-medium">Failed to read live logs</span>}
      </div>

      {/* Terminal Viewport */}
      <div className="rounded-2xl border border-line/70 bg-[#0d0d0f] shadow-inner font-mono overflow-hidden">
        {/* Header row on desktop */}
        <div className="hidden sm:grid grid-cols-[76px_58px_110px_1fr] gap-3 px-3 py-2 border-b border-white/10 bg-white/[0.03] text-[11px] font-semibold text-white/50 uppercase tracking-wider">
          <span>Time</span>
          <span>Level</span>
          <span>Component</span>
          <span>Message</span>
        </div>

        {/* Scrollable logs */}
        <div
          ref={scrollRef}
          className="min-h-[360px] max-h-[540px] overflow-auto divide-y divide-white/[0.04]"
          role="log"
          aria-live="polite"
        >
          {isLoading && !data ? (
            <PageLoader label="Loading logs" className="min-h-[360px]" />
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-white/50">
              {allEntries.length === 0 ? "No server log messages recorded yet." : "No log messages match the active filters."}
            </div>
          ) : (
            <div className={cx("transition-opacity duration-150", isFetching && "opacity-70")}>
              {entries.map((entry, i) => <LogRow key={`${entry.ts ?? "raw"}-${i}`} entry={entry} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasContext = entry.context !== undefined && entry.context !== null;

  return (
    <div className="hover:bg-white/[0.03] text-xs transition-colors">
      {/* Desktop view: 4 clean aligned columns */}
      <div className="hidden sm:grid grid-cols-[76px_58px_110px_1fr] items-baseline gap-3 px-3 py-1.5 font-mono">
        <span className="text-[11px] tabular-nums text-white/45 shrink-0">
          {logTime(entry.ts)}
        </span>
        <span className={cx(
          "rounded px-1.5 py-0.2 text-center text-[10px] font-bold uppercase tracking-wide shrink-0",
          LEVEL_STYLE[entry.level] ?? "bg-surface-2 text-ink-muted",
        )}>
          {entry.level}
        </span>
        <span className="truncate text-[11px] font-semibold text-brand-text shrink-0" title={entry.component}>
          {entry.component}
        </span>
        <div className="min-w-0 break-words text-white/90 leading-relaxed">
          <span>{entry.message}</span>
          {hasContext && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="ml-2 text-[10px] text-brand-text hover:underline"
            >
              {expanded ? "[hide context]" : "[context]"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile view: readable stacked card */}
      <div className="sm:hidden p-2.5 space-y-1 font-mono">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={cx(
              "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wide",
              LEVEL_STYLE[entry.level] ?? "bg-surface-2 text-ink-muted",
            )}>
              {entry.level}
            </span>
            <span className="text-[11px] font-semibold text-brand-text">
              {entry.component}
            </span>
          </div>
          <span className="text-[10px] tabular-nums text-white/40">
            {logTime(entry.ts)}
          </span>
        </div>
        <p className="text-xs text-white/90 break-words leading-relaxed">
          {entry.message}
        </p>
        {hasContext && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-brand-text hover:underline"
          >
            {expanded ? "Hide context" : "Show context details"}
          </button>
        )}
      </div>

      {/* Context JSON view */}
      {hasContext && expanded && (
        <pre className="mx-3 mb-2 p-2.5 rounded-lg bg-black/80 border border-white/10 text-[11px] text-white/80 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(entry.context, null, 2)}
        </pre>
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
