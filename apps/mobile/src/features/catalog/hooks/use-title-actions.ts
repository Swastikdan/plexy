import { applyTitleAction, type TitleAction } from "../lib/title-actions";
import { useRef } from "react";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { triggerHaptic } from "@/shared/lib/haptics";

export function useTitleActions() {
  const { api, progress } = useClient();
  const showDialog = useAppDialog();
  const working = useRef(false);
  const run = async (item: ItemCard, action: TitleAction) => {
    if (working.current) return;
    working.current = true;
    try {
      await applyTitleAction(api, progress, item.id, action);
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
  return (item: ItemCard, play: () => void, continueWatching = false) => {
    triggerHaptic("medium");
    showDialog(item.parentTitle || item.name, "Title actions", [
      { text: "Continue watching", onPress: play },
      ...(continueWatching
        ? [
            {
              text: "Remove from Continue Watching",
              onPress: () => void run(item, "remove"),
            },
          ]
        : []),
      { text: "Mark finished", onPress: () => void run(item, "finished") },
      {
        text: "Delete from device",
        style: "destructive",
        onPress: () =>
          showDialog(
            "Delete title?",
            "This permanently deletes the video files from your device.",
            [
              {
                text: "Delete",
                style: "destructive",
                onPress: () => void run(item, "delete"),
              },
            ],
          ),
      },
    ]);
  };
}
