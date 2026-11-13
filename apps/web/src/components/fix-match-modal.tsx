/// Fix Match Modal — manual TMDB search and locked match assignment (PRD 5.4, 5.5, 10.3).
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Modal,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { api } from "../client";
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
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,680px)] max-w-none overflow-hidden p-0">
            <Modal.Header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <Modal.Heading className="text-lg font-semibold">Fix Match</Modal.Heading>
              <Modal.CloseTrigger className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground">
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>

            <Modal.Body className="space-y-4 p-5">
              {isEpisode ? (
                <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/10 p-4 text-warning-soft-foreground">
                  <AlertCircle className="mt-0.5 shrink-0" size={18} />
                  <p className="text-sm">
                    Individual episodes cannot be matched directly. Open and match the parent series to associate all seasons and episodes.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <ToggleButtonGroup
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={[type]}
                      onSelectionChange={(keys) => {
                        const next = [...keys][0];
                        if (next === "movie" || next === "tv") setType(next);
                      }}
                      className="shrink-0"
                    >
                      {!isSeries && (
                        <ToggleButton id="movie" className="text-xs">
                          <Film size={14} /> Movie
                        </ToggleButton>
                      )}
                      {(isSeries || !kind) && (
                        <ToggleButton id="tv" className="text-xs">
                          <Tv size={14} /> TV Show
                        </ToggleButton>
                      )}
                    </ToggleButtonGroup>

                    <TextField
                      aria-label="Search TMDB title"
                      value={query}
                      onChange={setQuery}
                      className="min-w-0 flex-1"
                    >
                      <Input
                        placeholder="Search TMDB title…"
                        onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                      />
                    </TextField>

                    <TextField
                      aria-label="Year"
                      value={year}
                      onChange={(next) => setYear(next.replace(/\D/g, ""))}
                      className="w-20 shrink-0"
                    >
                      <Input
                        placeholder="Year"
                        inputMode="numeric"
                        onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
                      />
                    </TextField>

                    <Button
                      onPress={() => searchMutation.mutate()}
                      isDisabled={searchMutation.isPending || !query.trim()}
                      className="shrink-0"
                    >
                      <Search size={16} />
                      {searchMutation.isPending ? "Searching…" : "Search"}
                    </Button>
                  </div>

                  {searchMutation.isError && (
                    <p className="text-sm text-danger-soft-foreground">
                      TMDB search failed. Verify the server has a TMDB token configured.
                    </p>
                  )}

                  <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                    {results.map((c) => (
                      <div
                        key={c.tmdbId}
                        className="flex items-center gap-4 rounded-lg border border-border/60 bg-surface p-3 transition-colors hover:border-border"
                      >
                        <div className="h-16 w-11 shrink-0 overflow-hidden rounded-sm bg-surface-secondary">
                          {c.poster ? (
                            <img src={c.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">
                              No Art
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">{c.title}</p>
                            {c.year && <span className="text-xs text-muted">{c.year}</span>}
                          </div>
                          {c.overview && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{c.overview}</p>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => applyMutation.mutate(c.tmdbId)}
                          isDisabled={applyMutation.isPending}
                          className="shrink-0 text-xs"
                        >
                          <Check size={14} />
                          Match
                        </Button>
                      </div>
                    ))}

                    {results.length === 0 && !searchMutation.isPending && (
                      <p className="py-8 text-center text-sm text-muted">
                        Search TMDB to find matching titles.
                      </p>
                    )}
                  </div>
                </>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
