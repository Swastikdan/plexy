/// Library grid (PRD 5.9, 10.2): everything in one library with sort.
import { useState } from "react";
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
  const apiKind: "movie" | "series" | undefined = kindIsAll ? undefined : kindIsTv ? "series" : "movie";
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.items({ kind: apiKind, sort }),
  );

  // Server-driven scan indicator: shows for every scan whatever triggered it
  // (auto-scan or a manual rescan), sharing the status cache the app polls.
  const status = useQuery(queries.serverStatus());
  const scan = status.data?.scan?.status === "running" ? status.data.scan : null;

  const label = kindIsAll ? "Library" : kindIsTv ? "TV Shows" : "Movies";
  const count = data?.items.length ?? null;

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3 pb-4">
        <nav className="segmented max-w-full overflow-x-auto" aria-label="Library">
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
            TV Shows
          </Link>
        </nav>

        {count != null && (
          <p className="ml-auto text-[11px] font-medium text-muted">
            {count.toLocaleString()} {count === 1 ? "title" : "titles"}
          </p>
        )}
        {scan && (
          <div
            data-testid="scan-indicator"
            role="status"
            className="inline-flex h-8 items-center gap-2 whitespace-nowrap text-[10px] font-medium text-muted"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-border border-t-accent"
            />
            Scanning {scan.libraryName ?? "libraries"}
          </div>
        )}
        <Select
          aria-label="Sort order"
          selectedKey={sort}
          onSelectionChange={(key) => setSort(String(key))}
          className="w-40 shrink-0"
        >
          <Select.Trigger className="h-8">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {SORTS.map((s) => (
                <ListBox.Item key={s.value} id={s.value} textValue={s.label}>
                  {s.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {isLoading && !data && (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-7 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="space-y-2.5">
              <div className="skeleton aspect-[2/3] w-full rounded-[calc(var(--radius)*1.35)]" />
              <div className="skeleton h-3.5 w-2/3 rounded" />
              <div className="skeleton h-2.5 w-1/3 rounded" />
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
      {data && data.items.length === 0 && (
        <State
          icon={FolderOpen}
          title={kindIsAll ? "No titles yet" : `No ${label.toLowerCase()} yet`}
          body="Scan a library or wait for a match pass to finish."
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div
            className={cx(
              "grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(142px,1fr))] sm:gap-x-4 sm:gap-y-6 lg:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]",
              "transition-opacity duration-150",
              isFetching && "opacity-70",
            )}
          >
            {data.items.map((item) => (
              <Poster
                key={item.id}
                item={item}
                className="aspect-[2/3] w-full"
              />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/library/$kind")({
  component: LibraryRoute,
});
