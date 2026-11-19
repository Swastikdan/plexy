/// Shared media-library wizard used by first-run setup, the add-library page,
/// and the library editor.
///
/// The flow is deliberately two steps. People choose what they are adding
/// before they are asked where it lives, so the folder browser is never shown
/// next to a pre-filled "Movies" library that they did not ask for.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryItem } from "../client";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Clapperboard,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Plus,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import { api } from "../client";
import { queries } from "../queries";
import { Button, Input } from "@heroui/react";
import { cx } from "../lib/cx";

type MediaType = "movies" | "tv" | "anime";

const MEDIA_TYPES: Array<{
  value: MediaType;
  title: string;
  description: string;
  detail: string;
  icon: typeof Film;
}> = [
  {
    value: "movies",
    title: "Movies",
    description: "Feature films, documentaries, and concert films.",
    detail: "Poster wall and single-file playback",
    icon: Film,
  },
  {
    value: "tv",
    title: "TV shows",
    description: "Series with seasons and episodes.",
    detail: "Season grouping and next-episode tracking",
    icon: Tv,
  },
];

const DEFAULT_NAMES: Record<MediaType, string> = {
  movies: "Movies",
  tv: "TV Shows",
  anime: "Anime",
};

const TYPE_LABEL: Record<MediaType, string> = {
  movies: "Movies",
  tv: "TV shows",
  anime: "Anime",
};

const SHORTCUTS = [
  { label: "Home", path: "~", icon: Home },
  { label: "Movies", path: "~/Movies", icon: Film },
  { label: "TV", path: "~/TV", icon: Tv },
  { label: "Downloads", path: "~/Downloads", icon: HardDrive },
  { label: "Desktop", path: "~/Desktop", icon: FolderOpen },
  { label: "Volumes", path: "/Volumes", icon: HardDrive },
];

function isMediaType(value: string | null | undefined): value is MediaType {
  return value === "movies" || value === "tv" || value === "anime";
}

/** Split an absolute or home-relative path into clickable browser crumbs. */
function pathCrumbs(raw: string): Array<{ label: string; path: string }> {
  if (!raw) return [];
  if (raw === "~") return [{ label: "Home", path: "~" }];
  if (raw.startsWith("~/")) {
    const parts = raw.slice(2).split("/").filter(Boolean);
    const crumbs = [{ label: "Home", path: "~" }];
    let cursor = "~";
    for (const part of parts) {
      cursor += `/${part}`;
      crumbs.push({ label: part, path: cursor });
    }
    return crumbs;
  }
  const parts = raw.split("/").filter(Boolean);
  const crumbs = [{ label: "Computer", path: "/" }];
  let cursor = "";
  for (const part of parts) {
    cursor += `/${part}`;
    crumbs.push({ label: part, path: cursor });
  }
  return crumbs;
}

