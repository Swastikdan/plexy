/// Home: horizontally scrolling library rows.
import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, ChevronRight, X } from "lucide-react";
import { queries } from "../queries";
import { Row } from "../components/row";
import { Button } from "../components/ui/button";
import { PageLoader } from "../components/page-loader";
import { Dialog } from "../components/ui/dialog";
import { Poster } from "../components/poster";

export default function HomeRoute() {
  const navigate = useNavigate();
  const [continueModalOpen, setContinueModalOpen] = useState(false);
  const status = useQuery(queries.serverStatus());
  const { data, isLoading, isError } = useQuery(queries.home());

  useEffect(() => {
    if (status.data && !status.data.setupComplete) {
      void navigate({ to: "/setup", replace: true });
    }
  }, [status.data, navigate]);

  if (status.isLoading || (status.data && !status.data.setupComplete) || isLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
        <PageLoader />
      </main>
    );
  }
  if (isError) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-12 sm:px-8">
        <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
          <h2 className="font-display text-xl font-bold text-ink">Home failed to load</h2>
          <p className="text-sm text-ink-muted">The server didn't answer. Is Plexy running?</p>
          <Link to="/setup">
            <Button variant="brand" className="mt-4">
              Server Setup
            </Button>
          </Link>
        </div>
      </main>
    );
  }
  if (!data) return null;

  const rows = data.rows.length > 0
    ? data.rows
    : data.featured
      ? [{ key: "featured", title: "Featured", items: [data.featured] }]
      : [];
  const empty = rows.length === 0;
  const continueRow = rows.find((r) => r.key === "continue");

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      {empty ? (
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface border border-line text-brand-text">
            <Plus size={32} />
          </div>
          <h2 className="font-display text-2xl font-bold text-ink">Your library is ready</h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress.
          </p>
          <Link to="/admin">
            <Button variant="brand" className="mt-2 h-11 px-6 text-sm font-bold">
              Add a Library
            </Button>
          </Link>
        </div>
      ) : (
        <div className="staggered">
          <div className="space-y-8 pt-5 sm:pt-8">
            {rows.map((row) => (
              <Row
                key={row.key}
                title={row.title}
                items={row.items}
                directPlay={row.key === "continue" || row.key === "next"}
                wide={row.key === "continue" || row.key === "next"}
                action={
                  row.key === "continue" && row.items.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setContinueModalOpen(true)}
                      className="flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-brand-text transition-colors py-1 px-2.5 rounded-lg hover:bg-surface border border-transparent hover:border-line cursor-pointer"
                    >
                      <span>See all ({row.items.length})</span>
                      <ChevronRight size={14} />
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {continueRow && (
        <Dialog.Root open={continueModalOpen} onOpenChange={setContinueModalOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs" />
            <Dialog.Popup className="w-[min(94vw,960px)] max-h-[85vh] p-5 sm:p-6 bg-surface-2 border border-line rounded-2xl flex flex-col gap-4 overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2.5">
                  <Dialog.Title className="text-lg font-bold text-ink">Continue Watching</Dialog.Title>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-ink-muted font-medium">
                    {continueRow.items.length} {continueRow.items.length === 1 ? "title" : "titles"}
                  </span>
                </div>
                <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-white/10 transition-colors">
                  <X size={18} />
                </Dialog.Close>
              </div>

              {continueRow.items.length === 0 ? (
                <div className="py-12 text-center text-sm text-ink-muted">
                  No titles currently in continue watching.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto max-h-[calc(85vh-120px)] pr-1 pt-1">
                  {continueRow.items.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1.5">
                      <Poster
                        item={item}
                        wide
                        directPlay
                        className="w-full aspect-video"
                      />
                      <div className="px-1 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-ink truncate">{item.name}</span>
                        {item.watch?.percent != null && (
                          <span className="text-[11px] text-ink-muted shrink-0">
                            {Math.round(item.watch.percent)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({ component: HomeRoute });

export function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
      {action}
    </div>
  );
}
