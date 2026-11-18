/// Search (PRD 10.2): debounced typed results over the local catalog.
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchField } from "@heroui/react";
import { ArrowRight, Compass } from "lucide-react";
import { queries } from "../queries";
import { SearchResultCard } from "../components/search-result-card";
import { Row } from "../components/row";
import { Page } from "../components/page";
import { PageLoader } from "../components/page-loader";
import { State } from "@/components/state";

function ResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-7">
      <div className="flex items-baseline gap-2 border-b border-border/70 pb-2">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">{title}</h2>
        <span className="text-[10px] tabular-nums text-muted">{count}</span>
      </div>
      <div className="mt-2.5 grid max-w-5xl gap-2">{children}</div>
    </section>
  );
}

function SearchRoute() {
  const { q: initial = "" } = Route.useSearch();
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);

  // Keep the input in sync when the search query changes in the URL.
  useEffect(() => {
    setQ(initial);
    setDebounced(initial);
  }, [initial]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery(queries.search(debounced));
  const hasQuery = debounced.trim().length > 0;
  const titles = data?.titles ?? [];
  const episodes = data?.episodes ?? [];
  const count = titles.length + episodes.length;

  // The empty search is a doorway, not a dead end: show what is already in
  // progress and what just arrived, so people can start without typing.
  const home = useQuery({ ...queries.home(), enabled: !hasQuery });
  const continueRow = home.data?.rows.find((row) => row.key === "continue");
  const recentRow = home.data?.rows.find((row) => row.key === "recent-shows" || row.key === "recent-movies");

  return (
    <Page className="pt-4 sm:pt-5">
      <div className="sticky top-[3.25rem] z-20 -mx-4 border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8 lg:top-[var(--app-topbar-height)]">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <SearchField
            autoFocus
            value={q}
            onChange={setQ}
            aria-label="Search your films and shows"
            fullWidth
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search your films and shows…" />
              {isFetching ? (
                <span
                  className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-separator border-t-accent"
                  role="status"
                  aria-label="Searching"
                />
              ) : (
                <SearchField.ClearButton aria-label="Clear search" />
              )}
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      {!hasQuery && (
        <div className="space-y-8 pt-6">
          {home.isLoading && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="skeleton h-5 w-36 rounded-md" />
                <div className="skeleton h-3 w-52 rounded-md" />
              </div>
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton aspect-video h-[10.5rem] shrink-0 rounded-xl" />
                ))}
              </div>
            </div>
          )}
          {continueRow && continueRow.items.length > 0 && (
            <Row
              title="Jump back in"
              items={continueRow.items.slice(0, 8)}
              directPlay
              wide
            />
          )}
          {recentRow && recentRow.items.length > 0 && (
            <Row
              title="Recently added"
              items={recentRow.items.slice(0, 10)}
              action={
                <Link
                  to="/library/$kind"
                  params={{ kind: recentRow.key === "recent-shows" ? "tv" : "movies" }}
                  className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                >
                  See all
                  <ArrowRight size={12} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                </Link>
              }
            />
          )}
          {!home.isLoading && !continueRow && !recentRow && (
            <State
              icon={Compass}
              title="Search your library"
              body="Type a title, an actor, or an episode name. Results appear as you type."
            />
          )}
        </div>
      )}

      {hasQuery && isFetching && !data && (
        <PageLoader label="Searching" className="min-h-[36vh]" />
      )}
      {hasQuery && data && count === 0 && (
        <State
          icon={Compass}
          title="No matches"
          body={`Nothing in your library matches ${debounced}. Try a shorter title or an actor's name.`}
        />
      )}
      {data && count > 0 && (
        <div className="max-w-5xl pt-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-sans text-base font-bold tracking-[-0.025em] text-foreground">
              {count} {count === 1 ? "result" : "results"} for <span className="text-muted">“{debounced}”</span>
            </h2>
            {isFetching && <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted/60">Updating…</span>}
          </div>

          <ResultSection title="Movies & Series" count={titles.length}>
            {titles.map((item) => (
              <SearchResultCard key={`title-${item.id}`} item={item} />
            ))}
          </ResultSection>

          <ResultSection title="Episodes" count={episodes.length}>
            {episodes.map((item) => (
              <SearchResultCard key={`episode-${item.id}`} item={item} />
            ))}
          </ResultSection>
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/search")({
  component: SearchRoute,
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    if ("q" in search && typeof search.q === "string") return { q: search.q };
    return {};
  },
});
