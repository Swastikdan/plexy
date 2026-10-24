/// Search (PRD 10.2): debounced typed results over the local catalog.
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../queries";
import { Poster } from "../components/poster";
import { PageLoader } from "../components/page-loader";
import { State } from "./index";

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

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      <label
        className="mt-6 flex h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 transition-[border-color] focus-within:border-brand/70"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your films and shows"
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-muted/70 outline-none"
        />
        {isFetching && (
          <span
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-brand"
            role="status"
            aria-label="Searching"
          />
        )}
      </label>

      {!debounced && (
        <State
          title="Search your library"
          body="Type to find films and shows. Titles match first."
        />
      )}
      {debounced && isFetching && !data && <PageLoader label="Searching" className="min-h-[36vh]" />}
      {debounced && data && data.items.length === 0 && (
        <State
          title="No matches"
          body={`Nothing in your library matches ${debounced}.`}
        />
      )}
      {data && data.items.length > 0 && (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-x-4 sm:gap-y-6">
          {data.items.map((item) => (
            <Poster
              key={item.id}
              item={item}
              showKind
              className="aspect-[2/3] w-full"
            />
          ))}
        </div>
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
