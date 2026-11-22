/// Watch history: every movie and episode the account has started, newest first.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock3, Trash2, X } from "lucide-react";
import { api, type ItemCard } from "@/client";
import { queries } from "@/queries";
import { Page } from "@/components/page";
import { Poster } from "@/components/poster";
import { State } from "@/components/state";

function watchedLabel(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function HistoryRoute() {
  const queryClient = useQueryClient();
  const history = useQuery(queries.history(200));
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const items = history.data?.items ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["home"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const remove = async (item: ItemCard) => {
    setBusy(item.id);
    try {
      await api.removeHistory(item.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!window.confirm("Clear your entire watch history and every resume point?")) return;
    setBusy("all");
    try {
      await api.clearHistory();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page className="pt-4 sm:pt-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="font-sans text-[1.8rem] font-extrabold tracking-[-0.04em] text-foreground">
            History
          </h1>
          <p className="mt-1.5 text-[12px] text-muted">
            {items.length.toLocaleString()} {items.length === 1 ? "title" : "titles"} watched
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-semibold text-muted transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger-soft-foreground disabled:opacity-50"
          >
            <Trash2 size={13} />
            {busy === "all" ? "Clearing…" : "Clear history"}
          </button>
        )}
      </header>

      {history.isLoading && !history.data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="skeleton aspect-[2/3] rounded-xl" />
          ))}
        </div>
      ) : history.isError ? (
        <State title="Couldn't load your history" body="Is Plexy running on this machine?" />
      ) : items.length === 0 ? (
        <State
          icon={Clock3}
          title="Nothing watched yet"
          body="Movies and episodes show up here as you play them."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-7">
          {items.map((item) => (
            <div key={item.id} className="group relative">
              <Poster item={item} sizes="(min-width: 1280px) 220px, (min-width: 768px) 200px, 180px" />
              <div className="flex items-center justify-between gap-2 pr-1 pt-0.5">
                <p className="text-[10px] text-muted">{watchedLabel(item.watchedAt)}</p>
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busy !== null}
                  aria-label={`Remove ${item.name} from history`}
                  title="Remove from history"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted opacity-0 transition-[color,background-color,opacity] hover:bg-surface-secondary hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/history")({
  component: HistoryRoute,
});
