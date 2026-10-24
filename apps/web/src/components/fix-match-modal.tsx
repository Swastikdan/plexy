/// Fix Match Modal — manual TMDB search and locked match assignment (PRD 5.4, 5.5, 10.3).
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "./ui/dialog";
import { Button, cx } from "./ui/button";import { api } from "../client";
import { Search, Check, X, Film, Tv, AlertCircle } from "lucide-react";

export function cleanSearchTitle(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\b(1080p|720p|2160p|4k|uhd|bluray|blu-ray|web-dl|webrip|hdr|dvdrip|x264|x265|hevc|h264|aac|ac3|dts|remux)\b.*$/i, "")
    .replace(/\(\d{4}\)/g, "")
    .trim();
}

export function extractYear(raw: string, defaultYear?: number | null): string {
  if (defaultYear) return String(defaultYear);
  const m = raw.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1]! : "";
}

export function FixMatchModal({
  open,
  onOpenChange,
  itemId,
  initialTitle,
  initialYear,
  kind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: number;
  initialTitle: string;
  initialYear?: number | null;
  kind?: string;
}) {
  const queryClient = useQueryClient();
  const isSeries = kind === "series";
  const isEpisode = kind === "episode";
  const [type, setType] = useState<"movie" | "tv">(isSeries ? "tv" : "movie");
  const [query, setQuery] = useState(() => cleanSearchTitle(initialTitle));
  const [year, setYear] = useState(() => extractYear(initialTitle, initialYear));
  const [results, setResults] = useState<
    Array<{
      tmdbId: number;
      type: string;
      title: string;
      year: number | null;
      overview: string | null;
      poster: string | null;
    }>
  >([]);

  // Update query state when modal opens or initialTitle changes
  useEffect(() => {
    if (open) {
      const cleaned = cleanSearchTitle(initialTitle);
      const extractedYear = extractYear(initialTitle, initialYear);
      setQuery(cleaned);
      setYear(extractedYear);
      setType(isSeries ? "tv" : "movie");

      if (cleaned.trim() && !isEpisode) {
        void api.matchSearch(isSeries ? "tv" : "movie", cleaned.trim(), extractedYear ? Number(extractedYear) : undefined)
          .then((res) => setResults(res.results))
          .catch(() => {});
      }
    }
  }, [open, initialTitle, initialYear, isSeries, isEpisode]);

  const searchMutation = useMutation({
    mutationFn: () => api.matchSearch(type, query.trim(), year ? Number(year) : undefined),
    onSuccess: (data) => {
      setResults(data.results);
    },
  });

  const applyMutation = useMutation({
    mutationFn: (tmdbId: number) => api.applyMatch(itemId, tmdbId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title", itemId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[min(94vw,680px)] max-h-[85vh] p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-lg font-semibold text-ink">
              Fix Match
            </Dialog.Title>
            <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-none text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink">
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-4">
            {isEpisode ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <p className="text-sm">
                  Individual episodes cannot be matched directly. Open and match the parent series to associate all seasons and episodes.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <div className="flex shrink-0 rounded-lg border border-line bg-surface p-1">
                    {!isSeries && (
                      <button
                        type="button"
                        onClick={() => setType("movie")}
                        aria-pressed={type === "movie"}
                        className={cx(
                          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          type === "movie"
                            ? "bg-surface-hover text-ink"
                            : "text-ink-muted hover:text-ink",
                        )}
                      >
                        <Film size={14} /> Movie
                      </button>
                    )}
                    {(isSeries || !kind) && (
                      <button
                        type="button"
                        onClick={() => setType("tv")}
                        aria-pressed={type === "tv"}
                        className={cx(
                          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          type === "tv"
                            ? "bg-surface-hover text-ink"
                            : "text-ink-muted hover:text-ink",
                        )}
                      >
                        <Tv size={14} /> TV Show
                      </button>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      placeholder="Search TMDB title…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                      className="h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-muted/70 outline-none transition-[border-color] focus:border-brand/70"
                    />
                  </div>

                  <input
                    type="text"
                    placeholder="Year"
                    aria-label="Year"
                    inputMode="numeric"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                    className="h-10 w-20 rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-muted/70 outline-none transition-[border-color] focus:border-brand/70"
                  />

                  <Button
                    variant="brand"
                    onClick={() => searchMutation.mutate()}
                    disabled={searchMutation.isPending || !query.trim()}
                    className="h-10 px-4"
                  >
                    <Search size={16} />
                    {searchMutation.isPending ? "Searching…" : "Search"}
                  </Button>
                </div>

                {searchMutation.isError && (
                  <p className="text-sm text-red-500">
                    TMDB search failed. Verify the server has a TMDB token configured.
                  </p>
                )}

                <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                  {results.map((c) => (
                    <div
                      key={c.tmdbId}
                      className="flex items-center gap-4 rounded-xl border border-line/60 bg-surface p-3 transition-colors hover:border-line"
                    >
                      <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-surface-2">
                        {c.poster ? (
                          <img src={c.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-muted">
                            No Art
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="truncate text-sm font-semibold text-ink">{c.title}</p>
                          {c.year && <span className="text-xs text-ink-muted">{c.year}</span>}
                        </div>
                        {c.overview && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{c.overview}</p>
                        )}
                      </div>

                      <Button
                        variant="primary"
                        onClick={() => applyMutation.mutate(c.tmdbId)}
                        disabled={applyMutation.isPending}
                        className="h-8 shrink-0 px-3 text-xs"
                      >
                        <Check size={14} />
                        Match
                      </Button>
                    </div>
                  ))}

                  {results.length === 0 && !searchMutation.isPending && (
                    <p className="py-8 text-center text-sm text-ink-muted">
                      Search TMDB to find matching titles.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
