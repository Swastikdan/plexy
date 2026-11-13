import BadgeInfoIcon from "@hugeicons/core-free-icons/BadgeInfoIcon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { useColors } from "@/shared/theme";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ItemCard } from "@/core/library/catalog-api";
import { useClient } from "@/core/client/client-provider";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { Check, Film, Play, Trash2 } from "@/shared/ui/icons";
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
  const colors = useColors();
  const { api } = useClient();
  const [, setPlayFocus] = useState(false);
  const [, setDetailFocus] = useState(false);
  const [, setTrailerFocus] = useState(false);
  const [, setWatchedFocus] = useState(false);
  const [, setDeleteFocus] = useState(false);
  const action = playbackAction(
    item,
    item.kind === "series" ? api.episodes(item.id) : [],
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
          "min-h-[52px] flex-1 flex-row items-center justify-center gap-2.5 rounded-full bg-accent px-5 py-3.5",
          disabled && "opacity-40",
          "active:opacity-78",
        )}
      >
        <Play size={22} color="#ffffff" fill="#ffffff" />
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          <Text className="font-archivo-bold text-[16px] tracking-[0.2px] text-white">
            {playLabel}
          </Text>
        </View>
      </Pressable>
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
            "h-[52px] w-[52px] items-center justify-center rounded-full bg-surface border border-border",
            "active:opacity-78",
          )}
          hitSlop={10}
          disabled={busy}
          accessibilityLabel="Details"
        >
          <HugeiconsIcon icon={BadgeInfoIcon} size={28} color={colors.ink} />
        </Pressable>
      )}
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
            "h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-foreground/45 bg-foreground/12",
            "active:opacity-78",
          )}
          hitSlop={10}
          disabled={busy}
          accessibilityLabel="Watch Trailer"
        >
          <Film size={20} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
      )}
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
            isWatched ? "border-foreground bg-foreground" : "border-foreground/45 bg-foreground/12",
            "active:opacity-78",
          )}
          hitSlop={8}
          disabled={busy}
          accessibilityLabel={isWatched ? "Mark Unwatched" : "Mark Watched"}
        >
          <Check
            size={18}
            color={isWatched ? colors.canvas : colors.ink}
            strokeWidth={isWatched ? 2.6 : 2}
          />
        </Pressable>
      )}
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
            "h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-danger/50 bg-danger/15",
            "active:opacity-78",
          )}
          hitSlop={8}
          disabled={busy}
          accessibilityLabel="Delete"
        >
          <Trash2 size={18} color={colors.danger} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}
