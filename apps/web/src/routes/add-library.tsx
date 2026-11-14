import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { LibraryFolderForm } from "../components/library-folder-form";
import { Button } from "@heroui/react";

function AddLibraryRoute() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/settings"
            search={{ tab: "libraries" }}
            className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
          >
            <ArrowLeft size={13} />
            Libraries
          </Link>
          <h1 className="mt-2 font-sans text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Add media
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Pick what you are adding first. The folder step only shows the
            places that fit that media type.
          </p>
        </div>
        <Link to="/settings" search={{ tab: "libraries" }}>
          <Button variant="secondary" className="h-9 px-3 text-xs font-semibold">
            Done
          </Button>
        </Link>
      </header>
      <LibraryFolderForm
        onComplete={() => void navigate({ to: "/settings", search: { tab: "libraries" } })}
      />
    </main>
  );
}

export const Route = createFileRoute("/add-library")({ component: AddLibraryRoute });
