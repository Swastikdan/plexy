/// Library grid (PRD 5.9, 10.2): everything in one library with sort.
import { useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../../queries";
import { Poster } from "../../components/poster";
import { cx } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { PageHeader } from "../../components/page-header";
import { State } from "../index";
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

  const label = kind === "tv" ? "TV Shows" : "Movies";

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      <PageHeader
        title={label}
        action={
          <Select.Root
            value={sort}
            onValueChange={(v) => setSort(String(v))}
            items={SORTS as unknown as readonly { value: string; label: string }[]}
          >
            <Select.Trigger aria-label="Sort order" className="h-8 min-w-36 whitespace-nowrap">
              <Select.Value />
              <Select.Icon />
            </Select.Trigger>
            <Select.Positioner>
              {SORTS.map((s) => (
                <Select.Item key={s.value} value={s.value}>
                  <Select.ItemText>{s.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Positioner>
          </Select.Root>
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