export function LibraryFolderForm({
  onComplete,
  completeLabel = "Create library & scan",
  initialLibrary,
}: {
  onComplete: () => void;
  completeLabel?: string;
  initialLibrary?: LibraryItem;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(initialLibrary);
  const startingType = isMediaType(initialLibrary?.type) ? initialLibrary.type : null;

  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1);
  const [type, setType] = useState<MediaType | null>(startingType);
  const [name, setName] = useState(initialLibrary?.name ?? "");
  const [path, setPath] = useState<string>(initialLibrary?.paths[0] ?? "~");
  const [customInputPath, setCustomInputPath] = useState("");
  const [picked, setPicked] = useState<string[]>(initialLibrary?.paths ?? []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const browse = useQuery({
    queryKey: ["local-folders", path],
    queryFn: () => api.localFolders(path || undefined),
    enabled: step === 2,
  });

  const submit = useMutation({
    mutationFn: (): Promise<{ id: number } | { ok: true }> => {
      if (!type) throw new Error("Choose a media type first.");
      return initialLibrary
        ? api.updateLibrary(initialLibrary.id, { name: name.trim(), type, paths: picked })
        : api.createLibrary(name.trim(), type, picked);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["libraries"] });
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
      onComplete();
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  const crumbs = useMemo(() => pathCrumbs(browse.data?.path ?? path), [browse.data?.path, path]);

  const chooseType = (next: MediaType) => {
    setErrorMsg(null);
    // Keep a custom library name, but replace the generated default when the
    // person goes back and switches media type.
    const wasDefault = !name.trim() || Object.values(DEFAULT_NAMES).includes(name.trim());
    setType(next);
    if (wasDefault) setName(DEFAULT_NAMES[next]);
    setStep(2);
  };

  const addFolder = (folderPath: string) => {
    const clean = folderPath.trim();
    if (!clean) return;
    setErrorMsg(null);
    if (!picked.includes(clean)) setPicked((prev) => [...prev, clean]);
  };

  const removeFolder = (folderPath: string) => {
    setPicked((prev) => prev.filter((p) => p !== folderPath));
  };

  const openFolder = (folderPath: string) => {
    setPath(folderPath);
    setCustomInputPath(folderPath);
  };

  const canSubmit = Boolean(type) && Boolean(name.trim()) && picked.length > 0 && !submit.isPending;

  return (
    <section className="overflow-hidden rounded-[calc(var(--radius)*2)] border border-border bg-surface">
      <StepRail step={step} editing={editing} onStep={(next) => setStep(next)} />

      {step === 1 ? (
        <div className="p-5 sm:p-7">
          <header className="max-w-2xl">
            <h2 className="font-sans text-xl font-bold tracking-[-0.03em] text-foreground">
              What are you adding?
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Pick a media type first. The next step only asks for the folders
              that belong to it.
            </p>
          </header>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {MEDIA_TYPES.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => chooseType(option.value)}
                  className={cx(
                    "group flex h-full flex-col items-start gap-4 rounded-2xl border p-5 text-left transition-[border-color,background-color,transform] duration-150 ease-out",
                    "active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2",
                    type === option.value
                      ? "border-foreground/25 bg-surface-secondary"
                      : "border-border bg-surface hover:border-foreground/20 hover:bg-surface-secondary/60",
                  )}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-background text-foreground">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-sans text-base font-bold text-foreground">
                      {option.title}
                      <ChevronRight
                        size={15}
                        className="text-muted transition-transform duration-150 group-hover:translate-x-0.5"
                      />
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">
                      {option.description}
                    </span>
                    <span className="mt-2.5 block text-[11px] font-medium text-muted/80">
                      {option.detail}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-5 text-xs leading-relaxed text-muted">
            Music is not supported yet. You can add more libraries at any time
            from this dashboard.
          </p>
        </div>
      ) : (
        <div className="p-5 sm:p-7">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg text-[11px] font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
              >
                <ArrowLeft size={13} />
                Change media type
              </button>
              <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.03em] text-foreground">
                {type ? `Choose folders for ${TYPE_LABEL[type]}` : "Choose media folders"}
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                Plexy scans the folders you add. Subfolders are included, so
                point it at the top of a collection, not at one title.
              </p>
            </div>
          </header>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(17rem,0.8fr)]">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {SHORTCUTS.map((shortcut) => {
                  const Icon = shortcut.icon;
                  return (
                    <button
                      key={shortcut.label}
                      type="button"
                      onClick={() => openFolder(shortcut.path)}
                      className={cx(
                        "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-[background-color,border-color,color] duration-150",
                        path === shortcut.path
                          ? "border-foreground/20 bg-surface-tertiary text-foreground"
                          : "border-border bg-surface text-muted hover:border-foreground/20 hover:bg-surface-secondary hover:text-foreground",
                      )}
                    >
                      <Icon size={12} />
                      <span className="truncate">{shortcut.label}</span>
                    </button>
                  );
                })}
              </div>

              {typeof window !== "undefined" && window.electronAPI?.selectFolder && (
                <button
                  type="button"
                  onClick={async () => {
                    const selected = await window.electronAPI?.selectFolder();
                    if (selected) addFolder(selected);
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface-secondary/60 px-4 py-3 text-left transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                      <FolderOpen size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-foreground">
                        Choose a folder on this computer
                      </span>
                      <span className="mt-0.5 block text-[10.5px] text-muted">
                        Picks one folder and adds it straight to this library.
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-muted">Browse</span>
                </button>
              )}

              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="space-y-2 border-b border-border p-2.5">
                  <div className="flex items-center gap-2">
                    {browse.data?.parent && (
                      <button
                        type="button"
                        onClick={() => openFolder(browse.data!.parent!)}
                        aria-label="Go to parent folder"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
                      >
                        <ArrowUp size={15} />
                      </button>
                    )}
                    <div className="scroll-row flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-border/70 bg-surface-secondary/40 px-1.5 py-1">
                      {crumbs.map((crumb, index) => (
                        <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
                          {index > 0 && <span className="px-0.5 text-muted/50">/</span>}
                          <button
                            type="button"
                            onClick={() => openFolder(crumb.path)}
                            className={cx(
                              "max-w-[11rem] truncate rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors hover:bg-surface hover:text-foreground",
                              index === crumbs.length - 1 ? "text-foreground" : "text-muted",
                            )}
                          >
                            {crumb.label}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-0.5">
                    <p className="min-w-0 truncate text-[10.5px] text-muted">
                      {browse.data ? `${browse.data.entries.length} folder${browse.data.entries.length === 1 ? "" : "s"} here` : "Loading folders…"}
                    </p>
                    <button
                      type="button"
                      onClick={() => addFolder(browse.data?.path ?? path)}
                      disabled={!browse.data}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[11px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <FolderPlus size={12} />
                      Add this folder
                    </button>
                  </div>
                </div>

                <div className="max-h-[min(48vh,380px)] min-h-[15rem] overflow-y-auto p-1.5">
                  {browse.isLoading && (
                    <div className="space-y-1 p-1">
                      {[0, 1, 2, 3, 4].map((index) => (
                        <div key={index} className="h-11 animate-pulse rounded-lg bg-surface-secondary/70" />
                      ))}
                    </div>
                  )}
                  {browse.isError && (
                    <div className="flex items-start gap-2 px-3 py-6 text-[11px] text-danger-soft-foreground">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      <span>Cannot read this folder: {browse.error.message}</span>
                    </div>
                  )}
                  {!browse.isLoading && !browse.isError && browse.data?.entries.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                      <Folder className="text-muted" size={22} />
                      <p className="text-[12px] font-medium text-foreground">No subfolders here</p>
                      <p className="max-w-xs text-[11px] leading-relaxed text-muted">
                        Add this folder if the media files sit directly inside it.
                      </p>
                    </div>
                  )}
                  {browse.data?.entries.map((folder) => {
                    const added = picked.includes(folder.path);
                    return (
                      <div
                        key={folder.path}
                        className="group flex min-h-11 items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-surface-secondary/70"
                      >
                        <button
                          type="button"
                          onClick={() => openFolder(folder.path)}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-[-2px]"
                        >
                          <Folder size={15} className="shrink-0 text-muted transition-colors group-hover:text-foreground" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                            {folder.name}
                          </span>
                          {folder.hasVideos && (
                            <span className="shrink-0 rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[9.5px] font-semibold text-muted">
                              media
                            </span>
                          )}
                          <ChevronRight size={13} className="shrink-0 text-muted/40" />
                        </button>
                        <button
                          type="button"
                          onClick={() => (added ? removeFolder(folder.path) : addFolder(folder.path))}
                          aria-label={added ? `Remove ${folder.name}` : `Add ${folder.name}`}
                          className={cx(
                            "mr-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[10.5px] font-semibold transition-colors",
                            added
                              ? "bg-success/10 text-success-soft-foreground hover:bg-danger/10 hover:text-danger-soft-foreground"
                              : "text-muted hover:bg-surface-tertiary hover:text-foreground",
                          )}
                        >
                          {added ? <Check size={12} /> : <Plus size={12} />}
                          {added ? "Added" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <details className="group rounded-xl border border-border/70 bg-surface-secondary/30 px-3.5 py-2.5">
                <summary className="flex min-h-8 cursor-pointer list-none items-center text-[11px] font-medium text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                  Enter a folder path instead
                </summary>
                <div className="flex flex-col gap-2 pt-3 sm:flex-row">
                  <Input
                    type="text"
                    value={customInputPath}
                    onChange={(event) => setCustomInputPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (customInputPath.trim()) addFolder(customInputPath);
                      }
                    }}
                    placeholder="/Users/you/Movies"
                    aria-label="Folder path"
                    fullWidth
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    onPress={() => {
                      if (!customInputPath.trim()) return;
                      openFolder(customInputPath.trim());
                    }}
                    isDisabled={!customInputPath.trim()}
                    className="h-10 shrink-0 px-3 text-[11px]"
                  >
                    Open
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onPress={() => {
                      if (customInputPath.trim()) addFolder(customInputPath);
                    }}
                    isDisabled={!customInputPath.trim()}
                    className="h-10 shrink-0 px-3 text-[11px]"
                  >
                    Add
                  </Button>
                </div>
              </details>
            </div>

            <aside className="min-w-0 space-y-3">
              <div className="rounded-xl border border-border bg-surface-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11.5px] font-semibold text-foreground">Library name</h3>
                  <span className="text-[10.5px] text-muted">Shown in navigation</span>
                </div>
                <Input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={type ? DEFAULT_NAMES[type] : "Movies"}
                  aria-label="Library name"
                  fullWidth
                  className="mt-2.5"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11.5px] font-semibold text-foreground">
                    Folders in this library
                  </h3>
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-muted">
                    {picked.length}
                  </span>
                </div>

                {picked.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-border/80 px-4 py-6 text-center">
                    <FolderPlus className="mx-auto text-muted" size={20} />
                    <p className="mt-2 text-[11.5px] font-medium text-foreground">No folders yet</p>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                      Browse above and add one or more media folders.
                    </p>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {picked.map((folder) => (
                      <li
                        key={folder}
                        className="flex min-h-10 items-center gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-1.5"
                      >
                        <Folder size={14} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground" title={folder}>
                          {folder}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFolder(folder)}
                          aria-label={`Remove ${folder}`}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger-soft-foreground focus-visible:outline-2 focus-visible:outline-danger-soft-foreground focus-visible:outline-offset-2"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {errorMsg && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 p-3 text-[11px] leading-relaxed text-danger-soft-foreground">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-[11px] leading-relaxed text-muted">
                  {picked.length === 0
                    ? "Add at least one folder to continue."
                    : `${picked.length} folder${picked.length === 1 ? "" : "s"} ready to scan.`}
                </p>
                <Button
                  variant="primary"
                  isDisabled={!canSubmit}
                  onPress={() => submit.mutate()}
                  className="mt-3 h-10 w-full px-5 text-[12px] font-semibold"
                >
                  {submit.isPending
                    ? editing
                      ? "Saving…"
                      : "Creating and scanning…"
                    : completeLabel}
                </Button>
                {!editing && (
                  <p className="mt-2 text-center text-[10.5px] leading-relaxed text-muted">
                    Plexy scans in the background. You can close this page.
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}

/** Two-step progress rail. Both steps stay reachable after a type is chosen. */
function StepRail({
  step,
  editing,
  onStep,
}: {
  step: 1 | 2;
  editing: boolean;
  onStep: (step: 1 | 2) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-secondary/30 px-4 py-3 sm:px-7">
      <button
        type="button"
        onClick={() => onStep(1)}
        className={cx(
          "inline-flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-semibold transition-colors",
          step === 1 ? "text-foreground" : "text-muted hover:text-foreground",
        )}
      >
        <span
          className={cx(
            "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] tabular-nums",
            step === 1
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface text-muted",
          )}
        >
          1
        </span>
        Media type
      </button>
      <span className="h-px w-6 bg-border" aria-hidden />
      <button
        type="button"
        onClick={() => onStep(2)}
        disabled={!editing && step === 1}
        className={cx(
          "inline-flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-semibold transition-colors",
          step === 2 ? "text-foreground" : "text-muted hover:text-foreground",
          !editing && step === 1 && "opacity-60",
        )}
      >
        <span
          className={cx(
            "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] tabular-nums",
            step === 2
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface text-muted",
          )}
        >
          2
        </span>
        Folders
      </button>
      <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted sm:flex">
        <Clapperboard size={12} />
        {editing ? "Editing an existing library" : "New library"}
      </span>
    </div>
  );
}
