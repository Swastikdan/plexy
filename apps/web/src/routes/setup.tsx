/// First-run setup (PRD 10.1): token test → folder browse → library create,
/// then straight home while the scan runs.
import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertCircle,
  Folder,
  FolderPlus,
  HardDrive,
  Trash2,
  ChevronRight,
  ArrowUp,
  Sparkles,
  Film,
  Tv,
} from "lucide-react";
import { api } from "../client";
import { queries } from "../queries";
import { Button } from "../components/ui/button";
import { cx } from "../components/poster";

function SetupRoute() {
  const status = useQuery(queries.serverStatus());

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-16 sm:px-8">
      <div className="staggered space-y-10">
        <header className="space-y-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white">
              Set up your server
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Configure your TMDB metadata source and point Plexy to your local film and TV
              directories to begin streaming.
            </p>
          </div>
          {status.data?.setupComplete && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
              <span>Your server setup is already complete and ready.</span>
              <Link to="/" className="font-semibold underline hover:text-white">
                Go to Home →
              </Link>
            </div>
          )}
        </header>

        <TokenStep />
        <FolderStep />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/setup")({ component: SetupRoute });

function TokenStep() {
  const queryClient = useQueryClient();
  const settings = useQuery(queries.settings());
  const tmdbTest = useQuery({
    queryKey: ["tmdb-test"],
    queryFn: () => api.testTmdb(),
    retry: 1,
    staleTime: 30_000,
  });

  const [tokenInput, setTokenInput] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const save = useMutation({
    mutationFn: async (rawToken: string) => {
      const clean = rawToken.trim();
      if (clean) await api.updateSettings({ tmdbToken: clean });
      return api.testTmdb();
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
      await queryClient.invalidateQueries({ queryKey: ["tmdb-test"] });
      if (r.ok) setShowManualInput(false);
    },
  });

  const isConnected = tmdbTest.data?.ok === true;
  const isEnvToken = settings.data?.settings.tokenSource === "env";
  const hasTokenConfigured = settings.data?.settings.hasTmdbToken || isEnvToken;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#1a1a1a]/80 p-6 shadow-xl backdrop-blur-sm">
      <StepHeading
        n={1}
        title="TMDB Metadata Connection"
        note="Fetches posters, synopses, release dates, and cast details."
      />

      {/* State 1: Successfully connected */}
      {isConnected && !showManualInput ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">Connected to TMDB</p>
                <p className="text-xs text-emerald-400/80">
                  {isEnvToken
                    ? "Active read-access token loaded from environment."
                    : "Active read-access token configured on server."}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowManualInput(true)}
              className="text-xs text-ink-muted underline hover:text-white"
            >
              Change token
            </button>
          </div>
        </div>
      ) : (
        /* State 2: Needs token input or testing */
        <div className="mt-4 space-y-3">
          {tmdbTest.data && !tmdbTest.data.ok && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{tmdbTest.data.message || "Failed to reach TMDB with current key."}</span>
            </div>
          )}

          <p className="text-xs text-ink-muted leading-relaxed">
            Enter your TMDB API v4 Read-Access Token. You can create one for free under{" "}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
              className="text-white underline hover:text-[#E50914]"
            >
              themoviedb.org Settings → API
            </a>
            .
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiJ9..."
              className="h-10 flex-1 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#E50914]"
            />
            <Button
              variant="brand"
              disabled={save.isPending || (!tokenInput.trim() && !hasTokenConfigured)}
              onClick={() => save.mutate(tokenInput)}
              className="h-10 shrink-0 px-5"
            >
              {save.isPending ? "Testing…" : "Verify & Save"}
            </Button>
          </div>

          {showManualInput && isConnected && (
            <button
              onClick={() => setShowManualInput(false)}
              className="text-xs text-ink-muted hover:text-white"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FolderStep() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Movies");
  const [type, setType] = useState<"movies" | "tv">("movies");
  const [path, setPath] = useState<string>("~");
  const [customInputPath, setCustomInputPath] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const browse = useQuery({
    queryKey: ["local-folders", path],
    queryFn: () => api.localFolders(path || undefined),
  });

  const submit = useMutation({
    mutationFn: () => api.createLibrary(name.trim(), type, picked),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["libraries"] });
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
      void navigate({ to: "/" });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  const handleTypeSelect = (t: "movies" | "tv") => {
    setType(t);
    if (!name || name === "Movies" || name === "TV Shows") {
      setName(t === "movies" ? "Movies" : "TV Shows");
    }
  };

  const addFolder = (folderPath: string) => {
    const clean = folderPath.trim();
    if (!clean) return;
    if (!picked.includes(clean)) {
      setPicked((prev) => [...prev, clean]);
    }
  };

  const removeFolder = (folderPath: string) => {
    setPicked((prev) => prev.filter((p) => p !== folderPath));
  };

  const shortcuts = [
    { label: "Movies", path: "~/Movies" },
    { label: "Downloads", path: "~/Downloads" },
    { label: "Desktop", path: "~/Desktop" },
    { label: "Home", path: "~" },
    { label: "Volumes", path: "/Volumes" },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-[#1a1a1a]/80 p-6 shadow-xl backdrop-blur-sm">
      <StepHeading
        n={2}
        title="Your Media Folders"
        note="Select the directory where your video files are stored."
      />

      {/* Library Type & Name */}
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleTypeSelect("movies")}
            className={cx(
              "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all",
              type === "movies"
                ? "border-[#E50914] bg-[#E50914]/15 text-white shadow-sm"
                : "border-white/10 bg-white/5 text-ink-muted hover:border-white/20 hover:text-white",
            )}
          >
            <Film className="h-4 w-4" />
            Films & Movies
          </button>
          <button
            type="button"
            onClick={() => handleTypeSelect("tv")}
            className={cx(
              "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all",
              type === "tv"
                ? "border-[#E50914] bg-[#E50914]/15 text-white shadow-sm"
                : "border-white/10 bg-white/5 text-ink-muted hover:border-white/20 hover:text-white",
            )}
          >
            <Tv className="h-4 w-4" />
            TV Shows
          </button>
        </div>

        <div>
          <label className="text-xs font-medium text-ink-muted">Library Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Movies, TV Shows, 4K Cinema"
            className="mt-1 h-10 w-full rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#E50914]"
          />
        </div>
      </div>

      {/* Folder Picker & Browser */}
      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Choose Media Location
          </label>
          <span className="text-xs text-ink-muted">
            {picked.length} folder{picked.length === 1 ? "" : "s"} added
          </span>
        </div>

        {/* Quick Location Shortcuts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-muted mr-1">Quick jump:</span>
          {shortcuts.map((sc) => (
            <button
              key={sc.label}
              type="button"
              onClick={() => {
                setPath(sc.path);
                setCustomInputPath(sc.path);
              }}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:border-white/25 hover:bg-white/10 hover:text-white transition-colors"
            >
              {sc.label}
            </button>
          ))}
        </div>

        {/* Direct Path Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customInputPath}
            onChange={(e) => setCustomInputPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInputPath.trim()) {
                e.preventDefault();
                addFolder(customInputPath);
              }
            }}
            placeholder="Enter or paste folder path (e.g. /Users/swastik/Movies)"
            className="h-10 flex-1 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-[#E50914]"
          />
          <Button
            variant="surface"
            type="button"
            onClick={() => {
              if (customInputPath.trim()) {
                addFolder(customInputPath);
              }
            }}
            disabled={!customInputPath.trim()}
            className="h-10 shrink-0 px-3 text-xs"
          >
            + Add Path
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              if (customInputPath.trim()) setPath(customInputPath.trim());
            }}
            disabled={!customInputPath.trim()}
            className="h-10 shrink-0 px-3 text-xs"
          >
            Browse
          </Button>
        </div>

        {/* Directory Explorer Card */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3">
          {/* Active directory navigation header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 truncate text-white/90">
              <Folder className="h-4 w-4 shrink-0 text-[#E50914]" />
              <span className="truncate font-mono text-[11px]">
                {browse.data?.path || path}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {browse.data?.parent && (
                <button
                  type="button"
                  onClick={() => setPath(browse.data!.parent!)}
                  className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-ink-muted hover:bg-white/10 hover:text-white transition-colors"
                >
                  <ArrowUp className="h-3 w-3" />
                  Up
                </button>
              )}
              <button
                type="button"
                onClick={() => addFolder(browse.data?.path || path)}
                className="flex items-center gap-1 rounded-md bg-[#E50914]/20 border border-[#E50914]/40 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#E50914] transition-colors"
              >
                <FolderPlus className="h-3 w-3" />
                Add this folder
              </button>
            </div>
          </div>

          {/* Subfolders list */}
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
            {browse.isLoading && (
              <p className="py-6 text-center text-xs text-ink-muted">Reading directory…</p>
            )}
            {browse.isError && (
              <p className="py-4 text-center text-xs text-red-400">
                Cannot access directory: {browse.error.message}
              </p>
            )}
            {browse.data?.entries && browse.data.entries.length === 0 && (
              <p className="py-6 text-center text-xs text-ink-muted">No subfolders found</p>
            )}
            {browse.data?.entries.map((f) => {
              const isAdded = picked.includes(f.path);
              return (
                <div
                  key={f.path}
                  className="group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/5 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPath(f.path);
                      setCustomInputPath(f.path);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-white/50 group-hover:text-white" />
                    <span className="truncate text-white/90 group-hover:text-white">
                      {f.name}
                    </span>
                    {f.hasVideos && (
                      <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                        media detected
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => (isAdded ? removeFolder(f.path) : addFolder(f.path))}
                    className={cx(
                      "ml-2 shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                      isAdded
                        ? "bg-white/10 text-white/60 hover:bg-red-500/20 hover:text-red-400"
                        : "bg-white/10 text-white hover:bg-[#E50914] hover:text-white",
                    )}
                  >
                    {isAdded ? "Added ✓" : "+ Add"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Folders List */}
        {picked.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/5 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Folders to scan in this library:
            </span>
            {picked.map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  <Folder className="h-4 w-4 shrink-0 text-[#E50914]" />
                  <span className="truncate font-mono text-[11px] text-white">{folder}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFolder(folder)}
                  className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-red-400 transition-colors"
                  title="Remove folder"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error state */}
      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Submit / Finish button */}
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
        <span className="text-xs text-ink-muted">
          {picked.length === 0 ? "Select at least 1 folder" : `${picked.length} folder selected`}
        </span>
        <Button
          variant="brand"
          disabled={!name.trim() || picked.length === 0 || submit.isPending}
          onClick={() => submit.mutate()}
          className="h-11 px-6 text-sm font-semibold"
        >
          {submit.isPending ? "Creating & Scanning…" : "Finish Setup & Start Scanning ▸"}
        </Button>
      </div>
    </section>
  );
}

function StepHeading({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div>
      <h2 className="flex items-baseline gap-2.5 font-display text-lg font-bold text-white">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80">
          {n}
        </span>
        {title}
      </h2>
      {note && <p className="mt-1 pl-8 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
