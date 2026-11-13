import type { LocalCatalog } from "@/core/library/catalog-api";
import type { ProgressQueue } from "@/core/client/progress-queue";

export type TitleAction = "remove" | "finished" | "delete";

export async function applyTitleAction(
  api: LocalCatalog,
  progress: ProgressQueue,
  itemId: number,
  action: TitleAction,
) {
  // Drain pending playback writes so a later flush cannot restore cleared progress.
  await progress.flush(api);
  const ids = new Set([
    itemId,
    ...api.episodes(itemId).map((episode) => episode.id),
  ]);
  if (action === "delete") await api.deleteItem(itemId);
  else if (action === "finished") await api.watched(itemId, true);
  else await api.clearWatch(itemId);
  for (const id of ids) await progress.forget(id);
}
