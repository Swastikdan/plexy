/// Search OpenSubtitles from the title page and save the chosen track.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@heroui/react";
import { Captions, Check, Download, X } from "lucide-react";
import { api } from "../client";
import type { SubtitleSearchResult } from "@plexy/api-client";

export function SubtitleSearchModal({
  fileId,
  title,
  open,
  onOpenChange,
}: {
  fileId: number;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState("");
  const results = useQuery({
    queryKey: ["subtitle-search", fileId],
    queryFn: () => api.searchSubtitles(fileId),
    enabled: open,
    staleTime: 60_000,
  });

  const download = useMutation({
    mutationFn: (result: SubtitleSearchResult) => api.downloadSubtitle(fileId, result),
    onMutate: (result) => {
      setDownloading(result.id);
      setError("");
      setSaved(null);
    },
    onSuccess: async (response) => {
      setSaved(response.track.title);
      await queryClient.invalidateQueries({ queryKey: ["subtitles", fileId] });
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Could not save this subtitle.");
    },
    onSettled: () => setDownloading(null),
  });

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,640px)]">
            <Modal.Header className="mb-3 flex items-start justify-between gap-4">
              <div>
                <Modal.Heading className="flex items-center gap-2 font-sans text-xl font-bold text-foreground">
                  <Captions size={17} />
                  Find subtitles
                </Modal.Heading>
                <p className="mt-1 text-xs text-muted">{title}</p>
              </div>
              <Modal.CloseTrigger
                aria-label="Close"
                className="text-muted transition-colors hover:text-foreground"
              >
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body>
              {results.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="skeleton h-14 rounded-lg" />
                  ))}
                </div>
              ) : results.isError ? (
                <p className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-[12px] text-danger-soft-foreground">
                  {results.error instanceof Error
                    ? results.error.message
                    : "Could not search for subtitles."}
                </p>
              ) : (results.data?.results.length ?? 0) === 0 ? (
                <p className="rounded-xl border border-border bg-surface-secondary/40 p-4 text-center text-[12px] text-muted">
                  No matching subtitles were found.
                </p>
              ) : (
                <ul className="max-h-96 divide-y divide-border/60 overflow-auto rounded-xl border border-border">
                  {results.data!.results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        disabled={download.isPending}
                        onClick={() => download.mutate(result)}
                        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-secondary/50 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-foreground">
                            {result.name}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] uppercase tracking-[0.08em] text-muted">
                            {result.language || "Unknown"} · OpenSubtitles
                          </span>
                        </span>
                        {downloading === result.id ? (
                          <span className="text-[10.5px] font-semibold text-muted">Saving…</span>
                        ) : saved === result.name ? (
                          <Check size={15} className="text-success-soft-foreground" />
                        ) : (
                          <Download size={15} className="text-muted" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {saved && (
                <p className="mt-3 text-[11.5px] font-medium text-success-soft-foreground">
                  Saved “{saved}”. Choose it from the player’s captions menu on the next play.
                </p>
              )}
              {error && (
                <p role="alert" className="mt-3 text-[11.5px] text-danger-soft-foreground">
                  {error}
                </p>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
