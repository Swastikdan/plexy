import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LibraryFolderForm } from "../components/library-folder-form";
import { Button } from "@heroui/react";
import { Page } from "../components/page";

function AddLibraryRoute() {
  const navigate = useNavigate();
  return (
    <Page>
      <div className="flex justify-end pb-4">
        <Link to="/settings" search={{ tab: "libraries" }}>
          <Button variant="secondary" className="h-9 px-3 text-[11px] font-semibold">
            Done
          </Button>
        </Link>
      </div>
      <LibraryFolderForm
        onComplete={() => void navigate({ to: "/settings", search: { tab: "libraries" } })}
      />
    </Page>
  );
}

export const Route = createFileRoute("/add-library")({ component: AddLibraryRoute });
