import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ItemCard } from "@/core/library/catalog-api";
import { localLibrary } from "@/core/library/local-runtime";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { Check, Film, InfoSolid, Play, Trash2 } from "@/shared/ui/icons";
import { playbackAction } from "@/features/catalog/lib/playback-action";
export interface HeroActionsProps {
  item: ItemCard;
  onOpen: () => void;
  actionLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onDetails?: () => void;
  onTrailer?: () => void;
  onToggleWatched?: () => void;
  isWatched?: boolean;
  onDelete?: () => void;
  onHeroFocus?: () => void;
  hideActions?: boolean;
}
export function HeroActions({
  item,
  onOpen,
  actionLabel,
  disabled,
  busy = false,
  onDetails,
  onTrailer,
  onToggleWatched,
  isWatched,
  onDelete,
  onHeroFocus,
  hideActions = false,
}: HeroActionsProps) {
  const [, setPlayFocus] = useState(false);
  const [, setDetailFocus] = useState(false);
  const [, setTrailerFocus] = useState(false);
  const [, setWatchedFocus] = useState(false);
  const [, setDeleteFocus] = useState(false);
  const action = playbackAction(
    item,
    item.kind === "series"
      ? localLibrary.state.records
          .filter((r) => r.card.parentId === item.id)
          .map((r) => r.card)
      : [],
  );
  const playLabel = actionLabel ?? action.label;
  return (
    <View
      className="mt-1.5 flex-row items-center gap-3"
      style={hideActions ? { display: "none" } : null}
    >
      <Pressable
        onPress={() => {
          triggerHaptic("medium");
          onOpen();
        }}
        disabled={disabled || busy}
        accessibilityState={{ disabled: disabled || busy, busy }}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel}
        onFocus={() => {
          setPlayFocus(true);
          onHeroFocus?.();
        }}
        onBlur={() => setPlayFocus(false)}
        className={cn(
          "min-h-[52px] flex-1 flex-row items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5",
          disabled && "opacity-40",
          "active:opacity-78",
        )}
      >
        <Play size={22} color={"#000"} fill={"#000"} />
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          <Text className="font-archivo-bold text-[16px] tracking-[0.2px] text-black">
            {playLabel}
          </Text>
        </View>
      </Pressable>

      {/* Details button: larger icon button */}
      {onDetails && (
        <Pressable
          onPress={() => {
            triggerHaptic("light");
            onDetails();
          }}
          onFocus={() => {
            setDetailFocus(true);
            onHeroFocus?.();
          }}
          onBlur={() => setDetailFocus(false)}
          className={cn(
            // Solid white chip with a black glyph — the same treatment as the
            // play chips on the episode tiles. Opaque fill, no ring, and no
            // translucent layer behind the icon.
            "h-[52px] w-[52px] items-center justify-center rounded-full bg-white",
            "active:opacity-78",
          )}
          hitSlop={10}
          disabled={busy}
          accessibilityLabel="Details"
        >
          <InfoSolid size={28} color="#000" />
        </Pressable>
      )}

      {/* Trailer link button: larger icon button */}
      {onTrailer && (
        <Pressable
          onPress={() => {
            triggerHaptic("light");
            onTrailer();
          }}
          onFocus={() => {
            setTrailerFocus(true);
            onHeroFocus?.();
          }}
          onBlur={() => setTrailerFocus(false)}
          className={cn(
            "h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-white/45 bg-white/12",
            "active:opacity-78",
          )}
          hitSlop={10}
          disabled={busy}
          accessibilityLabel="Watch Trailer"
        >
          <Film size={20} color="#fff" strokeWidth={2.2} />
        </Pressable>
      )}

      {/* Watched toggle button: larger icon button */}
      {onToggleWatched && (
        <Pressable
          onPress={() => {
            triggerHaptic("light");
            onToggleWatched();
          }}
          onFocus={() => {
            setWatchedFocus(true);
            onHeroFocus?.();
          }}
          onBlur={() => setWatchedFocus(false)}
          className={cn(
            "h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px]",
            isWatched ? "border-white bg-white" : "border-white/45 bg-white/12",
            "active:opacity-78",
          )}
          hitSlop={8}
          disabled={busy}
          accessibilityLabel={isWatched ? "Mark Unwatched" : "Mark Watched"}
        >
          <Check
            size={18}
            color={isWatched ? "#000000" : "#fff"}
            strokeWidth={isWatched ? 2.6 : 2}
          />
        </Pressable>
      )}

      {/* Download button for movies / single media */}
      {/* Delete series / item button */}
      {onDelete && (
        <Pressable
          onPress={() => {
            triggerHaptic("medium");
            onDelete();
          }}
          onFocus={() => {
            setDeleteFocus(true);
            onHeroFocus?.();
          }}
          onBlur={() => setDeleteFocus(false)}
          className={cn(
            "h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-[#ef4444]/50 bg-[#ef4444]/15",
            "active:opacity-78",
          )}
          hitSlop={8}
          disabled={busy}
          accessibilityLabel="Delete"
        >
          <Trash2 size={18} color="#ef4444" strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}
