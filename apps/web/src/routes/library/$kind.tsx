/// Library grid (PRD 5.9, 10.2): everything in one library with sort/filter.
import { useState } from "react";
import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { queries } from "../../queries";
import { Poster } from "../../components/poster";
import { Button, cx } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
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
  const [unwatched, setUnwatched] = useState(false);
  const status = useQuery(queries.serverStatus());

  const apiKind: "movie" | "series" = kind === "tv" ? "series" : "movie";
  const { data, isLoading, isFetching, isError } = useQuery(
    queries.items({ kind: apiKind, sort, unwatched }),
  );

  const label = kind === "tv" ? "TV Shows" : "Movies";

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 pb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight">{label}</h1>
        <div className="flex items-center gap-3">
          {status.data?.adminAvailable && (
            <Button
              variant="ghost"
              render={<Link to="/admin" search={{ tab: "review" }} />}
              className="h-8 px-3 text-[13px]"
              title="Search all titles and remap wrong matches"
            >
              <Wrench size={14} />
              Fix matches
            </Button>
          )}
          <Button
            variant={unwatched ? "primary" : "ghost"}
            onClick={() => setUnwatched((v) => !v)}
            aria-pressed={unwatched}
            className="h-8 px-3 text-[13px]"
          >
            Unwatched only
          </Button>
          <Select.Root
            value={sort}
            onValueChange={(v) => setSort(String(v))}
            items={SORTS as unknown as readonly { value: string; label: string }[]}
          >
            <Select.Trigger aria-label="Sort order" className="min-w-36">
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
        </div>
      </div>

      {isLoading && !data && <PageLoader className="min-h-[55vh]" />}
      {isError && <State title="Couldn't load the library" body="Is Plexy running on this machine?" />}
      {data && data.items.length === 0 &&
        <State title={`No ${label.toLowerCase()} yet`} body="Scan a library or wait for a match pass to finish." />}

      {data && data.items.length > 0 && (
        <div
          className={cx(
            "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-x-4 sm:gap-y-6 transition-opacity duration-150",
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
