/// Search (PRD 10.2): debounced typed results over the local catalog.
///
/// The field owns the width of the page, results fill it in a responsive grid,
/// and the previous results stay visible while the next query resolves so the
/// screen never flashes empty between keystrokes.
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchField } from "@heroui/react";
import { ArrowRight, Compass, UserRound } from "lucide-react";
import { queries } from "@/queries";
import { SearchResultCard } from "@/components/search-result-card";
import { Row } from "@/components/row";
import { Page } from "@/components/page";
import { State } from "@/components/state";
import { artworkUrl } from "@/lib/artwork-url";
import type { PersonSummary } from "@plexy/api-client";

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
    <section className="pt-7 first:pt-5">
      <div className="flex items-baseline gap-2 pb-3">
        <h2 className="font-sans text-[15px] font-bold tracking-[-0.02em] text-foreground">{title}</h2>
        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted">
          {count}
        </span>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">{children}</div>
    </section>
  );
}

function SearchPersonCard({ person }: { person: PersonSummary }) {
  return (
    <Link
      to="/person/$personId"
      params={{ personId: String(person.id) }}
      className="media-card group flex items-center gap-3.5 rounded-xl border border-border/60 p-2.5 transition-colors hover:bg-surface-secondary/40"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-secondary">
        {person.photo ? (
          <img
            src={artworkUrl(person.photo) ?? ""}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <UserRound size={20} className="text-muted" aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {person.name}
        </span>
        <span className="mt-0.5 block text-[10.5px] text-muted">
          Cast &amp; crew
        </span>
      </span>
    </Link>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid gap-2.5 pt-6 md:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-xl border border-border/60 p-2.5">
          <div className="skeleton aspect-video w-32 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-2.5 w-24 rounded" />
            <div className="skeleton h-3.5 w-3/5 rounded" />
            <div className="skeleton h-2.5 w-4/5 rounded" />
          </div>
        </div>
      ))}
    </div>
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
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, isFetching, isLoading } = useQuery(queries.search(debounced));
  const hasQuery = debounced.trim().length > 0;
  const titles = data?.titles ?? [];
  const episodes = data?.episodes ?? [];
  const people = data?.people ?? [];
  const count = titles.length + episodes.length + people.length;

  // The empty search is a doorway, not a dead end: show what is already in
  // progress and what just arrived, so people can start without typing.
  const home = useQuery({ ...queries.home(), enabled: !hasQuery });
  const continueRow = home.data?.rows.find((row) => row.key === "continue");
  const recentRow = home.data?.rows.find((row) => row.key === "recent-shows" || row.key === "recent-movies");

  return (
    <Page className="!pt-0">
      <div className="sticky top-[3.25rem] z-20 -mx-[var(--app-gutter)] border-b border-border/70 bg-background/92 px-[var(--app-gutter)] py-3 backdrop-blur-xl md:top-[var(--app-topbar-height)]">
        <div className="flex w-full items-center">
          <SearchField
            autoFocus
            value={q}
            onChange={setQ}
            aria-label="Search your films and shows"
            fullWidth
          >
            <SearchField.Group className="h-11 rounded-full border-border/70 bg-surface-secondary/45 px-4">
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Search your films and shows…"
                aria-label="Search your films and shows"
                className="text-[14px]"
              />
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
                {[0, 1, 2].map((index) => (
                  <div key={index} className="skeleton aspect-video h-[10.5rem] shrink-0 rounded-xl" />
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

      {hasQuery && (isLoading || (isFetching && !data)) && <SearchSkeleton />}

      {hasQuery && data && count === 0 && (
        <State
          icon={Compass}
          title="No matches"
          body={`Nothing in your library matches ${debounced}. Try a shorter title or an actor's name.`}
        />
      )}

      {hasQuery && data && count > 0 && (
        <div className={isFetching ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
          <div className="flex flex-wrap items-baseline justify-between gap-3 pb-1 pt-5">
            <h2 className="font-sans text-lg font-bold tracking-[-0.025em] text-foreground">
              {count} {count === 1 ? "result" : "results"} for <span className="font-semibold text-muted">“{debounced}”</span>
            </h2>
            {isFetching && <span role="status" className="text-[11px] font-medium text-muted">Updating…</span>}
          </div>

          <ResultSection title="Movies and series" count={titles.length}>
            {titles.map((item) => (
              <SearchResultCard key={`title-${item.id}`} item={item} />
            ))}
          </ResultSection>

          <ResultSection title="Episodes" count={episodes.length}>
            {episodes.map((item) => (
              <SearchResultCard key={`episode-${item.id}`} item={item} />
            ))}
          </ResultSection>

          <ResultSection title="People" count={people.length}>
            {people.map((person) => (
              <SearchPersonCard key={`person-${person.id}`} person={person} />
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
