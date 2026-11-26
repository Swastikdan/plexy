/// Library dashboard (PRD 5.9, 10.2): the kind switch, genre cards, Top 10,
/// continue watching, recently added, then the complete grid.
///
/// The shelves follow the cinema reference; the grid stays the canonical place
/// to browse every title, with the same filters and sort.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListBox, Select } from "@heroui/react";
import {
  ArrowRight,
  Baby,
  Clapperboard,
  Drama,
  Eye,
  Film,
  FolderOpen,
  Ghost,
  Heart,
  Landmark,
  Laugh,
  Music,
  Rocket,
  Shield,
  Sparkles,
  Sun,
  Swords,
  TrendingUp,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { queries } from "@/queries";
import { Poster } from "@/components/poster";
import { RankedPoster } from "@/components/ranked-poster";
import { Row } from "@/components/row";
import { cx } from "@/lib/cx";
import { Page } from "@/components/page";
import { State } from "@/components/state";

type GenreVisual = { icon: LucideIcon; glow: string };

/// Genre cards are a visual index, not another poster shelf. Match the common
/// TMDB genres to one icon and one tint so the grid reads at a glance.
const GENRE_VISUALS: { match: string[]; visual: GenreVisual }[] = [
  { match: ["action", "adventure"], visual: { icon: Swords, glow: "#3b82f6" } },
  { match: ["anime", "animation"], visual: { icon: Sparkles, glow: "#a855f7" } },
  { match: ["comedy"], visual: { icon: Laugh, glow: "#eab308" } },
  { match: ["documentary"], visual: { icon: Clapperboard, glow: "#14b8a6" } },
  { match: ["drama"], visual: { icon: Drama, glow: "#f97316" } },
  { match: ["fantasy"], visual: { icon: WandSparkles, glow: "#8b5cf6" } },
  { match: ["horror"], visual: { icon: Ghost, glow: "#22c55e" } },
  { match: ["kids", "family"], visual: { icon: Baby, glow: "#f59e0b" } },
  { match: ["mystery", "thriller"], visual: { icon: Eye, glow: "#6366f1" } },
  { match: ["romance"], visual: { icon: Heart, glow: "#ec4899" } },
  { match: ["science fiction", "sci-fi"], visual: { icon: Rocket, glow: "#0ea5e9" } },
  { match: ["music"], visual: { icon: Music, glow: "#d946ef" } },
  { match: ["war", "crime"], visual: { icon: Shield, glow: "#64748b" } },
  { match: ["history"], visual: { icon: Landmark, glow: "#a16207" } },
  { match: ["western"], visual: { icon: Sun, glow: "#ea580c" } },
];

function genreVisual(name: string): GenreVisual {
  const needle = name.toLowerCase();
  for (const entry of GENRE_VISUALS) {
    if (entry.match.some((word) => needle.includes(word))) return entry.visual;
  }
  return { icon: Film, glow: "#64748b" };
}

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
  const serverKind = kindIsAll ? undefined : kindIsTv ? "series" : "movie";
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.items({ kind: serverKind, sort: "added", limit: visibleLimit, unwatched, genre }),
  );
  const home = useQuery(queries.home());
  // Counts tell the kind switch whether both shelves are worth offering even
  // when only the first page of the catalog has loaded.
  const movieCount = useQuery(queries.items({ kind: "movie", limit: 1 }));
  const showCount = useQuery(queries.items({ kind: "series", limit: 1 }));

  const items = useMemo(
    () => (data?.items ?? []).filter((item) => item.kind === "movie" || item.kind === "series"),
    [data],
  );

  const genreEntries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const name of item.genres) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  // Only offer the kind switch when both shelves have something to show.
  // A lone Movies or TV tab would lead to an empty page with no way back.
  const showKindSwitch =
    (movieCount.data?.total ?? 0) > 0 && (showCount.data?.total ?? 0) > 0;

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

  const status = useQuery({
    ...queries.serverStatus(),
    // Scan state is the only thing this page needs from the polled status.
    // Keeping the rest out of the observer avoids re-rendering the whole grid
    // when only the uptime counter changes.
    select: (data) => data.scan,
  });
  const scan = status.data?.status === "running" ? status.data : null;

  if (isLoading && !data) {
    return (
      <Page>
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div className="skeleton h-10 w-64 rounded-full" />
            <div className="skeleton h-9 w-40 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="skeleton aspect-[2/1] rounded-2xl" />
            ))}
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton aspect-video w-64 rounded-xl" />
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
          title={kindIsAll ? "No titles yet" : `No ${kindIsTv ? "TV shows" : "movies"} in this library`}
          body={
            kindIsAll
              ? "Scan a library or wait for a match pass to finish."
              : "The other titles in your library are still available."
          }
          action={
            kindIsAll ? undefined : (
              <Link
                to="/library/$kind"
                params={{ kind: "all" }}
                className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-surface-secondary"
              >
                Back to the library
              </Link>
            )
          }
        />
      </Page>
    );
  }

  return (
    <Page className="pt-4 sm:pt-6">
      <header className="pb-6">
        <h1 className="font-sans text-[1.8rem] font-extrabold tracking-[-0.04em] text-foreground">
          Library
        </h1>
        <p className="mt-1.5 text-[12px] text-muted">
          Browse every movie and show in your libraries.
        </p>
      </header>
      <div className="space-y-9 pb-10 sm:space-y-10">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          {showKindSwitch && (
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
          )}

          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
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
                Categories
              </h2>
              <span className="text-[11px] font-medium text-muted">Browse by mood</span>
            </div>
            <p className="mb-3 text-[13px] font-bold tracking-[-0.01em] text-foreground">Genres</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {genreEntries.map((entry) => {
                const { icon: Icon, glow } = genreVisual(entry.name);
                return (
                  <Link
                    key={entry.name}
                    to="/library/$kind"
                    params={{ kind }}
                    search={{ genre: entry.name }}
                    className="group relative flex aspect-[1.9] min-h-[6.5rem] flex-col justify-between overflow-hidden rounded-2xl border border-[var(--cinema-line)] p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/25"
                    style={{
                      background: `linear-gradient(145deg, ${glow}2e 0%, ${glow}12 36%, #0b0b0c 86%)`,
                    }}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-5 -right-3 text-white/[0.05] transition-transform duration-300 group-hover:scale-105"
                    >
                      <Icon size={84} strokeWidth={1.4} />
                    </span>
                    <Icon
                      size={22}
                      strokeWidth={1.8}
                      aria-hidden
                      className="relative text-white/65 transition-colors duration-200 group-hover:text-white"
                    />
                    <div className="relative min-w-0">
                      <p className="truncate text-[14px] font-bold tracking-[-0.01em] text-white">
                        {entry.name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium text-white/45">
                        {entry.count} {entry.count === 1 ? "title" : "titles"}
                        <ArrowRight
                          size={10}
                          className="transition-transform duration-150 group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {!genre && topRated.length >= 3 && (
          <section aria-labelledby="library-top-ten" className="min-w-0">
            <div className="mb-3.5 flex items-end justify-between gap-4">
              <h2
                id="library-top-ten"
                className="inline-flex items-center gap-2 font-sans text-[17px] font-bold tracking-[-0.025em] text-foreground sm:text-[19px]"
              >
                <TrendingUp size={17} className="text-[var(--brand)]" aria-hidden />
                Top 10 in your library
              </h2>
            </div>
            <div className="scroll-smooth [scroll-snap-type:x_proximity] [scroll-padding-inline:var(--row-inset)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start flex items-start gap-2 overflow-x-auto pb-1 sm:gap-3">
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
          <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h2
              id="library-all-titles"
              className="font-sans text-[17px] font-bold tracking-[-0.025em] text-foreground sm:text-[19px]"
            >
              {genre ? genre : "All titles"}
            </h2>
            <p className="text-[11.5px] text-muted">
              {filtered.length.toLocaleString()} {filtered.length === 1 ? "title" : "titles"}
              {isFetching && <span className="ml-2 opacity-70">Updating…</span>}
            </p>
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
                  // Keep the desktop grid on the shelf's poster size instead of
                  // stretching the columns: the Row card is a 2:3 poster at
                  // 16rem tall, so its width is 16rem × 2/3.
                  "lg:grid-cols-[repeat(auto-fill,calc(16rem*2/3))]",
                  isFetching && "opacity-70",
                )}
              >
                {filtered.map((item) => (
                  <Poster key={item.id} item={item} sizes="(min-width: 1024px) 171px, 190px" className="aspect-[2/3] h-auto w-full" />
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
