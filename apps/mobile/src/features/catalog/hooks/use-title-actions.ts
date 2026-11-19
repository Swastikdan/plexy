import { useCollectionAction } from "@/features/collections/use-collection-action";
import {
  applyEpisodeAction,
  applyTitleAction,
  type EpisodeAction,
  type TitleAction,
} from "../lib/title-actions";
import { useRef } from "react";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { hiddenTitleAction } from "@/shared/ui/hidden-title-action";
import { triggerHaptic } from "@/shared/lib/haptics";

export interface TitleActionOptions {
  /** Resolves the title's next playable file. Episodes ignore this: tapping plays. */
  play?: () => void;
  /** Marks the source row as Continue Watching, adding its remove action. */
  continueWatching?: boolean;
  /** Refresh the surface that owns this card after a change. */
  onChanged?: () => void;
  /** Run instead of `onChanged` after a file is deleted. */
  onDeleted?: () => void;
  /** Offered for episodes so a long press can start multi-select. */
  onSelect?: () => void;
}

export function useTitleActions() {
  const { api, progress } = useClient();
  const showDialog = useAppDialog();
  const addToCollection = useCollectionAction();
  const working = useRef(false);
  const run = async (
    item: ItemCard,
    action: TitleAction | EpisodeAction,
    options: TitleActionOptions,
  ) => {
    if (working.current) return;
    working.current = true;
    try {
      if (item.kind === "episode" && action === "finished") {
        await applyEpisodeAction(api, progress, item.id, action);
      } else {
        await applyTitleAction(api, progress, item.id, action);
      }
      if (action === "delete")
        (options.onDeleted ?? options.onChanged)?.();
      else options.onChanged?.();
    } catch (error) {
      showDialog(
        "Could not update title",
        error instanceof Error ? error.message : String(error),
        [{ text: "Close" }],
      );
    } finally {
      working.current = false;
    }
  };
  return (item: ItemCard, options: TitleActionOptions = {}) => {
    triggerHaptic("medium");
    const isEpisode = item.kind === "episode";
    const isWatched = Boolean(item.watch?.played);
    const title =
      item.kind === "episode" && item.parentTitle
        ? `${item.parentTitle} · ${item.name}`
        : item.parentTitle || item.name;
    const toggleWatched = {
      text: isWatched ? "Mark as unwatched" : "Mark as finished",
      onPress: () =>
        void run(item, isWatched ? "remove" : "finished", options),
    };
    const remove = {
      text: "Delete from device",
      style: "destructive" as const,
      onPress: () =>
        showDialog(
          isEpisode ? "Delete episode?" : "Delete title?",
          isEpisode
            ? "This permanently deletes this episode's video file from your device."
            : "This permanently deletes the video files from your device.",
          [
            {
              text: "Delete",
              style: "destructive",
              onPress: () => void run(item, "delete", options),
            },
          ],
        ),
    };
    if (isEpisode) {
      showDialog(title, "Episode actions", [
        toggleWatched,
        ...(options.onSelect
          ? [
              {
                text: "Select episodes",
                onPress: options.onSelect,
              },
            ]
          : []),
        remove,
      ]);
      return;
    }
    showDialog(title, "Title actions", [
      ...(options.play
        ? [{ text: "Continue watching", onPress: options.play }]
        : []),
      ...(options.continueWatching
        ? [
            {
              text: "Remove from Continue Watching",
              onPress: () => void run(item, "remove", options),
            },
          ]
        : []),
      toggleWatched,
      { text: "Add to collection", onPress: () => addToCollection(item.publicId) },
      hiddenTitleAction(
        showDialog,
        item,
        options.onChanged,
        "It will be hidden from Home, Search and Library. Your video files stay on this device. You can restore it later in Settings → Hidden titles.",
      ),
      remove,
    ]);
  };
}
