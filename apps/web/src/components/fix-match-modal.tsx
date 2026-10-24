/// Fix Match Modal — manual TMDB search and locked match assignment (PRD 5.4, 5.5, 10.3).
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { api } from "../client";
import { Search, Check, X, Film, Tv, AlertCircle } from "lucide-react";

function cleanSearchTitle(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\b(1080p|720p|2160p|4k|uhd|bluray|blu-ray|web-dl|webrip|hdr|dvdrip|x264|x265|hevc|h264|aac|ac3|dts|remux)\b.*$/i, "")
    .replace(/\(\d{4}\)/g, "")
    .trim();
}

function extractYear(raw: string, defaultYear?: number | null): string {
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
        <Dialog.Popup className="w-[min(94vw,680px)] max-h-[85vh] p-0 overflow-hidden bg-[#181818] border-white/15 text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <Dialog.Title className="text-lg font-semibold text-white">
              Fix Match
            </Dialog.Title>
            <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-white/10 hover:text-white transition-colors">
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-4">
            {isEpisode ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-200">
                <AlertCircle className="shrink-0 mt-0.5" size={18} />
                <p className="text-sm">
                  Individual episodes cannot be matched directly. Please open and match the parent TV series to automatically associate all seasons and episodes.
                </p>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="flex rounded-lg border border-white/10 bg-white/5 p-1 shrink-0">
                    {!isSeries && (
                      <button
                        type="button"
                        onClick={() => setType("movie")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          type === "movie" ? "bg-white/20 text-white" : "text-ink-muted hover:text-white"
                        }`}
                      >
                        <Film size={14} /> Movie
                      </button>
                    )}
                    {(isSeries || !kind) && (
                      <button
                        type="button"
                        onClick={() => setType("tv")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          type === "tv" ? "bg-white/20 text-white" : "text-ink-muted hover:text-white"
                        }`}
                      >
                        <Tv size={14} /> TV Show
                      </button>
                    )}
                  </div>

                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Search TMDB title…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                      className="w-full h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-ink-muted focus:border-white/40 focus:outline-none"
                    />
                  </div>

                  <input
                    type="text"
                    placeholder="Year"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                    className="w-20 h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-ink-muted focus:border-white/40 focus:outline-none"
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
                  <p className="text-sm text-red-400">
                    TMDB search failed. Verify server has TMDB token configured.
                  </p>
                )}

                <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                  {results.map((c) => (
                    <div
                      key={c.tmdbId}
                      className="flex items-center gap-4 p-3 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] transition-colors"
                    >
                      <div className="h-16 w-11 shrink-0 rounded bg-[#252525] overflow-hidden">
                        {c.poster ? (
                          <img src={c.poster} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-[10px] text-ink-muted">
                            No Art
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="font-semibold text-sm text-white truncate">{c.title}</p>
                          {c.year && <span className="text-xs text-ink-muted">{c.year}</span>}
                        </div>
                        {c.overview && (
                          <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{c.overview}</p>
                        )}
                      </div>

                      <Button
                        variant="primary"
                        onClick={() => applyMutation.mutate(c.tmdbId)}
                        disabled={applyMutation.isPending}
                        className="shrink-0 h-8 px-3 text-xs"
                      >
                        <Check size={14} />
                        Match
                      </Button>
                    </div>
                  ))}

                  {results.length === 0 && !searchMutation.isPending && (
                    <p className="text-center py-8 text-sm text-ink-muted">
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
