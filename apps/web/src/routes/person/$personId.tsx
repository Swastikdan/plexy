/// Person page: the cast member's photo and every title in this library they
/// appear in. Local-only — the server answers from its own catalog, so the page
/// works without internet.
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { queries } from "@/queries";
import { Page } from "@/components/page";
import { PageLoader } from "@/components/page-loader";
import { Poster } from "@/components/poster";
import { State } from "@/components/state";
import { artworkUrl } from "@/lib/artwork-url";

function PersonRoute() {
  const { personId } = useParams({ from: Route.id });
  const { data, isLoading, isError } = useQuery({
    ...queries.person(Number(personId)),
    enabled: Number.isFinite(Number(personId)),
  });

  if (isLoading) {
    return (
      <Page>
        <PageLoader className="min-h-[70vh]" label="Loading cast member" />
      </Page>
    );
  }

  if (isError || !data) {
    return (
      <Page>
        <State
          title="Person not found"
          body="This cast member is not part of your library anymore."
        />
      </Page>
    );
  }

  const { person, items } = data;

  return (
    <Page>
      <section className="relative mb-8 overflow-hidden rounded-[calc(var(--radius)*2.4)] border border-border bg-surface p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_66%)]"
        />
        <div className="relative flex items-center gap-4 sm:gap-6">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface-secondary sm:h-28 sm:w-28">
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
            <h1 className="truncate font-sans text-2xl font-extrabold tracking-[-0.04em] text-foreground sm:text-3xl">
              {person.name}
            </h1>
            <p className="mt-1.5 text-[11px] text-muted sm:text-xs">
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(142px,1fr))] sm:gap-x-4 sm:gap-y-6 lg:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
          {items.map((item) => (
            <Poster key={item.id} item={item} sizes="(min-width: 1024px) 158px, (min-width: 640px) 142px, 112px" className="aspect-[2/3] w-full" />
          ))}
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/person/$personId")({
  component: PersonRoute,
});
