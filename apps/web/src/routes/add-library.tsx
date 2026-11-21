import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LibraryFolderForm } from "@/components/library-folder-form";
import { Button } from "@heroui/react";
import { Page } from "@/components/page";

function AddLibraryRoute() {
  const navigate = useNavigate();
  return (
    <Page>
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
          <div className="min-w-0">
            <h1 className="font-sans text-[1.6rem] font-extrabold leading-tight tracking-[-0.04em] text-foreground sm:text-[1.9rem]">
              Add a library
            </h1>
            <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              Choose what Plexy should scan, then point it at the folders that hold it. You can add
              more libraries later from Settings.
            </p>
          </div>
          <Link to="/settings" search={{ tab: "libraries" }}>
            <Button variant="secondary" className="h-9 px-3.5 text-[11px] font-semibold">
              Done
            </Button>
          </Link>
        </header>
        <LibraryFolderForm
          onComplete={() => void navigate({ to: "/settings", search: { tab: "libraries" } })}
        />
      </div>
    </Page>
  );
}

export const Route = createFileRoute("/add-library")({ component: AddLibraryRoute });
