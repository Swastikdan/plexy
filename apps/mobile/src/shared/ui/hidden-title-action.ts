import { hideTitle } from "@/core/content/hidden-titles";
import type { ItemCard } from "@/core/library/catalog-api";
import type { useAppDialog } from "@/shared/ui/app-dialog";

/// Hiding is the one "remove" action that both the device library and the
/// online catalog offer, and it lives outside the file system: it only adds a
/// local flag. Keep the confirmation wording identical in both sheets.
export function hiddenTitleAction(
  showDialog: ReturnType<typeof useAppDialog>,
  item: ItemCard,
  onChanged?: () => void,
  description = "It will be hidden from Home, Search and Library. You can restore it later in Settings → Hidden titles.",
) {
  return {
    text: "Remove this title",
    style: "destructive" as const,
    onPress: () =>
      showDialog(
        "Remove this title?",
        description,
        [
          {
            text: "Remove",
            style: "destructive" as const,
            onPress: () => {
              void hideTitle(item).then(() => onChanged?.());
            },
          },
        ],
      ),
  };
}
