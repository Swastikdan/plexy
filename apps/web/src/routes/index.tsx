import { getSignedInUser } from "../auth";
/// Home: a featured billboard followed by horizontally scrolling library rows.
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { queries } from "../queries";
import { Row } from "../components/row";
import { HomeHero } from "../components/home-hero";
import { Button } from "@heroui/react";
import { PageLoader } from "../components/page-loader";

const ROW_META: Record<string, { subtitle: string; viewAll?: "movies" | "tv" }> = {
  continue: { subtitle: "Pick up where you left off" },
  next: { subtitle: "The next episode waiting for you" },
  "recent-movies": { subtitle: "Fresh in your movie library", viewAll: "movies" },
  "recent-shows": { subtitle: "Newly added series", viewAll: "tv" },
};

function HomeRoute() {
  const navigate = useNavigate();
  const status = useQuery(queries.serverStatus());
  const { data, isLoading, isError } = useQuery(queries.home());

  useEffect(() => {
    if (status.data && !status.data.setupComplete && status.data.adminAvailable) {
      void navigate({ to: "/setup", replace: true });
    }
  }, [status.data, navigate]);

  if (status.isLoading || (status.data && !status.data.setupComplete && status.data.adminAvailable) || isLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
        <PageLoader />
      </main>
    );
  }
  if (isError) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-12 sm:px-8">
        <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
          <h2 className="font-sans text-xl font-bold text-foreground">Home failed to load</h2>
          <p className="text-sm text-muted">The server didn't answer. Is Plexy running?</p>
          <Link to="/connect">
            <Button className="mt-4">
              Choose a server
            </Button>
          </Link>
        </div>
      </main>
    );
  }
  if (!data) return null;

  const rows = data.rows;
  const empty = rows.length === 0 && !data.featured;
  const administrator = getSignedInUser()?.role === "admin";

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      {empty ? (
        <div className="mx-auto flex min-h-[64vh] max-w-lg flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface text-muted shadow-sm">
            <Plus size={28} />
          </div>
          <div>
            <h2 className="font-sans text-2xl font-bold tracking-tight text-foreground">
              {administrator ? "Your library is ready" : "No titles shared yet"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {administrator
                ? "Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress."
                : "Your administrator can share libraries, folders, or individual titles with your account."}
            </p>
          </div>
          {administrator && (
            <Link to="/add-library">
              <Button className="mt-1 h-10 px-6 text-sm font-semibold">
                Add a Library
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="staggered space-y-7 pb-6 pt-4 sm:space-y-8 sm:pt-6">
          {data.featured && <HomeHero item={data.featured} />}
          {rows.map((row) => {
            const meta = ROW_META[row.key];
            return (
              <Row
                key={row.key}
                title={row.title}
                subtitle={meta?.subtitle}
                items={row.items}
                directPlay={row.key === "continue" || row.key === "next"}
                wide={row.key === "continue" || row.key === "next"}
                action={
                  meta?.viewAll ? (
                    <Link
                      to="/library/$kind"
                      params={{ kind: meta.viewAll }}
                      className="group inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                    >
                      See all
                      <ArrowRight
                        size={13}
                        className="transition-transform duration-150 group-hover:translate-x-0.5"
                      />
                    </Link>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({ component: HomeRoute });
