/// Library grid (PRD 5.9, 10.2): every movie and show in one library.
///
/// Browse cards are landscape 18:9 stills, not portrait posters, so a shelf of
/// titles reads as a row of films rather than a wall of tall covers. Episodes
/// never appear here. The kind tabs only exist when the library actually holds
/// both movies and shows.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListBox, Select } from "@heroui/react";
import { FolderOpen } from "lucide-react";
import { queries } from "../../queries";
import { Poster } from "../../components/poster";
import { cx } from "../../lib/cx";
import { Page } from "../../components/page";
import { State } from "@/components/state";

const SORTS = [
  { value: "name", label: "Alphabetical" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
] as const;

function LibraryRoute() {
  const { kind } = useParams({ from: Route.id });
  const [sort, setSort] = useState<string>("added");

  const kindIsTv = kind === "tv" || kind === "series";
  const kindIsAll = kind === "all";
  const { data, isLoading, isFetching, isError } = useQuery(queries.items({ sort }));

  // One unfiltered read gives the page both the grid and the tab decision.
  const allItems = useMemo(
    () => (data?.items ?? []).filter((item) => item.kind === "movie" || item.kind === "series"),
    [data],
  );
  const movies = allItems.filter((item) => item.kind === "movie");
  const shows = allItems.filter((item) => item.kind === "series");
  const items = kindIsAll ? allItems : kindIsTv ? shows : movies;
  const bothKinds = movies.length > 0 && shows.length > 0;

  // Server-driven scan indicator: shows for every scan whatever triggered it
  // (auto-scan or a manual rescan), sharing the status cache the app polls.
  const status = useQuery(queries.serverStatus());
  const scan = status.data?.scan?.status === "running" ? status.data.scan : null;

  const label = kindIsAll ? "Library" : kindIsTv ? "TV shows" : "Movies";

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6">
        <div className="min-w-0">
          <h1 className="font-sans text-[1.6rem] font-extrabold leading-tight tracking-[-0.04em] text-foreground sm:text-[1.9rem]">
            {label}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {data && <span>{items.length.toLocaleString()}</span>}
            {scan && (
              <span className="inline-flex items-center gap-1.5" role="status" data-testid="scan-indicator">
                <span className="text-muted/35" aria-hidden>·</span>
                <span aria-hidden className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-border border-t-accent" />
                Scanning {scan.libraryName ?? "libraries"}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {bothKinds && (
            <nav className="segmented max-w-full overflow-x-auto" aria-label="Library kind">
              <Link
                to="/library/$kind"
                params={{ kind: "all" }}
                aria-current={kindIsAll ? "page" : undefined}
              >
                All
              </Link>
              <Link
                to="/library/$kind"
                params={{ kind: "movies" }}
                aria-current={!kindIsAll && !kindIsTv ? "page" : undefined}
              >
                Movies
              </Link>
              <Link
                to="/library/$kind"
                params={{ kind: "tv" }}
                aria-current={kindIsTv ? "page" : undefined}
              >
                TV shows
              </Link>
            </nav>
          )}

          <Select
            aria-label="Sort order"
            selectedKey={sort}
            onSelectionChange={(key) => setSort(String(key))}
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
      </header>

      {isLoading && !data && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="space-y-2.5">
              <div className="skeleton aspect-[2/1] w-full rounded-[calc(var(--radius)*1.35)]" />
              <div className="skeleton h-3.5 w-2/3 rounded" />
            </div>
          ))}
        </div>
      )}
      {isError && (
        <State
          icon={FolderOpen}
          title="Couldn't load the library"
          body="Is Plexy running on this machine?"
        />
      )}
      {data && items.length === 0 && (
        <State
          icon={FolderOpen}
          title={kindIsAll ? "No titles yet" : `No ${label.toLowerCase()} yet`}
          body="Scan a library or wait for a match pass to finish."
        />
      )}

      {items.length > 0 && (
        <div
          className={cx(
            "grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
            "transition-opacity duration-150",
            isFetching && "opacity-70",
          )}
        >
          {items.map((item) => (
            <Poster
              key={item.id}
              item={item}
              wide
              caption
              overlayTitle={false}
              className="aspect-[2/1] w-full"
            />
          ))}
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/library/$kind")({
  component: LibraryRoute,
});
