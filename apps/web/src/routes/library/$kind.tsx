/// Library dashboard (PRD 5.9, 10.2): a featured hero, the tabs, genres,
/// Top 10, continue watching, recently added, then the complete grid.
///
/// The hero and shelves follow the cinema reference; the grid stays the
/// canonical place to browse every title, with the same filters and sort.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListBox, Select } from "@heroui/react";
import { ArrowRight, FolderOpen, TrendingUp, X } from "lucide-react";
import { queries } from "../../queries";
import { LibraryHero } from "../../components/library-hero";
import { Poster } from "../../components/poster";
import { RankedPoster } from "../../components/ranked-poster";
import { Row } from "../../components/row";
import { artworkUrl } from "../../lib/artwork-url";
import { cx } from "../../lib/cx";
import { Page } from "../../components/page";
import { State } from "@/components/state";

const SORTS = [
  { value: "added", label: "Recently added" },
  { value: "name", label: "Alphabetical" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

function LibraryRoute() {
  const { kind } = useParams({ from: Route.id });
  const { genre, unwatched } = Route.useSearch();
  const [sort, setSort] = useState<SortKey>("added");
  const [visibleLimit, setVisibleLimit] = useState(200);

  const kindIsTv = kind === "tv" || kind === "series";
  const kindIsAll = kind === "all";
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.items({ sort: "added", limit: visibleLimit, unwatched, genre }),
  );
  const home = useQuery(queries.home());

  const allItems = useMemo(
    () => (data?.items ?? []).filter((item) => item.kind === "movie" || item.kind === "series"),
    [data],
  );
  const movies = allItems.filter((item) => item.kind === "movie");
  const shows = allItems.filter((item) => item.kind === "series");
  const items = kindIsAll ? allItems : kindIsTv ? shows : movies;

  // The catalog card carries artwork and facts; only the home payload knows the
  // episode a series should start. Merge that play target into the matching
  // card so the hero's Play button is real, not a second Details button.
  const featured = useMemo(() => {
    const pool = [...items].sort(
      (a, b) => Number(Boolean(b.logo)) - Number(Boolean(a.logo)),
    );
    const homeFeatured = home.data?.featured;
    if (homeFeatured) {
      const match = pool.findIndex((item) => item.publicId === homeFeatured.publicId);
      if (match >= 0) {
        const [item] = pool.splice(match, 1);
        pool.unshift({
          ...item,
          playFileId: homeFeatured.playFileId,
          playSubtitle: homeFeatured.playSubtitle,
          playWatch: homeFeatured.playWatch,
        });
      }
    }
    return pool.slice(0, Math.min(3, Math.max(1, pool.length)));
  }, [items, home.data]);

  const genreEntries = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      for (const name of item.genres) {
        const list = map.get(name) ?? [];
        list.push(item);
        map.set(name, list);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([name, list]) => ({ name, items: list.slice(0, 2), count: list.length }));
  }, [items]);

  const topRated = useMemo(
    () =>
      [...items]
        .filter((item) => item.rating != null)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 10),
    [items],
  );

  const recentlyAdded = useMemo(() => items.slice(0, 12), [items]);

  const continueItems = useMemo(
    () => home.data?.rows.find((row) => row.key === "continue")?.items ?? [],
    [home.data],
  );

  const sorted = useMemo(() => {
    if (sort === "added") return items;
    const list = [...items];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "year") list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    else if (sort === "rating") list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return list;
  }, [items, sort]);

  const filtered = useMemo(
    () => (genre ? sorted.filter((item) => item.genres.includes(genre)) : sorted),
    [sorted, genre],
  );

  const status = useQuery(queries.serverStatus());
  const scan = status.data?.scan?.status === "running" ? status.data.scan : null;

  if (isLoading && !data) {
    return (
      <Page>
        <div className="space-y-8">
          <div className="skeleton h-[clamp(25rem,52vh,35rem)] rounded-[calc(var(--radius)*2.2)]" />
          <div className="flex items-center justify-between">
            <div className="skeleton h-10 w-64 rounded-full" />
            <div className="skeleton h-9 w-40 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton aspect-[2/1] rounded-2xl" />
            ))}
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton aspect-[2/3] w-44 rounded-xl" />
            ))}
          </div>
        </div>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page>
        <State
          icon={FolderOpen}
          title="Couldn't load the library"
          body="Is Plexy running on this machine?"
        />
      </Page>
    );
  }

  if (data && items.length === 0 && !genre && !unwatched) {
    return (
      <Page>
        <State
          icon={FolderOpen}
          title={kindIsAll ? "No titles yet" : `No ${kindIsTv ? "TV shows" : "movies"} yet`}
          body="Scan a library or wait for a match pass to finish."
        />
      </Page>
    );
  }

  return (
    <Page className="pt-4 sm:pt-6">
      <h1 className="sr-only">Library</h1>
      <div className="space-y-9 pb-10 sm:space-y-10">
        {featured.length > 0 && <LibraryHero items={featured} />}

        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <nav className="segmented max-w-full overflow-x-auto" aria-label="Library kind">
            <Link to="/library/$kind" params={{ kind: "all" }} aria-current={kindIsAll ? "page" : undefined}>
              All
            </Link>
            <Link
              to="/library/$kind"
              params={{ kind: "movies" }}
              aria-current={!kindIsAll && !kindIsTv ? "page" : undefined}
            >
              Movies
            </Link>
            <Link to="/library/$kind" params={{ kind: "tv" }} aria-current={kindIsTv ? "page" : undefined}>
              TV shows
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {scan && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted" role="status">
                <span aria-hidden className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-border border-t-accent" />
                Scanning {scan.libraryName ?? "libraries"}
              </span>
            )}
            <span className="text-[11.5px] tabular-nums text-muted">
              {filtered.length.toLocaleString()} {filtered.length === 1 ? "title" : "titles"}
            </span>
            <Link
              to="/library/$kind"
              params={{ kind }}
              search={(previous) => ({ ...previous, unwatched: unwatched ? undefined : true })}
              className={cx(
                "inline-flex h-9 items-center rounded-full border px-3 text-[11px] font-semibold transition-colors",
                unwatched
                  ? "border-accent/50 bg-accent/10 text-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground",
              )}
            >
              Unwatched
            </Link>
            <Select
              aria-label="Sort order"
              selectedKey={sort}
              onSelectionChange={(key) => setSort(String(key) as SortKey)}
              className="w-40 shrink-0"
            >
              <Select.Trigger className="h-9">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {SORTS.map((entry) => (
                    <ListBox.Item key={entry.value} id={entry.value} textValue={entry.label}>
                      {entry.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        {genre && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cinema-line)] bg-white/[0.06] px-3 py-1.5 text-[11.5px] font-semibold text-foreground">
              {genre}
              <Link
                to="/library/$kind"
                params={{ kind }}
                aria-label={`Clear ${genre} filter`}
                className="inline-flex size-4 items-center justify-center rounded-full bg-white/10 text-muted hover:bg-white/20 hover:text-foreground"
              >
                <X size={11} />
              </Link>
            </span>
          </div>
        )}

        {!genre && genreEntries.length > 0 && (
          <section aria-labelledby="library-genres" className="min-w-0">
            <div className="mb-3.5 flex items-end justify-between gap-4">
              <h2 id="library-genres" className="font-sans text-[19px] font-bold tracking-[-0.025em] text-foreground">
                Our genres
              </h2>
              <span className="text-[11px] font-medium text-muted">Browse by mood</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {genreEntries.map((entry) => (
                <Link
                  key={entry.name}
                  to="/library/$kind"
                  params={{ kind }}
                  search={{ genre: entry.name }}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--cinema-line)] bg-[var(--cinema-surface)]"
                >
                  <div className="grid aspect-[1.65] grid-cols-2 gap-px bg-black/40">
                    {entry.items.map((item) => {
                      const src = artworkUrl(item.poster ?? item.backdrop);
                      return src ? (
                        <img
                          key={item.id}
                          src={src}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <span key={item.id} className="bg-[var(--cinema-surface)]" />
                      );
                    })}
                    {entry.items.length === 1 && <span className="bg-[var(--cinema-surface)]" />}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
                    <p className="truncate text-[13px] font-bold text-white">{entry.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-white/55">
                      {entry.count} {entry.count === 1 ? "title" : "titles"}
                      <ArrowRight size={10} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!genre && topRated.length >= 3 && (
          <section aria-labelledby="library-top-ten" className="min-w-0">
            <div className="mb-3.5 flex items-end justify-between gap-4">
              <h2 id="library-top-ten" className="inline-flex items-center gap-2 font-sans text-[19px] font-bold tracking-[-0.025em] text-foreground">
                <TrendingUp size={17} className="text-[var(--brand)]" aria-hidden />
                Top 10 in your library
              </h2>
            </div>
            <div className="scroll-row flex items-start gap-3 overflow-x-auto pb-1">
              {topRated.map((item, index) => (
                <RankedPoster key={item.id} item={item} rank={index + 1} />
              ))}
            </div>
          </section>
        )}

        {!genre && continueItems.length > 0 && (
          <Row title="Continue watching" items={continueItems} wide directPlay />
        )}

        {!genre && recentlyAdded.length > 0 && (
          <Row
            title="Recently added"
            items={recentlyAdded}
            action={
              <a
                href="#all-titles"
                className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
              >
                See all
                <ArrowRight size={12} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </a>
            }
          />
        )}

        <section id="all-titles" aria-labelledby="library-all-titles" className="scroll-mt-24">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="library-all-titles" className="font-sans text-[19px] font-bold tracking-[-0.025em] text-foreground">
                {genre ? genre : "All titles"}
              </h2>
              <p className="mt-1 text-[11.5px] text-muted">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? "title" : "titles"}
                {isFetching && <span className="ml-2 opacity-70">Updating…</span>}
              </p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-border/60 p-8 text-center text-[13px] text-muted">
              No titles match this filter.
            </div>
          ) : (
            <>
              <div
                className={cx(
                  "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-7 transition-opacity duration-150",
                  isFetching && "opacity-70",
                )}
              >
                {filtered.map((item) => (
                  <Poster key={item.id} item={item} />
                ))}
              </div>
              {(data?.total ?? filtered.length) > filtered.length && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((current) => current + 200)}
                    disabled={isFetching}
                    className="rounded-full border border-border bg-surface px-5 py-2 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-surface-secondary disabled:opacity-50"
                  >
                    {isFetching ? "Loading…" : `Load more (${(data?.total ?? 0) - filtered.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Page>
  );
}

export const Route = createFileRoute("/library/$kind")({
  validateSearch: (search: Record<string, unknown>): { genre?: string; unwatched?: boolean } => ({
    genre: typeof search.genre === "string" && search.genre.trim() ? search.genre : undefined,
    unwatched: search.unwatched === true || search.unwatched === "true" ? true : undefined,
  }),
  component: LibraryRoute,
});
