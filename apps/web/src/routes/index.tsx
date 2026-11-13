import { getSignedInUser } from "../auth";
/// Home: horizontally scrolling library rows.
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { queries } from "../queries";
import { Row } from "../components/row";
import { Button } from "@heroui/react";
import { PageLoader } from "../components/page-loader";

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

  const rows = data.rows.length > 0
    ? data.rows
    : data.featured
      ? [{ key: "featured", title: "Featured", items: [data.featured] }]
      : [];
  const empty = rows.length === 0;
  const administrator = getSignedInUser()?.role === "admin";

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      {empty ? (
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-surface border border-border text-muted">
            <Plus size={28} />
          </div>
          <h2 className="font-sans text-2xl font-bold text-foreground">{administrator ? "Your library is ready" : "No titles shared yet"}</h2>
          <p className="text-sm text-muted leading-relaxed">
            {administrator ? "Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress." : "Your administrator can share libraries, folders, or individual titles with your account."}
          </p>
          {administrator && <Link to="/add-library">
            <Button className="mt-2 h-10 px-6 text-sm font-semibold">
              Add a Library
            </Button>
          </Link>}
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
