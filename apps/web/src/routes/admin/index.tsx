/// Admin (PRD 10.4, loopback-only server-side): libraries + scans, the
/// matching review queue, settings (including the light/dark appearance
/// toggle) and the live log tail. Everything here is reachable only when the
/// browser is the host machine; the server enforces this and reports
/// `adminAvailable: false` otherwise.
import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ScanLine, Moon, Sun, CheckCircle2 } from "lucide-react";
import { api, type ReviewEntry } from "../../client";
import { queries } from "../../queries";
import { Button, cx } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Dialog } from "../../components/ui/dialog";
import { getTheme, setTheme, type Theme } from "../../theme";

const ERROR_TEXT = "text-red-500";

function AdminRoute() {
  const [tab, setTab] = useState<"libraries" | "review" | "settings" | "logs">("libraries");
  const status = useQuery(queries.serverStatus());

  const tabs = [
    ["libraries", "Libraries"],
    ["review", "Fix matches"],
    ["settings", "Settings"],
    ["logs", "Logs"],
  ] as const;

  return (
    <main className="mx-auto min-h-dvh max-w-[1000px] px-4 pb-24 pt-8 sm:px-8">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">Server</h1>
        <span className="text-xs text-ink-muted">v{status.data?.version ?? "…"}</span>
      </header>

      <nav className="mt-6 flex gap-1 border-b border-line" aria-label="Admin sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
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

export const Route = createFileRoute("/admin/")({
  component: AdminRoute,
});

// --- libraries ---------------------------------------------------------------

function Libraries() {
  const { data, isLoading, isError } = useQuery(queries.libraries());
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLibrary(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["libraries"] }),
  });

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
            <IconButton label={`Rescan ${lib.name}`} onClick={() => void api.scanLibrary(lib.id)}>
              <ScanLine size={15} />
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

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

// --- review queue ------------------------------------------------------------

function Review() {
  const { data, isLoading } = useQuery(queries.review());
  const [open, setOpen] = useState<ReviewEntry | null>(null);

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-ink-muted">Nothing needs attention. Every title is matched or clearly unmatched.</p>
      )}
      {data?.filter((i) => i.kind === "movie" || i.kind === "series").map((entry) => (
        <div key={entry.id} className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate">
              <span className="font-display font-semibold">{entry.name}</span>
              {entry.parentTitle && entry.parentTitle !== entry.name && (
                <span className="text-ink-muted"> ({entry.parentTitle})</span>
              )}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">{entry.reason ?? `${entry.matchStatus} match`}</p>
          </div>
          <Button variant="surface" onClick={() => setOpen(entry)}>Review</Button>
        </div>
      ))}

      <Dialog.Root open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>Match {open?.name}</Dialog.Title>
            <p className="text-sm text-ink-muted">
              Pick the correct title, or search for a better one. Manual matches are locked and rescans never overwrite them.
            </p>
            {open && <FixMatch entry={open} onDone={() => setOpen(null)} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function FixMatch({ entry, onDone }: { entry: ReviewEntry; onDone: () => void }) {
  const queryClient = useQueryClient();
  const type: "movie" | "tv" = entry.kind === "movie" ? "movie" : "tv";
  const [query, setQuery] = useState(entry.name);
  const [year, setYear] = useState<string>("");
  const search = useMutation({
    mutationFn: () => api.matchSearch(type, query, year ? Number(year) : undefined),
  });
  const apply = useMutation({
    mutationFn: (p: { tmdbId: number }) => api.applyMatch(entry.id, p.tmdbId, type),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["review"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
      onDone();
    },
  });

  return (
    <div className="mt-4 space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); search.mutate(); }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
        <Button variant="surface" disabled={search.isPending}>Search</Button>
      </form>

      {search.data && (
        <div className="space-y-1">
          {search.data.results.map((r) => (
            <button
              key={r.tmdbId}
              onClick={() => apply.mutate({ tmdbId: r.tmdbId })}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-hover"
            >
              {r.poster && <img src={r.poster} alt="" className="h-14 w-10 rounded object-cover" loading="lazy" />}
              <span className="min-w-0">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block text-[13px] text-ink-muted">{r.year} · {r.overview?.slice(0, 80) ?? ""}</span>
              </span>
            </button>
          ))}
          {search.data.results.length === 0 && (
            <p className="text-sm text-ink-muted">TMDB has nothing for that search.</p>
          )}
        </div>
      )}

      {!search.data && entry.candidates.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-ink-muted">Auto candidates</p>
          <div className="mt-2 space-y-1">
            {entry.candidates.map((c) => (
              <button
                key={c.tmdbId}
                onClick={() => apply.mutate({ tmdbId: c.tmdbId })}
                className="flex w-full items-center justify-between gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-hover"
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

function Logs() {
  const [filter, setFilter] = useState("");
  const debounced = useDebounce(filter, 300);
  const { data } = useQuery(queries.logs(debounced || undefined));

  return (
    <div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter lines…"
        aria-label="Filter log lines"
        className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand/70"
      />
      <pre className="mt-3 max-h-[480px] overflow-auto rounded-xl border border-line bg-surface p-3 text-[12px] leading-relaxed text-ink-muted">
        {data?.length ? data.join("\n") : "No log lines yet."}
      </pre>
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
