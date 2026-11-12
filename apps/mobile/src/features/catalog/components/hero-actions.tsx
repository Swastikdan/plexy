import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ItemCard } from "../../../core/library/catalog-api";
import { localLibrary } from "../../../core/library/local-runtime";
import { triggerHaptic } from "../../../shared/lib/haptics";
import { control, fonts } from "../../../shared/theme";
import { Check, Film, Info, Play, Trash2 } from "../../../shared/ui/icons";
import { playbackAction } from "../lib/playback-action";
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
    <View style={[styles.heroButtons, hideActions && { display: "none" }]}>
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
        style={({ pressed }) => [
          styles.heroPlayBtn,
          disabled && styles.heroBtnDisabled,
          pressed && styles.heroBtnPressed,
        ]}
      >
        <Play size={16} color={"#000"} fill={"#000"} />
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          <Text style={styles.heroPlayBtnText}>{playLabel}</Text>
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
          style={({ pressed }) => [
            styles.heroIconBtn,
            pressed && styles.heroBtnPressed,
          ]}
          hitSlop={10}
          disabled={busy}
          accessibilityLabel="Details"
        >
          <Info size={20} color="#fff" strokeWidth={2.2} />
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
          style={({ pressed }) => [
            styles.heroIconBtn,
            pressed && styles.heroBtnPressed,
          ]}
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
          style={({ pressed }) => [
            styles.heroIconBtn,
            isWatched && styles.heroIconBtnWatched,
            pressed && styles.heroBtnPressed,
          ]}
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
          style={({ pressed }) => [
            styles.heroIconBtn,
            styles.heroIconBtnDanger,
            pressed && styles.heroBtnPressed,
          ]}
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
const styles = StyleSheet.create({
  heroButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
    alignItems: "center",
  },
  heroPlayBtn: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: control.radius,
    paddingHorizontal: control.inset,
    paddingVertical: 14,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  heroPlayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: "#000000",
    letterSpacing: 0.2,
  },
  heroIconBtn: {
    width: 52,
    height: 52,
    borderRadius: control.radius,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconBtnWatched: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  heroIconBtnDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "rgba(239, 68, 68, 0.5)",
  },
  heroBtnDisabled: {
    opacity: 0.4,
  },
  heroBtnPressed: {
    opacity: 0.78,
  },
});
