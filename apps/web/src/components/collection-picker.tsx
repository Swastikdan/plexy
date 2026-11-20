/// Add a title to one of the viewer's collections.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal } from "@heroui/react";
import { Check, FolderHeart, Plus, X } from "lucide-react";
import { api, type ItemCard } from "../client";
import { queries } from "../queries";

export function CollectionPicker({
  item,
  open,
  onOpenChange,
}: {
  item: ItemCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const collections = useQuery({ ...queries.collections(item.id), enabled: open });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
    await queryClient.invalidateQueries({ queryKey: ["collection"] });
  };

  const add = async (collectionId: number) => {
    setBusy(true);
    setError("");
    try {
      await api.addToCollection(collectionId, item.id);
      await refresh();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add to collection.");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.createCollection(name.trim());
      await api.addToCollection(result.collection.id, item.id);
      setName("");
      await refresh();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the collection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,520px)]">
            <Modal.Header className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Modal.Heading className="font-sans text-xl font-bold text-foreground">
                  Add to collection
                </Modal.Heading>
                <p className="mt-1 text-xs text-muted">{item.name}</p>
              </div>
              <Modal.CloseTrigger
                aria-label="Close"
                className="text-muted transition-colors hover:text-foreground"
              >
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="New collection name"
                  aria-label="New collection name"
                  className="flex-1"
                />
                <Button
                  type="submit"
                  isDisabled={!name.trim() || busy}
                  className="h-10 shrink-0 px-3 text-[11px] font-semibold"
                >
                  <Plus size={13} />
                  Create
                </Button>
              </form>

              <ul className="max-h-72 divide-y divide-border/60 overflow-auto rounded-xl border border-border">
                {(collections.data?.collections ?? []).map((collection) => (
                  <li key={collection.id}>
                    <button
                      type="button"
                      disabled={busy || collection.contains}
                      onClick={() => void add(collection.id)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-secondary/50 disabled:opacity-60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-secondary text-muted">
                        <FolderHeart size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-foreground">
                          {collection.name}
                        </span>
                        <span className="text-[10.5px] text-muted">
                          {collection.count} {collection.count === 1 ? "title" : "titles"}
                        </span>
                      </span>
                      {collection.contains ? (
                        <Check size={15} className="text-success-soft-foreground" />
                      ) : (
                        <Plus size={15} className="text-muted" />
                      )}
                    </button>
                  </li>
                ))}
                {!collections.isLoading && (collections.data?.collections.length ?? 0) === 0 && (
                  <li className="px-3 py-5 text-center text-[11px] text-muted">
                    No collections yet. Create the first one above.
                  </li>
                )}
              </ul>
              {error && <p role="alert" className="text-[11px] text-danger-soft-foreground">{error}</p>}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
