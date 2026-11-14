/// Server management panels used by the settings dashboard.
///
/// Libraries and scans, the matching review queue, and server preferences
/// (metadata, network, playback preparation, offline cache, maintenance).
/// These controls only work from the machine running the server; the server
/// enforces that boundary and reports `adminAvailable: false` elsewhere.
import { DesktopServerSettings } from "../../components/desktop-server-settings";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  ScanLine,
  Pencil,
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
  FileText,
  X,
} from "lucide-react";
import { api, type LibraryItem, type ReviewEntry } from "../../client";
import { getApiBase, hasServerOverride } from "../../server-config";
import { queries } from "../../queries";
import { Button, Input, ListBox, Modal, SearchField, Select, Switch } from "@heroui/react";
import { cx } from "../../lib/cx";
import { cleanSearchTitle, extractYear } from "../../components/fix-match-modal";
import { PageLoader } from "../../components/page-loader";
import { LibraryFolderForm } from "../../components/library-folder-form";
import type { DesktopSystemUsage, DesktopUpdateProgress, DesktopUpdateStatus } from "../../electron";
import { clearPrefetchCache, getPrefetchStats, type PrefetchStats } from "../../lib/asset-prefetch";
import { clearLibraryCache, getLastSyncedAt, syncLibrary } from "../../lib/library-cache";

const ERROR_TEXT = "text-danger-soft-foreground";

// --- libraries ---------------------------------------------------------------

