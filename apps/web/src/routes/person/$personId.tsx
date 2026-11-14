/// Person page: the cast member's photo and every title in this library they
/// appear in. Local-only — the server answers from its own catalog, so the page
/// works without internet.
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { queries } from "../../queries";
import { PageLoader } from "../../components/page-loader";
import { Poster } from "../../components/poster";
import { State } from "../../components/state";
import { artworkUrl } from "../../lib/artwork-url";

function PersonRoute() {
  const { personId } = useParams({ from: Route.id });
  const { data, isLoading, isError } = useQuery({
    ...queries.person(Number(personId)),
    enabled: Number.isFinite(Number(personId)),
  });

  if (isLoading) return <PageLoader className="min-h-[70vh]" />;

  if (isError || !data) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pt-6 pb-24 sm:px-8">
        <State
          title="Person not found"
          body="This cast member is not part of your library anymore."
        />
      </main>
    );
  }

  const { person, items } = data;

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-4 pb-24 pt-8 sm:px-8">
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_68%)]"
        />
        <div className="relative flex items-center gap-4 sm:gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface-secondary sm:h-24 sm:w-24">
            {person.photo ? (
              <img
                src={artworkUrl(person.photo) ?? ""}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted">
                <UserRound size={28} />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-sans text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {person.name}
            </h2>
            <p className="mt-1 text-xs text-muted sm:text-sm">
              {items.length === 0
                ? "No titles in your library"
                : `${items.length} ${items.length === 1 ? "title" : "titles"} in your library`}
            </p>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <State
          title="Nothing here yet"
          body="None of this person's titles are in your library."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-x-3.5 sm:gap-y-5">
          {items.map((item) => (
            <Poster key={item.id} item={item} className="aspect-[2/3] w-full" />
          ))}
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/person/$personId")({
  component: PersonRoute,
});
