/// Home: horizontally scrolling library rows.
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { queries } from "../queries";
import { Row } from "../components/row";
import { Button } from "../components/ui/button";
import { PageLoader } from "../components/page-loader";

export default function HomeRoute() {
  const navigate = useNavigate();
  const status = useQuery(queries.serverStatus());
  const { data, isLoading, isError } = useQuery(queries.home());

  useEffect(() => {
    if (status.data && !status.data.setupComplete) {
      void navigate({ to: "/setup", replace: true });
    }
  }, [status.data, navigate]);

  if (status.isLoading || (status.data && !status.data.setupComplete) || isLoading) {
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
          <h2 className="font-sans text-xl font-bold text-ink">Home failed to load</h2>
          <p className="text-sm text-ink-muted">The server didn't answer. Is Plexy running?</p>
          <Link to="/setup">
            <Button variant="primary" className="mt-4">
              Server Setup
            </Button>
          </Link>
        </div>
      </main>
    );
  }
  if (!data) return null;

  const rows = data.rows.length > 0
    ? data.rows
    : data.featured
      ? [{ key: "featured", title: "Featured", items: [data.featured] }]
      : [];
  const empty = rows.length === 0;

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      {empty ? (
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-surface border border-line text-ink-muted">
            <Plus size={28} />
          </div>
          <h2 className="font-sans text-2xl font-bold text-ink">Your library is ready</h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress.
          </p>
          <Link to="/add-library">
            <Button variant="primary" className="mt-2 h-10 px-6 text-sm font-semibold">
              Add a Library
            </Button>
          </Link>
        </div>
      ) : (
        <div className="staggered">
          <div className="space-y-8 pt-5 sm:pt-8">
            {rows.map((row) => (
              <Row
                key={row.key}
                title={row.title}
                items={row.items}
                directPlay={row.key === "continue" || row.key === "next"}
                wide={row.key === "continue" || row.key === "next"}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({ component: HomeRoute });

export function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-sans text-xl font-bold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
      {action}
    </div>
  );
}
