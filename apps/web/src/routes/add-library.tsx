import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LibraryFolderForm } from "../components/library-folder-form";
import { Button } from "../components/ui/button";

function AddLibraryRoute() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 pb-24 pt-10 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Library management</p>
          <h1 className="mt-1 font-sans text-3xl font-bold tracking-tight text-ink">Add a library</h1>
          <p className="mt-2 text-sm text-ink-muted">Choose what kind of media this library contains, then select its folders.</p>
        </div>
        <Link to="/admin" search={{ tab: "libraries" }}><Button variant="surface">Done</Button></Link>
      </div>
      <LibraryFolderForm onComplete={() => void navigate({ to: "/admin", search: { tab: "libraries" } })} />
    </main>
  );
}

export const Route = createFileRoute("/add-library")({ component: AddLibraryRoute });
