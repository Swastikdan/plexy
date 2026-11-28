import type { LocalCatalog } from "@/core/library/catalog-api";
import type { ProgressSink } from "@/core/client/progress-queue";

export type TitleAction = "remove" | "finished" | "delete";
export type EpisodeAction = "finished" | "delete";

export async function applyTitleAction(
  api: LocalCatalog,
  progress: ProgressSink,
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

/**
 * Finish or delete one episode, or a hand-picked set of episodes. Episodes are
 * independent of their series here: only the selected files are touched.
 */
export async function applyEpisodeAction(
  api: LocalCatalog,
  progress: ProgressSink,
  itemIds: number | number[],
  action: EpisodeAction,
) {
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
  if (!ids.length) return;
  await progress.flush(api);
  for (const id of ids) {
    if (action === "delete") await api.deleteItem(id);
    else await api.watched(id, true);
    await progress.forget(id);
  }
}
