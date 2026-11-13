/// Shared folder picker and library creation form for onboarding and library management.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryItem } from "../client";
import {
  AlertCircle,
  ArrowUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
  Music,
} from "lucide-react";
import { api } from "../client";
import { queries } from "../queries";
import { Button, Input, ListBox, Select } from "@heroui/react";
import { cx } from "../lib/cx";

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
  const [name, setName] = useState(initialLibrary?.name ?? "Movies");
  const [type, setType] = useState<"movies" | "tv" | "anime">((initialLibrary?.type as "movies" | "tv" | "anime") ?? "movies");
  const [path, setPath] = useState<string>(initialLibrary?.paths[0] ?? "~");
  const [customInputPath, setCustomInputPath] = useState("");
  const [picked, setPicked] = useState<string[]>(initialLibrary?.paths ?? []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const browse = useQuery({
    queryKey: ["local-folders", path],
    queryFn: () => api.localFolders(path || undefined),
  });

  const submit = useMutation({
    mutationFn: (): Promise<{ id: number } | { ok: true }> => initialLibrary
      ? api.updateLibrary(initialLibrary.id, { name: name.trim(), type, paths: picked })
      : api.createLibrary(name.trim(), type, picked),
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

  const handleTypeSelect = (t: "movies" | "tv" | "anime") => {
    setType(t);
    if (!name || name === "Movies" || name === "TV Shows" || name === "Anime") {
      setName(t === "movies" ? "Movies" : t === "anime" ? "Anime" : "TV Shows");
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
    <section className="border border-border bg-surface p-6">
      <div>
        <h2 className="font-sans text-lg font-bold text-foreground">{initialLibrary ? "Library details" : "Choose media folders"}</h2>
        <p className="mt-1 text-xs text-muted">Choose a library type, give it a name, and select one or more folders to scan.</p>
      </div>

      {/* Library Type & Name */}
      <div className="mt-4 space-y-3">
        <label className="block max-w-sm space-y-1.5">
          <span className="text-xs font-medium text-muted">Library type</span>
          <Select
            aria-label="Library type"
            selectedKey={type}
            onSelectionChange={(key) => {
              const value = String(key);
              if (value === "movies" || value === "tv" || value === "anime") handleTypeSelect(value);
            }}
            className="w-full"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {[
                  { value: "movies", label: "Movies" },
                  { value: "tv", label: "TV shows" },
                  { value: "anime", label: "Anime" },
                  { value: "music", label: "Music (coming soon)", disabled: true },
                ].map((option) => (
                  <ListBox.Item
                    key={option.value}
                    id={option.value}
                    textValue={option.label}
                    isDisabled={option.disabled}
                  >
                    {option.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <span className="flex items-center gap-1.5 text-[11px] text-muted"><Music size={12} /> Music library scanning isn’t available yet.</span>
        </label>

        <div>
          <label className="text-xs font-medium text-muted">Library Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Movies, TV Shows, 4K Cinema"
            fullWidth
            className="mt-1"
          />
        </div>
      </div>

      {/* Folder Picker & Browser */}
      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted">
            Choose Media Location
          </label>
          <span className="text-xs text-muted">
            {picked.length} folder{picked.length === 1 ? "" : "s"} added
          </span>
        </div>

        {/* Quick Location Shortcuts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted mr-1">Quick jump:</span>
          {shortcuts.map((sc) => (
            <button
              key={sc.label}
              type="button"
              onClick={() => {
                setPath(sc.path);
                setCustomInputPath(sc.path);
              }}
              className="border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:border-separator hover:bg-surface-tertiary hover:text-foreground transition-colors"
            >
              {sc.label}
            </button>
          ))}
        </div>

        {/* Native Finder Picker (Electron macOS) */}
        {typeof window !== "undefined" && window.electronAPI?.selectFolder && (
          <div className="flex items-center justify-between border border-border bg-surface-secondary p-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
              <div>
                <p className="text-xs font-semibold text-foreground">Choose folder in Finder</p>
                <p className="text-[11px] text-muted">Select a media directory natively</p>
              </div>
            </div>
            <Button
              variant="secondary"
              type="button"
              onPress={async () => {
                const selected = await window.electronAPI?.selectFolder();
                if (selected) {
                  addFolder(selected);
                }
              }}
              className="h-8 shrink-0 px-3 text-xs font-medium"
            >
              Browse in Finder…
            </Button>
          </div>
        )}

        {/* Direct Path Input */}
        <div className="flex gap-2">
          <Input
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
            fullWidth
            className="flex-1"
          />
          <Button
            variant="secondary"
            type="button"
            onPress={() => {
              if (customInputPath.trim()) {
                addFolder(customInputPath);
              }
            }}
            isDisabled={!customInputPath.trim()}
            className="h-10 shrink-0 px-3 text-xs"
          >
            + Add Path
          </Button>
          <Button
            variant="ghost"
            type="button"
            onPress={() => {
              if (customInputPath.trim()) setPath(customInputPath.trim());
            }}
            isDisabled={!customInputPath.trim()}
            className="h-10 shrink-0 px-3 text-xs"
          >
            Browse
          </Button>
        </div>

        {/* Directory Explorer Card */}
        <div className="border border-border bg-surface-secondary/50 p-3">
          {/* Active directory navigation header */}
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 truncate text-foreground">
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate font-mono text-[11px]">
                {browse.data?.path || path}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {browse.data?.parent && (
                <button
                  type="button"
                  onClick={() => setPath(browse.data!.parent!)}
                  className="flex items-center gap-1 bg-surface-tertiary px-2 py-1 text-[11px] text-muted hover:text-foreground transition-colors"
                >
                  <ArrowUp className="h-3 w-3" />
                  Up
                </button>
              )}
              <button
                type="button"
                onClick={() => addFolder(browse.data?.path || path)}
                className="flex items-center gap-1 border border-border bg-surface-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-surface-tertiary"
              >
                <FolderPlus className="h-3 w-3" />
                Add this folder
              </button>
            </div>
          </div>

          {/* Subfolders list */}
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
            {browse.isLoading && (
              <p className="py-6 text-center text-xs text-muted">Reading directory…</p>
            )}
            {browse.isError && (
              <p className="py-4 text-center text-xs text-danger-soft-foreground">
                Cannot access directory: {browse.error.message}
              </p>
            )}
            {browse.data?.entries && browse.data.entries.length === 0 && (
              <p className="py-6 text-center text-xs text-muted">No subfolders found</p>
            )}
            {browse.data?.entries.map((f) => {
              const isAdded = picked.includes(f.path);
              return (
                <div
                  key={f.path}
                  className="group flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-surface-tertiary transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPath(f.path);
                      setCustomInputPath(f.path);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-foreground" />
                    <span className="truncate text-muted group-hover:text-foreground">
                      {f.name}
                    </span>
                    {f.hasVideos && (
                      <span className="shrink-0 bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        media
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => (isAdded ? removeFolder(f.path) : addFolder(f.path))}
                    className={cx(
                      "ml-2 shrink-0 px-2 py-0.5 text-[11px] font-medium transition-colors",
                      isAdded
                        ? "text-muted hover:text-danger-soft-foreground"
                        : "text-foreground hover:bg-surface-tertiary",
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
          <div className="space-y-1.5 border border-border bg-surface-secondary/50 p-3">
            <span className="text-[11px] font-medium text-muted">
              Folders to scan in this library:
            </span>
            {picked.map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  <Folder className="h-4 w-4 shrink-0 text-muted" />
                  <span className="truncate font-mono text-[11px] text-foreground">{folder}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFolder(folder)}
                  className="p-1 text-muted hover:text-danger-soft-foreground transition-colors"
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
        <div className="mt-4 border border-danger/20 bg-danger/8 p-3 text-xs text-danger-soft-foreground">
          {errorMsg}
        </div>
      )}

      {/* Submit / Finish button */}
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-4">
        <span className="text-xs text-muted">
          {picked.length === 0 ? "Select at least 1 folder" : `${picked.length} folder selected`}
        </span>
        <Button
          isDisabled={!name.trim() || picked.length === 0 || submit.isPending}
          onPress={() => submit.mutate()}
          className="h-10 px-6 text-sm font-semibold"
        >
          {submit.isPending ? (initialLibrary ? "Saving…" : "Creating & scanning…") : completeLabel}
        </Button>
      </div>
    </section>
  );
}
