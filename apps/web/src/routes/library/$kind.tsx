/// Library grid (PRD 5.9, 10.2): everything in one library with sort.
import { useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../../queries";
import { Poster } from "../../components/poster";
import { ListBox, Select } from "@heroui/react";
import { cx } from "../../lib/cx";
import { PageHeader } from "../../components/page-header";
import { State } from "@/components/state";
import { PageLoader } from "../../components/page-loader";

const SORTS = [
  { value: "name", label: "Alphabetical" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
] as const;

function LibraryRoute() {
  const { kind } = useParams({ from: Route.id });
  const [sort, setSort] = useState<string>("added");

  const apiKind: "movie" | "series" = kind === "tv" ? "series" : "movie";
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.items({ kind: apiKind, sort }),
  );

  // Server-driven scan indicator: shows for every scan whatever triggered it
  // (auto-scan or a manual rescan), sharing the status cache the app polls.
  const status = useQuery(queries.serverStatus());
  const scan = status.data?.scan?.status === "running" ? status.data.scan : null;

  const label = kind === "tv" ? "TV Shows" : "Movies";

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      <PageHeader
        title={label}
        action={
          <>
            {scan && (
              <div
                data-testid="scan-indicator"
                role="status"
                className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-xs text-muted"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-muted"
                />
                Scanning {scan.libraryName ?? "libraries"}
              </div>
            )}
            <Select
              aria-label="Sort order"
              selectedKey={sort}
              onSelectionChange={(key) => setSort(String(key))}
              className="w-44 shrink-0"
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
          </>
        }
      />

      {isLoading && !data && <PageLoader className="min-h-[55vh]" />}
      {isError && <State title="Couldn't load the library" body="Is Plexy running on this machine?" />}
      {data && data.items.length === 0 &&
        <State title={`No ${label.toLowerCase()} yet`} body="Scan a library or wait for a match pass to finish." />}

      {data && data.items.length > 0 && (
        <div
          className={cx(
            "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-x-3.5 sm:gap-y-5 transition-opacity duration-150",
            isFetching && "opacity-75",
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
      )}
    </main>
  );
}

export const Route = createFileRoute("/library/$kind")({
  component: LibraryRoute,
});