export function LibrariesPanel() {
  const { data, isLoading, isError } = useQuery(queries.libraries());
  const status = useQuery(queries.serverStatus());
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState<number | null>(null);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLibrary(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["libraries"] });
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    },
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Active Libraries</h2>
        <Link to="/add-library">
          <Button variant="secondary" className="h-8 text-xs font-medium">
            + Add Library
          </Button>
        </Link>
      </div>
      {isLoading && !data && <PageLoader />}
      {data?.map((lib) => (
        <div key={lib.id} className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold">{lib.name}</p>
            <p className="mt-0.5 truncate text-[13px] text-muted">{lib.paths.join(", ")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-[13px]">
            <span className="tabular-nums"><span className="text-foreground">{lib.counts.items}</span> <span className="text-muted">matched</span></span>
            {lib.counts.review > 0 && (
              <span className="tabular-nums"><span className="text-warning">{lib.counts.review}</span> <span className="text-muted">review</span></span>
            )}
            {lib.counts.unmatched > 0 && (
              <span className="tabular-nums"><span className="text-muted">{lib.counts.unmatched}</span> unmatched</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton label={`Edit ${lib.name}`} onClick={() => setEditing(lib)}>
              <Pencil size={15} />
            </IconButton>
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
        <p className="text-sm text-muted">No libraries yet. Use “Add Library” to choose a media type and folders.</p>
      )}
      <Modal isOpen={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="w-[min(760px,calc(100vw-2rem))] max-w-none">
              <Modal.Header className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <Modal.Heading className="font-sans text-xl font-bold text-foreground">Configure library</Modal.Heading>
                  <p className="mt-1 text-xs text-muted">Change its name, media type, or scanned folders.</p>
                </div>
                <Modal.CloseTrigger className="text-muted hover:text-foreground" aria-label="Close">
                  <X size={18} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body>
                {editing && <LibraryFolderForm key={editing.id} initialLibrary={editing} onComplete={() => setEditing(null)} completeLabel="Save library" />}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
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

export function MatchesPanel() {
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
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-surface p-1" role="group" aria-label="Match filter">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-all duration-150 active:scale-95",
                filter === f.key
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground hover:bg-surface-tertiary/50",
              )}
            >
              <span>{f.label}</span>
              {counts && (
                <span className={cx(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                  filter === f.key ? "bg-black/10 text-background" : "bg-surface-secondary text-muted",
                )}>
                  {f.key === "attention" ? counts.attention : f.key === "matched" ? counts.matched : counts.all}
                </span>
              )}
            </button>
          ))}
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          aria-label="Search titles and file names"
          className="w-full lg:w-80"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search title or file name…" />
            <SearchField.ClearButton aria-label="Clear search" />
          </SearchField.Group>
        </SearchField>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {filter === "attention"
          ? "Plexy is unsure about these titles. Pick the right result, or search TMDB manually."
          : filter === "matched"
            ? "Every matched title is listed here so a wrong poster or metadata match can be remapped. Choosing a new result locks it."
            : "Every movie and show in the library, including correct and incorrect matches. Use search to find the title with the wrong poster."}
      </p>

      {counts && filter === "all" && !debounced && counts.all > items.length && (
        <p className="text-xs text-muted">
          Showing the first {items.length} of {counts.all} titles. Use search to narrow the list.
        </p>
      )}

      {isLoading && !data && <PageLoader />}
      {isError && (
        <p className={`text-sm ${ERROR_TEXT}`}>Could not load matches. Administrative tools work only on the machine running Plexy.</p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          {debounced
            ? `No titles match “${debounced}”.`
            : filter === "attention"
              ? "Nothing needs attention. Every title is matched or clearly unmatched."
              : "No titles in this filter."}
        </p>
      )}

      <div className={cx("space-y-3 transition-opacity duration-150", isFetching && "opacity-70")}>
        {items.map((entry) => (
          <div key={entry.id} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-secondary">
              {entry.poster ? (
                <img src={entry.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">
                  <Film size={16} aria-hidden />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="truncate font-display font-semibold">{entry.name}</p>
                {entry.year && <span className="text-xs text-muted">{entry.year}</span>}
                <MatchBadge status={entry.matchStatus} />
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted" title={entry.fileName ?? entry.reason ?? undefined}>
                {entry.fileName ?? entry.reason ?? `${entry.matchStatus} match`}
              </p>
              {entry.matchStatus === "matched" && (
                <p className="mt-1 text-[11px] text-muted">
                  Currently matched{entry.matchedBy ? ` by ${entry.matchedBy}` : ""}
                  {entry.score != null ? ` · ${Math.round(entry.score * 100)}% confidence` : ""}
                  {entry.tmdbId ? ` · TMDB ${entry.tmdbId}` : ""}
                </p>
              )}
            </div>

            <Button variant="secondary" onPress={() => setOpen(entry)} className="shrink-0">
              {entry.matchStatus === "matched" ? "Remap" : "Fix"}
            </Button>
          </div>
        ))}
      </div>

      <Modal isOpen={!!open} onOpenChange={(isOpen) => !isOpen && setOpen(null)}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="w-[min(94vw,640px)]">
              <Modal.Header>
                <Modal.Heading>Match {open?.name}</Modal.Heading>
                <p className="mt-1 text-sm text-muted">
                  Pick the correct title, or search for a better one. Applying a match locks it; rescans never overwrite manual matches.
                </p>
              </Modal.Header>
              <Modal.Body>
                {open && <FixMatch entry={open} onDone={() => setOpen(null)} />}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function MatchBadge({ status }: { status: string }) {
  const style = status === "matched"
    ? "border-success/30 bg-success/10 text-success-soft-foreground"
    : status === "review"
      ? "border-warning/30 bg-warning/10 text-warning-soft-foreground"
      : "border-border bg-surface-secondary text-muted";
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
      <div className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
        {entry.originalName && entry.originalName !== entry.fileName && (
          <p className="truncate" title={entry.originalName}>
            Library entry: <span className="text-foreground">{entry.originalName}</span>
          </p>
        )}
        {entry.fileName && (
          <p className="truncate" title={entry.fileName}>
            File: <span className="text-foreground">{entry.fileName}</span>
          </p>
        )}
        {entry.matchStatus === "matched" && (
          <p>
            Currently matched to <span className="text-foreground">{entry.name}</span>
            {entry.tmdbId ? ` (TMDB ${entry.tmdbId})` : ""}. Choosing another result replaces and locks it.
          </p>
        )}
        <Link
          to="/title/$itemId"
          params={{ itemId: String(entry.id) }}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted hover:underline"
        >
          Open title page <ExternalLink size={12} aria-hidden />
        </Link>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()); }}
        className="flex flex-wrap gap-2"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search TMDB title…"
          aria-label="TMDB search title"
          className="min-w-0 flex-1"
        />
        <Input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          placeholder="Year"
          aria-label="Year"
          inputMode="numeric"
          className="w-20"
        />
        <Button variant="secondary" isDisabled={search.isPending || !query.trim()}>
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
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-tertiary disabled:opacity-50"
            >
              {r.poster && <img src={r.poster} alt="" className="h-14 w-10 rounded-lg object-cover" loading="lazy" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block text-[13px] text-muted">{r.year} · {r.overview?.slice(0, 90) ?? ""}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-muted">Use this</span>
            </button>
          ))}
          {search.data.results.length === 0 && (
            <p className="text-sm text-muted">TMDB has nothing for that search.</p>
          )}
        </div>
      )}

      {!search.data && !search.isPending && entry.candidates.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Auto candidates</p>
          <div className="mt-2 space-y-1">
            {entry.candidates.map((c) => (
              <button
                key={c.tmdbId}
                onClick={() => apply.mutate({ tmdbId: c.tmdbId })}
                disabled={apply.isPending}
                className="flex w-full items-center justify-between gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-tertiary disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{c.title} {c.year ? `(${c.year})` : ""}</span>
                  <span className="block text-[13px] text-muted" title={c.reason}>{c.reason}</span>
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted">{Math.round(c.score * 100)}%</span>
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

export function ServerPreferencesPanel() {
  const { data, isError, isLoading } = useQuery(queries.settings());
  const status = useQuery(queries.serverStatus());
  const playbackDiagnostics = useQuery(queries.playbackDiagnostics());
  const queryClient = useQueryClient();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [token, setToken] = useState("");
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [openMetadataSelect, setOpenMetadataSelect] = useState<string | null>(null);
  const [skipMessage, setSkipMessage] = useState<string | null>(null);
  const copyLanUrl = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedUrl(url);
        window.setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1500);
      })
      .catch(() => {
        /* clipboard permission denied */
      });
  };

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      // Bind changes only apply on restart; refresh status so the hint appears.
      void queryClient.invalidateQueries({ queryKey: ["server-status"] });
    },
  });

  const clearCache = useMutation({
    mutationFn: api.clearTmdbCache,
    onSuccess: ({ removed }) => setCacheMessage(`Cleared ${removed} cached TMDB response${removed === 1 ? "" : "s"}.`),
  });

  const refreshSkipMarkers = useMutation({
    mutationFn: api.refreshSkipSegments,
    onSuccess: ({ checked, found }) => {
      setSkipMessage(
        checked === 0
          ? "Skip markers are already up to date."
          : `Checked ${checked} title${checked === 1 ? "" : "s"}; found markers for ${found}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["skip-segments"] });
    },
    onError: () => setSkipMessage("Could not refresh skip markers. Check the server log."),
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
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        Settings are only accessible when connecting from the machine running Plexy.
      </div>
    );
  }
  const s = data.settings;
  return (
    <div className="space-y-3">
      <DesktopServerSettings />
      <DesktopUpdateSettings />
      <SystemUsage />
      <details open name="admin-settings" className="group overflow-hidden rounded-xl border border-border/70 bg-surface">
        <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
          <span>
            <span className="block text-sm font-semibold text-foreground">Metadata & episode markers</span>
            <span className="mt-1 block text-xs text-muted">TMDB matching, artwork, language, and skip markers</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
      <div className="rounded-2xl border border-border/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-foreground flex items-center gap-2">
              <Film size={17} className="text-muted" />
              TMDB Metadata
            </h2>
            <p className="mt-1 text-xs text-muted">
              Matches files to TMDB. Titles, metadata, and watch progress stay in Plexy’s local database; images are cached locally after their first download.
            </p>
          </div>
          <div className="shrink-0 self-start sm:self-auto">
            {s.hasTmdbToken ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/25 px-2.5 py-1 text-xs font-semibold text-success-soft-foreground">
                <Check size={13} />
                Connected ({s.tokenSource})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 border border-warning/25 px-2.5 py-1 text-xs font-semibold text-warning-soft-foreground">
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
              <div key={setting.label} className="min-w-0 space-y-1.5">
                <span className="block text-xs font-semibold text-muted">{setting.label}</span>
                <Select
                  aria-label={setting.label}
                  selectedKey={setting.value}
                  isOpen={openMetadataSelect === setting.label}
                  onOpenChange={(open) => setOpenMetadataSelect(open ? setting.label : null)}
                  onSelectionChange={(key) => {
                    setOpenMetadataSelect(null);
                    setting.update(String(key));
                  }}
                  className="w-full min-w-0"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {options.map((option) => (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          textValue={option.label}
                        >
                          {option.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            );
          })}
        </div>

        <p className="text-xs leading-relaxed text-muted">
          The selected width is the TMDB poster source size: <strong className="font-semibold text-foreground">w500</strong> means about 500 pixels wide. Larger sources look sharper on big displays and use more storage. Changes apply when metadata is refreshed; existing cached images are kept until then.
        </p>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-relaxed text-muted">
            Clear TMDB responses if you need fresh data. This keeps your library and downloaded artwork.
          </p>
          <Button
            variant="secondary"
            onPress={() => clearCache.mutate()}
            isDisabled={clearCache.isPending}
            className="h-9 shrink-0 px-3 text-xs font-semibold"
          >
            {clearCache.isPending && <RotateCw size={13} className="animate-spin" />}
            {clearCache.isPending ? "Clearing…" : "Clear TMDB cache"}
          </Button>
        </div>
        {cacheMessage && <p className="text-xs font-medium text-muted">{cacheMessage}</p>}

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
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={s.hasTmdbToken ? "Replace TMDB token…" : "Paste TMDB Read-Access Token…"}
            className="min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            isDisabled={testing}
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
                ? "border-success/30 bg-success/10 text-success-soft-foreground"
                : "border-danger/30 bg-danger/10 text-danger-soft-foreground",
            )}
          >
            {test.ok ? <CheckCircle2 size={15} className="shrink-0 text-success-soft-foreground" /> : null}
            <span>{test.message}</span>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/70 bg-surface p-5 sm:p-6 shadow-sm space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-foreground">Intro, recap &amp; credits</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Look up episode markers from IntroDB while playing. Plexy uses the show’s IMDb ID and episode numbers; when a marker is available, the player offers a skip button. Lookup is off until enabled.
          </p>
        </div>
        <Switch
          isSelected={s.skipSegmentsEnabled}
          onChange={(isSelected) => save.mutate({ skipSegmentsEnabled: isSelected })}
          className="w-full"
        >
          <Switch.Content className="flex w-full items-center justify-between gap-4">
            <span>Enable community skip markers (IntroDB)</span>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            isDisabled={!s.skipSegmentsEnabled || refreshSkipMarkers.isPending}
            onPress={() => refreshSkipMarkers.mutate()}
          >
            {refreshSkipMarkers.isPending && <RotateCw size={13} className="animate-spin" />}
            {refreshSkipMarkers.isPending ? "Refreshing…" : "Refresh markers now"}
          </Button>
          {skipMessage && <p className="text-xs font-medium text-muted">{skipMessage}</p>}
        </div>
        <p className="text-[11px] text-muted">
          Markers are cached in the library database during scans and refreshed when you play an
          episode whose data is missing or stale. Playback continues normally if the title has no
          marker, TMDB cannot resolve its IMDb ID, or the service is unavailable.
        </p>
      </div>

        </div>
      </details>

      {!s.localOnly && (
      <details name="admin-settings" className="group overflow-hidden rounded-xl border border-border/70 bg-surface">
        <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
          <span>
            <span className="block text-sm font-semibold text-foreground">Network & security</span>
            <span className="mt-1 block text-xs text-muted">Local network access, paired devices, and server connection</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
      <div className="rounded-2xl border border-border/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-foreground flex items-center gap-2">
            <Server size={17} className="text-muted" />
            Network & Access
          </h2>
          <p className="mt-1 text-xs text-muted">
            Configure how Plexy is accessed on your local network.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3.5 space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider block">
              LAN Access (Bind Address)
            </span>
            <p className="text-xs text-muted">Control whether phones, tablets and TVs on Wi-Fi can connect.</p>
            <div className="pt-1">
              <Select
                aria-label="LAN access bind address"
                selectedKey={s.bindAddress}
                onSelectionChange={(key) => save.mutate({ bindAddress: String(key) })}
                className="w-full"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {[
                      { value: "127.0.0.1", label: "127.0.0.1 (Local loopback only)" },
                      { value: "0.0.0.0", label: "0.0.0.0 (Allow LAN devices on Wi-Fi)" },
                    ].map((opt) => (
                      <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                        {opt.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3.5 space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider block">
              Logging Verbosity
            </span>
            <p className="text-xs text-muted">Server port is {status.data?.port ?? s.port}. Adjust detail level for server logs.</p>
            <div className="pt-1">
              <Select
                aria-label="Logging verbosity"
                selectedKey={data.logLevel}
                onSelectionChange={(key) => save.mutate({ logLevel: String(key) })}
                className="w-full"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {["debug", "info", "warn", "error"].map((l) => (
                      <ListBox.Item
                        key={l}
                        id={l}
                        textValue={`Level: ${l.toUpperCase()}`}
                      >
                        {`Level: ${l.toUpperCase()}`}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>
        </div>

        {/* Live binding: LAN addresses plus a restart hint when settings and
            the running listener disagree. */}
        {status.data?.restartRequired ? (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs font-medium text-warning-soft-foreground">
            Restart Plexy to apply the new bind address. It is still listening on{" "}
            <span className="font-mono">{status.data.bind}:{status.data.port}</span>.
          </p>
        ) : status.data?.bind === "0.0.0.0" ? (
          status.data.lanUrls?.length ? (
            <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3.5 space-y-2">
              <span className="block text-xs font-semibold text-muted uppercase tracking-wider">
                Remote server address for this network
              </span>
              <ul className="space-y-1.5">
                {status.data.lanUrls.map((url) => (
                  <li key={url} className="flex items-center justify-between gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-muted hover:underline break-all"
                    >
                      {url}
                    </a>
                    <button
                      type="button"
                      onClick={() => copyLanUrl(url)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-tertiary active:scale-95 transition-all"
                      title="Copy address"
                    >
                      {copiedUrl === url ? <Check size={13} className="text-success-soft-foreground" /> : <Copy size={13} />}
                      <span>{copiedUrl === url ? "Copied" : "Copy"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Enter one of these URLs as the server address on another device connected to the same network. Admin actions stay limited to this Mac.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">
              No Wi-Fi or Ethernet address detected. Connect this Mac to your network, then refresh.
            </p>
          )
        ) : (
          <p className="text-xs text-muted">
            Bound to this Mac only. Choose <span className="font-mono">0.0.0.0</span> above and restart
            Plexy to let phones and TVs connect.
          </p>
        )}

        <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3.5 space-y-2">
          <div>
            <span className="block text-xs font-semibold text-muted uppercase tracking-wider">
              Recent playback issues
            </span>
            <p className="mt-1 text-xs text-muted">
              Server v{status.data?.version ?? "—"} · client {window.location.origin} · API {getApiBase()}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Each device opts in from its Playback settings. The server keeps the latest 100 events in memory.
            </p>
          </div>
          {playbackDiagnostics.data?.events.filter((event) => event.kind !== "startup").length ? (
            <ul className="space-y-1.5">
              {playbackDiagnostics.data.events
                .filter((event) => event.kind !== "startup")
                .slice(0, 5)
                .map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className={event.kind === "error" ? "text-danger-soft-foreground" : "text-warning-soft-foreground"}>
                      {event.kind === "error" ? `Playback error ${event.mediaErrorCode ?? ""}` : `Rebuffer ${event.durationMs ?? 0} ms`}
                    </span>
                    <span>{event.path ?? "unknown path"}</span>
                    <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No recent playback errors or rebuffer events recorded.</p>
          )}
        </div>
      </div>


      <div className="rounded-2xl border border-border/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-foreground flex items-center gap-2">
              <Server size={17} className="text-muted" />
              Server connection
            </h2>
            <p className="mt-1 text-xs text-muted">
              This client is connected to{" "}
              <span className="font-medium text-foreground">{getApiBase()}</span>.
              {hasServerOverride()
                ? " The address is saved on this device."
                : " It follows the address this page was opened from."}
            </p>
          </div>
          <Link
            to="/connect"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 text-xs font-semibold text-foreground transition-[background-color,border-color,color,transform] duration-150 ease-out hover:bg-surface-tertiary active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Change server…
          </Link>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Use this when Plexy is hosted on the web and should connect to a
          different Mac or home server. Playback, images and metadata all follow
          the selected address.
        </p>
      </div>

        </div>
      </details>
      )}

      {!s.directPlayOnly && (
        <details name="admin-settings" className="group overflow-hidden rounded-xl border border-border/70 bg-surface">
          <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
            <span>
              <span className="block text-sm font-semibold text-foreground">Playback preparation</span>
              <span className="mt-1 block text-xs text-muted">Prepared copies, cache limits, and encoding health</span>
            </span>
            <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-border p-4 sm:p-5">
            <div className="rounded-2xl border border-border/70 bg-surface p-5 shadow-sm sm:p-6">
              <h2 className="font-display text-base font-bold text-foreground">Preparation cache</h2>
              <p className="mb-4 mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                Files that cannot play directly are prepared in the background.
                Prepared copies start instantly and never replace your originals.
              </p>
              <OptimizerSettings />
            </div>
          </div>
        </details>
      )}

      <details name="admin-settings" className="group overflow-hidden rounded-xl border border-border/70 bg-surface">
        <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
          <span>
            <span className="block text-sm font-semibold text-foreground">Offline library</span>
            <span className="mt-1 block text-xs text-muted">Cache the catalog and its images on this device</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
          <OfflineLibrarySettings />
        </div>
      </details>

      <details name="admin-settings" className="group overflow-hidden rounded-xl border border-danger/25 bg-surface">
        <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-danger-soft-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
          <span>
            <span className="block text-sm font-semibold text-foreground">Maintenance & diagnostics</span>
            <span className="mt-1 block text-xs text-muted">Reset local data and review server crashes</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
      <section className="rounded-2xl border border-danger/25 bg-surface p-5 sm:p-6 shadow-sm">
        <h2 className="font-display text-base font-bold text-foreground">Reset local Plexy data</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Clears the local catalog, watch progress, match history, scan history, TMDB cache, and downloaded artwork and playback caches. Your configured libraries and folders, video files, and Plexy preferences are kept. Rescan to rebuild the catalog.
        </p>
        <div className="mt-4 flex flex-col items-start gap-2">
          <Button variant="danger" onPress={() => { setResetPhrase(""); setResetOpen(true); }}>
            <Trash2 size={14} /> Reset local data…
          </Button>
          {resetMessage && <p className="text-xs font-medium text-muted">{resetMessage}</p>}
          {resetLocalData.isError && <p role="alert" className="text-xs text-danger-soft-foreground">{resetLocalData.error.message}</p>}
        </div>
        <Modal
          isOpen={resetOpen}
          onOpenChange={(isOpen) => {
            setResetOpen(isOpen);
            if (!isOpen) setResetPhrase("");
          }}
        >
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Reset local Plexy data?</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <p className="text-sm leading-relaxed text-muted">
                    This permanently removes your catalog and watch progress, scan history, and cached images and playback files. Your configured libraries and folder paths, original media files, and Plexy preferences will remain untouched. Rescan your libraries to rebuild the catalog.
                  </p>
                  <label className="mt-5 block space-y-1.5">
                    <span className="text-xs font-semibold text-muted">Type RESET to continue</span>
                    <Input
                      autoFocus
                      value={resetPhrase}
                      onChange={(event) => setResetPhrase(event.target.value)}
                      fullWidth
                    />
                  </label>
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="secondary" onPress={() => setResetOpen(false)}>Cancel</Button>
                  <Button
                    variant="danger"
                    isDisabled={resetPhrase !== "RESET" || resetLocalData.isPending}
                    onPress={() => resetLocalData.mutate()}
                  >
                    {resetLocalData.isPending ? <RotateCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {resetLocalData.isPending ? "Resetting…" : "Reset data"}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </section>

      <Crashes />

      <DiagnosticsLogs />
        </div>
      </details>
    </div>
  );
}

function releaseBuild(tag: string | null | undefined): string | undefined {
  return tag?.match(/-build\.(\d+)$/)?.[1];
}

function DesktopUpdateSettings() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    void window.electronAPI.getVersion().then(setInstalledVersion).catch(() => setInstalledVersion(null));
    return window.electronAPI.onUpdateProgress(setUpdateProgress);
  }, []);
  if (!window.electronAPI?.isElectron) return null;

  const check = async () => {
    setChecking(true);
    setMessage(null);
    setUpdateProgress(null);
    try {
      const result = await window.electronAPI!.checkForUpdates();
      setUpdateStatus(result);
      if (result.error) setMessage(`Could not check for updates: ${result.error}`);
      else if (!result.supported) setMessage("Updates are available for the packaged Apple Silicon macOS app.");
      else if (result.updateAvailable && !result.canInstall) setMessage(`Version ${result.latestVersion} is available, but its download or checksum is missing from the release.`);
      else if (result.updateAvailable) setMessage(`Version ${result.latestVersion} is available.`);
      else if (result.currentIsNewer) setMessage("This installed version is newer than the latest published release.");
      else setMessage("You’re up to date.");
    } catch (error) {
      setMessage(`Could not check for updates: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setChecking(false);
    }
  };
  const install = async () => {
    setInstalling(true);
    setMessage("Preparing the update…");
    setUpdateProgress({ phase: "downloading", downloadedBytes: 0, totalBytes: null });
    try { await window.electronAPI!.installUpdate(); }
    catch (error) {
      setMessage(`Could not start the update: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInstalling(false);
      setUpdateProgress(null);
    }
  };
  const currentBuild = releaseBuild(updateStatus?.currentTag);
  const latestBuild = releaseBuild(updateStatus?.latestTag);
  const downloaded = updateProgress?.downloadedBytes ?? 0;
  const total = updateProgress?.totalBytes ?? null;
  const progressPercent = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  const progressLabel = updateProgress?.phase === "downloading"
    ? "Downloading update"
    : updateProgress?.phase === "verifying"
      ? "Verifying download"
      : updateProgress?.phase === "waiting-for-approval"
        ? "Download ready"
        : updateProgress?.phase === "installing"
          ? "Installing and reopening"
          : "";
  const formatUpdateBytes = (bytes: number) => bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(0)} KB`;
  return (
    <section className="rounded-2xl border border-border/70 bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-foreground">Plexy Beta app updates</h2>
          <p className="mt-1 text-xs text-muted">Installed version: {installedVersion ?? "…"}{currentBuild ? ` · build ${currentBuild}` : ""}</p>
          {updateStatus?.latestVersion && <p className="mt-1 text-xs text-muted">Latest release: {updateStatus.latestVersion}{latestBuild ? ` · build ${latestBuild}` : ""}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" isDisabled={checking || installing} onPress={() => void check()}>
            {checking ? <RotateCw size={14} className="animate-spin" /> : <RotateCw size={14} />}
            {checking ? "Checking…" : "Check for updates"}
          </Button>
          {updateStatus?.updateAvailable && updateStatus.canInstall && (
            <Button isDisabled={installing || checking} onPress={() => void install()}>
              {installing ? <RotateCw size={14} className="animate-spin" /> : <Download size={14} />}
              {installing ? "Preparing…" : "Install update"}
            </Button>
          )}
        </div>
      </div>
      {installing && updateProgress && (
        <div className="mt-4 rounded-xl border border-border/70 bg-surface p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">{progressLabel}</span>
            {progressPercent !== null && <span className="tabular-nums text-muted">{progressPercent}%</span>}
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent ?? undefined}
          >
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-150 ${progressPercent === null ? "w-1/3 animate-pulse" : ""}`}
              style={progressPercent === null ? undefined : { width: `${progressPercent}%` }}
            />
          </div>
          {updateProgress.phase === "downloading" && (
            <p className="mt-2 text-xs text-muted">
              {formatUpdateBytes(downloaded)} downloaded
              {total !== null ? ` · ${formatUpdateBytes(Math.max(0, total - downloaded))} left` : ""}
            </p>
          )}
          {updateProgress.phase === "waiting-for-approval" && (
            <p className="mt-2 text-xs text-muted">
              {updateStatus?.requiresAdministrator
                ? "macOS will ask you to authorize replacing Plexy in /Applications. Plexy does not save your password."
                : "Plexy is ready to replace the app and reopen."}
            </p>
          )}
        </div>
      )}
      {updateStatus?.requiresAdministrator && (
        <p className="mt-3 text-xs text-muted">
          Because Plexy is in the shared /Applications folder, macOS asks for administrator approval for each update. For password-free updates, move Plexy Beta.app to your user Applications folder (~/Applications) and open it from there. Plexy never stores your password.
        </p>
      )}
      {message && <p role="status" className={`mt-3 text-xs ${message.startsWith("Could not") || message.includes("missing") ? "text-warning-soft-foreground" : "text-muted"}`}>{message}</p>}
    </section>
  );
}

// --- local prefetch settings -------------------------------------------------

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Bounded integer field that clamps on commit, mirroring the server schema, so
 * typing "500" into a 1–10 field can never send an invalid preferred value.
 */
function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const numeric = Number(draft);
    if (!Number.isFinite(numeric)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(numeric)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="block rounded-xl border border-border/60 bg-surface-secondary/60 p-3.5 space-y-1.5">
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <span className="block text-xs leading-relaxed text-muted">{hint}</span>
      <span className="flex items-center gap-2 pt-1">
        <Input
          type="number"
          min={min}
          max={max}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-24"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * Server-owned prefetch preferences plus this viewer's own cache estimate.
 * The cache lives in this browser/app profile, so the numbers and the clear
 * action here never describe another device's storage.
 */
function OfflineLibrarySettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery(queries.settings());
  const stats = useQuery({
    queryKey: ["prefetch-stats"],
    queryFn: getPrefetchStats,
    refetchInterval: 15_000,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(getLastSyncedAt);

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const sync = useMutation({
    mutationFn: syncLibrary,
    onSuccess: (result) => {
      setLastSyncedAt(getLastSyncedAt());
      setMessage(
        result.ok
          ? `Cached ${result.titles} title${result.titles === 1 ? "" : "s"}, ${result.people} cast page${
              result.people === 1 ? "" : "s"
            }, and ${result.assets} image${result.assets === 1 ? "" : "s"}.`
          : result.reason === "offline"
            ? "Connect to the server to refresh the offline library."
            : result.reason === "playing"
              ? "Playback is running. Refresh the library once it ends."
              : `Could not refresh the library${result.message ? `: ${result.message}` : "."}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["prefetch-stats"] });
    },
  });

  const clear = useMutation({
    mutationFn: async () => {
      const removed = await clearPrefetchCache();
      await clearLibraryCache();
      setLastSyncedAt(null);
      return removed;
    },
    onSuccess: ({ removed, bytes }) => {
      setMessage(
        removed
          ? `Cleared ${removed} cached image${removed === 1 ? "" : "s"} (~${formatMegabytes(bytes)} MB) and the saved catalog.`
          : "The offline cache is already empty.",
      );
      void queryClient.invalidateQueries({ queryKey: ["prefetch-stats"] });
    },
  });

  if (!data) return null;
  const s = data.settings;
  const measured: PrefetchStats | undefined = stats.data;
  const budgetMb = measured ? Math.round(measured.budgetBytes / (1024 * 1024)) : s.prefetchMaxCacheMb;

  return (
    <div className="rounded-2xl border border-border/70 bg-surface p-5 sm:p-6 shadow-sm space-y-4">
      <div>
        <h2 className="font-display text-base font-bold text-foreground flex items-center gap-2">
          <Download size={17} className="text-muted" />
          Offline library
        </h2>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Saves the catalog, title pages, cast pages, and the images they use on this device. With the
          internet down but your Plexy server reachable, every screen still renders and local files still
          play. The sync is a normal client read: it never prepares, converts, or scans anything.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberSetting
          label="Concurrent image downloads"
          hint="Maximum cache requests in flight (1–10)."
          value={s.prefetchMaxConcurrent}
          min={1}
          max={10}
          onCommit={(value) => save.mutate({ prefetchMaxConcurrent: value })}
        />
        <NumberSetting
          label="Image cache budget"
          hint="Estimated ceiling for this device’s offline images (10–500 MB)."
          value={s.prefetchMaxCacheMb}
          min={10}
          max={500}
          suffix="MB"
          onCommit={(value) => save.mutate({ prefetchMaxCacheMb: value })}
        />
      </div>

      {save.isError && <p role="alert" className="text-xs text-danger-soft-foreground">{save.error.message}</p>}

      <div className="border-t border-border/60 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">This device’s copy</h3>
            <p className="text-xs text-muted">
              {measured && !measured.supported
                ? "This browser cannot use managed offline storage, so the library stays online-only here."
                : measured
                  ? `${measured.count} image${measured.count === 1 ? "" : "s"} · ~${formatMegabytes(measured.bytes)} MB of ${budgetMb} MB estimate`
                  : "Reading cache usage…"}
            </p>
            <p className="text-xs text-muted">
              {lastSyncedAt
                ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}.`
                : "Not synced yet. It runs automatically on first load and after each scan."}
            </p>
            <p className="text-[11px] leading-relaxed text-muted">
              Browser storage can evict entries at any time, so this is an estimate, not disk usage.
              Clearing removes only this device’s copies; server artwork and library files stay.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              onPress={() => {
                setMessage(null);
                sync.mutate();
              }}
              isDisabled={sync.isPending}
              className="h-9 px-3 text-xs font-semibold"
            >
              {sync.isPending && <RotateCw size={13} className="animate-spin" />}
              {sync.isPending ? "Syncing…" : "Refresh offline library"}
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                setMessage(null);
                clear.mutate();
              }}
              isDisabled={clear.isPending}
              className="h-9 px-3 text-xs font-semibold"
            >
              {clear.isPending && <RotateCw size={13} className="animate-spin" />}
              {clear.isPending ? "Clearing…" : "Clear cache"}
            </Button>
          </div>
        </div>
        {message && <p className="mt-2 text-xs font-medium text-muted">{message}</p>}
        {sync.isError && <p role="alert" className="mt-2 text-xs text-danger-soft-foreground">{sync.error.message}</p>}
        {clear.isError && <p role="alert" className="mt-2 text-xs text-danger-soft-foreground">{clear.error.message}</p>}
      </div>
    </div>
  );
}

// --- security ----------------------------------------------------------------

/**
 * Device pairing. The server stores only token hashes, so this card is the
 * owner's control surface for remote viewers: mint a one-time code, see who is
 * paired, and revoke a device.
 */
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

  if (!data) return <p className="text-sm text-muted">Preparation status unavailable.</p>;

  const done = data.counts.done ?? 0;
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  const cacheGb = (data.cacheBytes / 1024 ** 3).toFixed(2);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const current = data.current;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider block">Prepared Files</span>
          <p className="mt-1 text-lg font-bold text-foreground">{done} <span className="text-xs text-muted font-normal">/ {total}</span></p>
        </div>
        <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider block">Storage Used</span>
          <p className="mt-1 text-lg font-bold text-foreground">{cacheGb} <span className="text-xs text-muted font-normal">GB</span></p>
        </div>
        <div className="rounded-xl border border-border/60 bg-surface-secondary/60 p-3">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider block">Status</span>
          <p className="mt-1 text-sm font-semibold text-muted truncate">
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

      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted">
            <span>Overall completion</span>
            <span>{percent}%</span>
          </div>
          <div className="w-full bg-surface-secondary rounded-full h-2 overflow-hidden border border-border/40">
            <div
              className="bg-accent h-full rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {data.cacheDir && (
        <div className="rounded-xl border border-border/60 bg-surface-secondary/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted">
              <Folder size={14} className="text-muted" />
              <span>Storage Directory</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(data.cacheDir!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-tertiary active:scale-95 transition-all"
              title="Copy path"
            >
              {copied ? <Check size={13} className="text-success-soft-foreground" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <p className="font-mono text-xs text-foreground break-all select-all bg-surface p-2 rounded-lg border border-border/50">
            {data.cacheDir}
          </p>
        </div>
      )}

      {data.files && data.files.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFiles(!showFiles)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:underline"
          >
            {showFiles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showFiles ? "Hide prepared files" : `Show prepared files (${data.files.length})`}</span>
          </button>
          {showFiles && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface divide-y divide-border text-xs">
              {data.files.map((file) => (
                <div key={file.id} className="p-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{file.title || file.path.split("/").pop()}</p>
                    <p className="font-mono text-[11px] text-muted truncate" title={file.optimizedPath ?? file.path}>
                      {file.optimizedPath ?? file.path}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-foreground text-xs">{(file.optimizedSize / 1024 ** 2).toFixed(1)} MB</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Files that cannot play directly are prepared automatically when they are
        scanned, or the first time playback identifies them. Files that already
        play directly are never copied or re-encoded.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-2">
        <div className="space-y-1">
          <span className="text-xs text-muted font-medium">Cache limit (GB, 0 = unlimited)</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="w-28"
            />
            <Button
              variant="secondary"
              onPress={() => save.mutate({ optimizeMaxCacheGb: Math.max(0, Math.round(Number(cap) || 0)) })}
              className="h-9 px-3 text-xs"
            >
              Save
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="secondary"
            onPress={() => run.mutate()}
            isDisabled={run.isPending}
            className="h-9 px-3 text-xs font-semibold"
          >
            Prepare Now
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              if (confirm("Delete every prepared copy? Original media is untouched.")) clear.mutate();
            }}
            isDisabled={clear.isPending}
            className="h-9 px-3 text-xs"
          >
            Clear Cache
          </Button>
        </div>
      </div>

      {message && <p className="text-xs text-muted font-medium">{message}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// --- logs -------------------------------------------------------------------

/// Logs are a debugging surface, not navigation. They live collapsed under
/// Settings → Advanced → Diagnostics, and the log query only runs while the
/// panel is open.
function DiagnosticsLogs() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex list-none cursor-pointer items-center justify-between gap-4 px-4 py-4 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden sm:px-5">
        <span>
          <span className="block text-sm font-semibold text-foreground">Diagnostics</span>
          <span className="mt-1 block text-xs text-muted">Live server log tail and filters</span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-4 sm:p-5">{open && <Logs />}</div>
    </details>
  );
}

const MAX_LOGS = 500;

type LogEntry = {
  raw: string;
  ts: string | null;
  datetime: string | null;
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
      datetime: typeof value.datetime === "string" ? value.datetime : null,
      level: typeof value.level === "string" ? value.level : "info",
      component: typeof value.component === "string" ? value.component : "server",
      message: typeof value.message === "string" ? value.message : raw,
      context: value.context,
    };
  } catch {
    return { raw, ts: null, datetime: null, level: "info", component: "raw", message: raw, context: undefined };
  }
}

const LOG_LEVELS = ["all", "debug", "info", "warn", "error"] as const;
type LogLevelFilter = (typeof LOG_LEVELS)[number];

const LEVEL_STYLE: Record<string, string> = {
  debug: "bg-surface-secondary text-muted border border-white/10",
  info: "bg-accent/15 text-muted border border-accent/25",
  warn: "bg-warning/15 text-warning border border-warning/25",
  error: "bg-danger/15 text-danger-soft-foreground border border-danger/25",
};

function logTime(entry: LogEntry): string {
  // New log lines include a pre-formatted local `datetime`; legacy/raw lines
  // only carry the ISO `ts`, which we parse into a readable string.
  if (entry.datetime) return entry.datetime;
  const ts = entry.ts;
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
  );
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
      <div className="rounded-2xl border border-border/70 bg-surface p-3.5 sm:p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <SearchField
            value={filter}
            onChange={setFilter}
            aria-label="Filter log lines"
            className="min-w-0 flex-1"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search log messages…" />
              <SearchField.ClearButton aria-label="Clear log filter" />
            </SearchField.Group>
          </SearchField>

          <div className="flex items-center gap-2 shrink-0">
            <Select
              aria-label="Filter by component"
              selectedKey={component}
              onSelectionChange={(key) => setComponent(String(key))}
              className="min-w-36"
            >
              <Select.Trigger className="h-9 text-xs">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all" textValue="All Components">
                    All Components
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {components.map((c) => (
                    <ListBox.Item key={c} id={c} textValue={c}>
                      {c}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Button
              variant="secondary"
              onPress={() => void copy()}
              className="h-9 px-3 text-xs font-medium"
              aria-label="Copy filtered logs"
            >
              {copied ? <CheckCircle2 size={13} className="text-success-soft-foreground" /> : <Copy size={13} />}
              <span className="hidden min-[400px]:inline">{copied ? "Copied" : "Copy"}</span>
            </Button>

            <Button
              variant="secondary"
              onPress={download}
              isDisabled={entries.length === 0}
              className="h-9 px-3 text-xs font-medium"
              aria-label="Download full log file"
            >
              <Download size={13} />
              <span className="hidden min-[400px]:inline">Export</span>
            </Button>

            {typeof window !== "undefined" && window.electronAPI?.openLogs && (
              <Button
                variant="secondary"
                onPress={() => void window.electronAPI?.openLogs()}
                className="h-9 px-3 text-xs font-medium"
                aria-label="Reveal Logs in Finder"
              >
                <Folder size={13} />
                <span className="hidden min-[400px]:inline">Finder</span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-border/40">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by level">
            {LOG_LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-all active:scale-95",
                  level === l
                    ? "bg-foreground text-background"
                    : "bg-surface-secondary text-muted hover:text-foreground hover:bg-surface-tertiary",
                )}
              >
                <span>{l}</span>
                <span className={cx(
                  "tabular-nums text-[10px] px-1 py-0.2 rounded-full font-bold",
                  level === l ? "bg-black/10 text-background" : "text-muted/70",
                )}>
                  {l === "all" ? allEntries.length : levelCounts[l] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <Switch
            size="sm"
            isSelected={follow}
            onChange={setFollow}
          >
            <Switch.Content className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-2">
                <span className={cx(
                  "h-2 w-2 rounded-full transition-colors",
                  follow ? "bg-success animate-pulse" : "bg-default",
                )} />
                Follow newest
              </span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted px-1">
        <span>Showing {entries.length} of {allEntries.length} lines (buffer {MAX_LOGS})</span>
        {isError && <span className="text-danger-soft-foreground font-medium">Failed to read live logs</span>}
      </div>

      <div className="rounded-2xl border border-border bg-surface-secondary shadow-inner font-mono overflow-hidden">
        <div className="hidden sm:grid grid-cols-[76px_58px_110px_1fr] gap-3 px-3.5 py-2.5 border-b border-border bg-surface-tertiary/40 text-[11px] font-semibold text-muted uppercase tracking-wider">
          <span>Time</span>
          <span>Level</span>
          <span>Component</span>
          <span>Message</span>
        </div>

        <div
          ref={scrollRef}
          className="min-h-[360px] max-h-[540px] overflow-auto divide-y divide-border/40"
          role="log"
          aria-live="polite"
        >
          {isLoading && !data ? (
            <PageLoader label="Loading logs" className="min-h-[360px]" />
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted">
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
    <div className="hover:bg-surface-tertiary/40 text-xs transition-colors">
      <div className="hidden sm:grid grid-cols-[76px_58px_110px_1fr] items-baseline gap-3 px-3.5 py-2 font-mono">
        <span className="text-[11px] tabular-nums text-muted shrink-0">
          {logTime(entry)}
        </span>
        <span className={cx(
          "rounded-full px-1.5 py-0.2 text-center text-[10px] font-bold uppercase tracking-wide shrink-0",
          LEVEL_STYLE[entry.level] ?? "bg-surface-secondary text-muted",
        )}>
          {entry.level}
        </span>
        <span className="truncate text-[11px] font-semibold text-muted shrink-0" title={entry.component}>
          {entry.component}
        </span>
        <div className="min-w-0 break-words text-foreground leading-relaxed">
          <span>{entry.message}</span>
          {hasContext && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="ml-2 text-[10px] text-muted hover:underline"
            >
              {expanded ? "[hide context]" : "[context]"}
            </button>
          )}
        </div>
      </div>

      <div className="sm:hidden p-2.5 space-y-1 font-mono">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={cx(
              "rounded-full px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wide",
              LEVEL_STYLE[entry.level] ?? "bg-surface-secondary text-muted",
            )}>
              {entry.level}
            </span>
            <span className="text-[11px] font-semibold text-muted">
              {entry.component}
            </span>
          </div>
          <span className="text-[10px] tabular-nums text-muted">
            {logTime(entry)}
          </span>
        </div>
        <p className="text-xs text-foreground break-words leading-relaxed">
          {entry.message}
        </p>
        {hasContext && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-muted hover:underline"
          >
            {expanded ? "Hide context" : "Show context details"}
          </button>
        )}
      </div>

      {hasContext && expanded && (
        <pre className="mx-3.5 mb-2.5 p-3 rounded-xl bg-surface-tertiary/60 border border-border text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap">
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
              className="text-muted transition-colors hover:text-muted"
            >
              {c.ts.replace("T", " ").replace("Z", "")}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SystemUsage() {
  const [live, setLive] = useState(false);
  const [desktopUsage, setDesktopUsage] = useState<DesktopSystemUsage | null>(null);
  const [usageHistory, setUsageHistory] = useState<Array<{ cpu: number; memory: number }>>([]);
  const [transferred, setTransferred] = useState(() => getTransferredBytes());
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshingRef = useRef(false);
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { downlink?: number; effectiveType?: string; rtt?: number } };
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  const refresh = useCallback(async (sampleUsage = true) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      if (sampleUsage && window.electronAPI?.isElectron) {
        try {
          const usage = await window.electronAPI.getSystemUsage();
          setDesktopUsage(usage);
          setUsageHistory((history) => [...history, {
            cpu: Math.max(0, Math.min(100, usage.cpuPercent)),
            memory: usage.appMemoryBytes / 1024 ** 2,
          }].slice(-60));
        } catch { setDesktopUsage(null); }
      }
      setTransferred(getTransferredBytes());
      setNow(Date.now());
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (!live) return;
    let timer: number | undefined;
    let usageTimer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (usageTimer !== undefined) window.clearInterval(usageTimer);
      timer = document.hidden ? undefined : window.setInterval(() => void refresh(false), 1000);
      usageTimer = document.hidden ? undefined : window.setInterval(() => void refresh(true), 5000);
    };
    const onVisibilityChange = () => {
      schedule();
      if (!document.hidden) void refresh(true);
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (usageTimer !== undefined) window.clearInterval(usageTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [live, refresh]);
  const memory = perf.memory;
  const gpu = "Unavailable";
  const fmtBytes = (bytes: number) => bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return (
    <Section title="System usage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{desktopUsage ? "Plexy desktop process metrics" : "Browser-visible estimates"} · {refreshing ? "refreshing…" : `updated ${new Date(now).toLocaleTimeString()}`}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-8 px-3 text-xs" onPress={() => void refresh()} isDisabled={refreshing}>Refresh</Button>
          <Button variant={live ? "primary" : "secondary"} className="h-8 px-3 text-xs" onPress={() => setLive((value) => !value)}>{live ? "Live · 1s / 5s" : "Live updates off"}</Button>
        </div>
      </div>
      {live && desktopUsage && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <UsageGraph title="CPU" value={desktopUsage.cpuPercent} history={usageHistory.map((point) => point.cpu)} />
          <UsageGraph title="Plexy memory" value={desktopUsage.appMemoryBytes / 1024 ** 2} suffix=" MB" maxValue={desktopUsage.systemMemoryTotalBytes / 1024 ** 2} history={usageHistory.map((point) => point.memory)} detail={`${fmtBytes(desktopUsage.systemMemoryFreeBytes)} free of ${fmtBytes(desktopUsage.systemMemoryTotalBytes)} system memory`} />
        </div>
      )}
      {live && !desktopUsage && <p className="mt-4 rounded-xl border border-border/70 bg-surface px-4 py-3 text-sm text-muted">Live system graphs are available in the Plexy desktop app. This browser does not expose CPU and memory process metrics.</p>}
      {!live && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UsageMetric title="Plexy CPU" value={desktopUsage ? `${desktopUsage.cpuPercent.toFixed(1)}%` : `${navigator.hardwareConcurrency || "—"} logical cores`} detail={desktopUsage ? "Combined Plexy desktop processes" : "Live CPU load is unavailable in browser mode"} />
        <UsageMetric title="Memory" value={desktopUsage ? `${fmtBytes(desktopUsage.appMemoryBytes)} Plexy` : memory ? `${fmtBytes(memory.usedJSHeapSize)} page heap` : "Unavailable"} detail={desktopUsage ? `${fmtBytes(desktopUsage.systemMemoryFreeBytes)} OS-reported free of ${fmtBytes(desktopUsage.systemMemoryTotalBytes)} total` : nav.deviceMemory ? `Device memory: ~${nav.deviceMemory} GB` : "Device memory estimate unavailable"} />
        <UsageMetric title="GPU" value={desktopUsage && desktopUsage.appGpuMemoryBytes > 0 ? `${fmtBytes(desktopUsage.appGpuMemoryBytes)} Plexy GPU process` : gpu} detail={desktopUsage ? "GPU memory is estimated from the Plexy GPU process; utilization is not exposed" : "Renderer reported by this browser"} />
        <UsageMetric title="Network" value={nav.connection?.effectiveType ?? "Connection estimate unavailable"} detail={nav.connection?.downlink ? `Estimated ${nav.connection.downlink} Mbps · ${nav.connection.rtt ?? "—"} ms RTT` : "Live throughput is not exposed by this browser"} />
        <UsageMetric title="Page data" value={fmtBytes(transferred)} detail="Transfer size across resources loaded in this tab" />
      </div>}
      <p className="mt-4 text-[11px] text-muted">{live ? "The graph shows the last five minutes. CPU and memory samples refresh every five seconds; the status line refreshes every second." : "CPU and memory describe Plexy’s desktop processes plus system memory availability. Page data is a cumulative browser transfer estimate; network throughput and GPU utilization are not exposed."}</p>
    </Section>
  );
}

function getTransferredBytes() {
  return (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
}

function UsageMetric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-border/70 bg-surface px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p><p className="mt-1 truncate text-sm font-semibold" title={value}>{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></div>;
}

function UsageGraph({ title, value, suffix = "%", maxValue = 100, history, detail }: { title: string; value: number; suffix?: string; maxValue?: number; history: number[]; detail?: string }) {
  const points = history.length > 1 ? history : [value, value];
  const scale = maxValue > 0 ? maxValue : 100;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${(index / (points.length - 1)) * 100} ${36 - (Math.max(0, Math.min(scale, point)) / scale) * 30}`).join(" ");
  return <div className="overflow-hidden rounded-xl border border-border/70 bg-surface px-4 py-3">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>{detail && <p className="mt-1 text-[11px] text-muted">{detail}</p>}</div><p className="text-lg font-semibold tabular-nums">{value.toFixed(1)}{suffix}</p></div>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${title} usage history`} className="mt-3 h-16 w-full text-muted">
      <path d="M 0 36 H 100 M 0 21 H 100 M 0 6 H 100" stroke="currentColor" strokeOpacity=".12" strokeWidth=".5" fill="none" />
      <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}
