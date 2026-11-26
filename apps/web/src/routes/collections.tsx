/// Collections: create a list, add titles, and browse the result.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderHeart, Plus, Trash2, X } from "lucide-react";
import { Button, Input, Skeleton } from "@heroui/react";
import { api, type ItemCard } from "@/client";
import { queries } from "@/queries";
import { Page } from "@/components/page";
import { Poster } from "@/components/poster";
import { State } from "@/components/state";
import { ConfirmDialog } from "@/components/confirm-dialog";

function CollectionsRoute() {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery(queries.collections());
  const selected = useQuery({
    ...queries.collection(id ?? 0),
    enabled: id != null,
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
    if (id != null) await queryClient.invalidateQueries({ queryKey: ["collection", id] });
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api.createCollection(name.trim());
      setName("");
      setCreating(false);
      await refresh();
      void navigate({ to: "/collections", search: { id: result.collection.id } });
    } finally {
      setBusy(false);
    }
  };

  const collections = list.data?.collections ?? [];
  const automatic = collections.filter((collection) => collection.source === "tmdb");
  const custom = collections.filter((collection) => collection.source !== "tmdb");
  const current = selected.data;
  const items: ItemCard[] = current?.items ?? [];
  const automaticCollection = current?.collection.source === "tmdb";

  const newCollectionButton = (className = "") => (
    <Button
      type="button"
      onPress={() => setCreating((value) => !value)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-90 [&_svg]:mx-0 [&_svg]:my-0 [&_svg]:size-3.5 ${className}`}
    >
      <Plus size={14} />
      New collection
    </Button>
  );

  return (
    <Page className="pt-4 sm:pt-6">
      <header className="pb-6">
        <h1 className="font-sans text-[1.8rem] font-extrabold tracking-[-0.04em] text-foreground">
          Collections
        </h1>
        <p className="mt-1.5 max-w-2xl text-[12px] text-muted">
          Franchise collections from TMDB appear automatically. Create your own
          to group titles for a mood or a movie night.
        </p>
      </header>

      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3"
        >
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Collection name"
            aria-label="Collection name"
            fullWidth
            className="min-w-52 flex-1"
          />
          <Button
            type="submit"
            isDisabled={!name.trim() || busy}
            className="h-9 rounded-lg bg-foreground px-3 text-[11px] font-semibold text-background"
          >
            {busy ? "Creating…" : "Create"}
          </Button>
          <Button
            type="button"
            onPress={() => {
              setCreating(false);
              setName("");
            }}
            isIconOnly
            className="h-9 w-9 rounded-lg text-muted hover:bg-surface-secondary [&_svg]:mx-0 [&_svg]:my-0 [&_svg]:size-3.5"
            aria-label="Cancel"
          >
            <X size={14} />
          </Button>
        </form>
      )}

      {list.isLoading && !list.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        creating ? null : (
          <State
            icon={FolderHeart}
            title="No collections yet"
            body="Plexy groups movies from the same TMDB franchise automatically. Create a collection to group anything else."
            action={newCollectionButton()}
          />
        )
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-surface overflow-hidden">
            {automatic.length > 0 && (
              <div>
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Automatic from TMDB
                </p>
                <ul className="divide-y divide-border/60">
                  {automatic.map((collection) => (
                    <li key={collection.id}>
                      <Link
                        to="/collections"
                        search={{ id: collection.id }}
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-secondary/45"
                      >
                        <span className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-surface-secondary">
                          {collection.poster ? (
                            <img
                              src={collection.poster}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-muted">
                              <FolderHeart size={14} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-foreground">
                            {collection.name}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-muted">
                            {collection.count} {collection.count === 1 ? "title" : "titles"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {custom.length > 0 && (
              <div>
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Your collections
                </p>
                <ul className="divide-y divide-border/60">
                  {custom.map((collection) => (
                    <li key={collection.id}>
                      <Link
                        to="/collections"
                        search={{ id: collection.id }}
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-secondary/45"
                      >
                        <span className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-surface-secondary">
                          {collection.poster ? (
                            <img
                              src={collection.poster}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-muted">
                              <FolderHeart size={14} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-foreground">
                            {collection.name}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-muted">
                            {collection.count} {collection.count === 1 ? "title" : "titles"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="border-t border-border/60 p-3">
              {newCollectionButton("w-full justify-center")}
            </div>
          </aside>

          <section className="min-w-0">
            {id == null ? (
              <State
                icon={FolderHeart}
                title="Select a collection"
                body="Pick a collection on the left, or create a new one."
              />
            ) : selected.isLoading && !current ? (
              <Skeleton className="h-64 rounded-2xl" />
            ) : !current ? (
              <State title="Collection not found" body="It may have been removed." />
            ) : (
              <>
                <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="font-sans text-xl font-bold tracking-[-0.03em] text-foreground">
                      {current.collection.name}
                    </h2>
                    <p className="mt-1 text-[11.5px] text-muted">
                      {items.length} {items.length === 1 ? "title" : "titles"}
                      {automaticCollection ? " · Automatic from TMDB" : ""}
                    </p>
                  </div>
                  {!automaticCollection && (
                    <Button
                      type="button"
                      onPress={() => setConfirmDelete(true)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-transparent px-2.5 text-[10.5px] font-semibold text-muted transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger-soft-foreground [&_svg]:mx-0 [&_svg]:my-0 [&_svg]:size-3"
                    >
                      <Trash2 size={12} />
                      Delete collection
                    </Button>
                  )}
                </header>

                {items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center text-[12px] text-muted">
                    Empty collection. Open a title’s menu and choose “Add to collection”.
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-7">
                    {items.map((item) => (
                      <div key={item.id} className="group relative">
                        <Poster item={item} sizes="(min-width: 1280px) 220px, (min-width: 768px) 200px, 180px" />
                        <Button
                          type="button"
                          onPress={() => {
                            if (id == null) return;
                            void api.removeFromCollection(id, item.id).then(refresh);
                          }}
                          isIconOnly
                          aria-label={`Remove ${item.name} from collection`}
                          title="Remove from collection"
                          className="absolute right-2 top-2 h-7 w-7 rounded-full border border-white/20 bg-black/65 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/85 group-hover:opacity-100 [&_svg]:mx-0 [&_svg]:my-0 [&_svg]:size-3"
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${current?.collection.name ?? ""}”?`}
        body="Titles stay in your library."
        confirmLabel="Delete collection"
        onConfirm={() => {
          if (id == null) return;
          void api.deleteCollection(current.collection.id).then(async () => {
            await refresh();
            void navigate({ to: "/collections", search: {} });
          });
        }}
      />
    </Page>
  );
}

export const Route = createFileRoute("/collections")({
  validateSearch: (search: Record<string, unknown>): { id?: number } => {
    const value = Number(search.id);
    // Negative ids address read-only TMDB collections.
    return Number.isInteger(value) && value !== 0 ? { id: value } : {};
  },
  component: CollectionsRoute,
});
