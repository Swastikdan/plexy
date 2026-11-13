/// Search (PRD 10.2): debounced typed results over the local catalog.
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchField } from "@heroui/react";
import { queries } from "../queries";
import { SearchResultCard } from "../components/search-result-card";
import { PageHeader } from "../components/page-header";
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
    <section className="mt-8">
      <div className="flex items-baseline gap-2">
        <h2 className="font-sans text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-[11px] tabular-nums text-muted">{count}</span>
      </div>
      <div className="mt-3 grid max-w-5xl gap-2.5 sm:gap-3">{children}</div>
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

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      {/* Page context: the search page should read as a place, not a bare input. */}
      <PageHeader
        eyebrow="Library"
        title="Search"
        description="Find films, shows, and episodes across your server."
      />

      {/* Sticky under the app header so the search field keeps its nav context
          while results scroll. */}
      <div className="sticky top-12 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md sm:top-14 sm:-mx-8 sm:px-8">
        <SearchField
          autoFocus
          value={q}
          onChange={setQ}
          aria-label="Search your films and shows"
          fullWidth
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search your films and shows" />
            {isFetching ? (
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-separator border-t-foreground"
                role="status"
                aria-label="Searching"
              />
            ) : (
              <SearchField.ClearButton aria-label="Clear search" />
            )}
          </SearchField.Group>
        </SearchField>
      </div>

      {!hasQuery && (
        <State
          title="Search your library"
          body="Type to find films and shows. Titles match first."
        />
      )}
      {hasQuery && isFetching && !data && (
        <PageLoader label="Searching" className="min-h-[36vh]" />
      )}
      {hasQuery && data && count === 0 && (
        <State
          title="No matches"
          body={`Nothing in your library matches ${debounced}.`}
        />
      )}
      {data && count > 0 && (
        <>
          <div className="mt-6 flex items-baseline justify-between gap-4">
            <h2 className="font-sans text-sm font-semibold text-foreground">
              {count} {count === 1 ? "result" : "results"} for “{debounced}”
            </h2>
            {isFetching && (
              <span className="text-[11px] text-muted">Updating…</span>
            )}
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
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/search")({
  component: SearchRoute,
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    if ("q" in search && typeof search.q === "string") return { q: search.q };
    return {};
  },
});
