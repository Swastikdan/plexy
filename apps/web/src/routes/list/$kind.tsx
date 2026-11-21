/// Server-backed watchlist, favorites, and hidden-title lists.
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, EyeOff, Heart, RotateCcw } from "lucide-react";
import { api } from "@/client";
import { queries } from "@/queries";
import { Poster } from "@/components/poster";
import { Page } from "@/components/page";
import { State } from "@/components/state";

type ListKind = "watchlist" | "favorites" | "hidden";

const META: Record<ListKind, { title: string; empty: string; icon: typeof Bookmark }> = {
  watchlist: {
    title: "Watchlist",
    empty: "Add a title from its page to keep it here.",
    icon: Bookmark,
  },
  favorites: {
    title: "Favorites",
    empty: "Tap the heart on a title to keep it here.",
    icon: Heart,
  },
  hidden: {
    title: "Hidden titles",
    empty: "Removed titles will appear here so you can restore them.",
    icon: EyeOff,
  },
};

function ListRoute() {
  const { kind } = useParams({ from: Route.id }) as { kind: ListKind };
  const meta = META[kind] ?? META.watchlist;
  const queryClient = useQueryClient();
  const query = useQuery(
    queries.items({
      watchlist: kind === "watchlist",
      favorite: kind === "favorites",
      hidden: kind === "hidden",
      limit: 1000,
    }),
  );
  const Icon = meta.icon;
  const items = query.data?.items ?? [];

  return (
    <Page className="pt-4 sm:pt-6">
      <header className="pb-6">
        <div className="flex items-center gap-2 text-muted">
          <Icon size={15} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            Your library
          </span>
        </div>
        <h1 className="mt-2 font-sans text-[1.8rem] font-extrabold tracking-[-0.04em] text-foreground">
          {meta.title}
        </h1>
        <p className="mt-1.5 text-[12px] text-muted">
          {items.length.toLocaleString()} {items.length === 1 ? "title" : "titles"}
        </p>
      </header>

      {query.isLoading && !query.data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="skeleton aspect-[2/3] rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <State title="Couldn't load this list" body="Is Plexy running on this machine?" />
      ) : items.length === 0 ? (
        <State icon={Icon} title="Nothing here yet" body={meta.empty} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-7">
          {items.map((item) => (
            <div key={item.id} className="relative">
              <Poster item={item} />
              {kind === "hidden" && (
                <button
                  type="button"
                  onClick={() => {
                    void api.setFlags(item.id, { hidden: false }).then(() => {
                      void queryClient.invalidateQueries({ queryKey: ["home"] });
                      void queryClient.invalidateQueries({ queryKey: ["items"] });
                    });
                  }}
                  aria-label={`Restore ${item.name}`}
                  title="Restore"
                  className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/85"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/list/$kind")({
  component: ListRoute,
});
