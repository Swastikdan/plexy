/// Library grid (PRD 5.9, 10.2): everything in one library with sort/filter.
import { useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../../queries";
import { Poster, cx } from "../../components/poster";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { State } from "../index";

const SORTS = [
  { value: "name", label: "A → Z" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Release year" },
  { value: "rating", label: "Rating" },
] as const;

function LibraryRoute() {
  const { kind } = useParams({ from: Route.id });
  const [sort, setSort] = useState<string>("added");
  const [unwatched, setUnwatched] = useState(false);

  const apiKind: "movie" | "series" = kind === "tv" ? "series" : "movie";
  const { data, isLoading, isError } = useQuery(
    queries.items({ kind: apiKind, sort, unwatched }),
  );

  const label = kind === "tv" ? "TV shows" : "Movies";

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 pb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight">{label}</h1>
        <div className="flex items-center gap-3">
          <Button
            variant={unwatched ? "primary" : "ghost"}
            onClick={() => setUnwatched((v) => !v)}
            className="h-8 px-3 text-[13px]"
          >
            Unwatched only
          </Button>
          <Select.Root value={sort} onValueChange={(v) => setSort(String(v))}>
            <Select.Trigger aria-label="Sort order">
              <Select.Value />
              <Select.Icon className="text-ink-muted">▾</Select.Icon>
            </Select.Trigger>
            <Select.Positioner>
              {SORTS.map((s) => (
                <Select.Item key={s.value} value={s.value}>
                  <Select.ItemText>{s.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Positioner>
          </Select.Root>
        </div>
      </div>

      {isLoading && <GridSkeleton />}
      {isError && <State title="Couldn't load the library" body="Is Plexy running on this machine?" />}
      {data && data.items.length === 0 &&
        <State title={`No ${label.toLowerCase()} yet`} body="Scan a library or wait for a match pass to finish." />}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-4">
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

function GridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-4">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="aspect-[2/3] w-full animate-pulse rounded-[var(--radius-poster)] bg-surface" />
      ))}
    </div>
  );
}

export const Route = createFileRoute("/library/$kind")({
  component: LibraryRoute,
});
