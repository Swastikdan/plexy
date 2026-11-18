import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  MoreHorizontal,
} from "@/shared/ui/icons";

/**
 * Season selector row plus a full-screen season sheet. The trigger keeps the
 * action menu on the left and the episode count beside the season name so the
 * row stays compact; the sheet owns the whole screen with an opaque background
 * so the episode list behind it never shows through.
 */
export function SeasonPicker({
  seasons,
  value,
  onChange,
  onMarkWatched,
  busy = false,
}: {
  seasons: { number: number; label: string; count?: number }[];
  value: number | null;
  onChange: (season: number) => void;
  onMarkWatched: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  if (!seasons.length) return null;
  const active =
    seasons.find((season) => season.number === value) ?? seasons[0]!;
  return (
    <View className="z-10 w-full flex-row items-center gap-3">
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Season actions"
          accessibilityState={{ expanded: menuOpen, disabled: busy }}
          disabled={busy}
          onPress={() => setMenuOpen(!menuOpen)}
          hitSlop={8}
          className="h-11 w-10 items-center justify-center rounded-full border border-border bg-surface"
        >
          <MoreHorizontal size={22} color={colors.ink} />
        </Pressable>
        {menuOpen && (
          <View
            className="absolute left-0 top-12 z-20 w-56 overflow-hidden rounded-2xl border border-border p-2"
            style={{ backgroundColor: colors.surface }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                onMarkWatched();
              }}
              className="min-h-12 flex-row items-center gap-2 rounded-xl px-3 active:bg-surface-hover"
            >
              <Check size={18} color={colors.ink} />
              <Text className="font-archivo-medium text-foreground">
                Mark as watched
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Season selector, ${active.label}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          triggerHaptic("selection");
          setMenuOpen(false);
          setOpen(true);
        }}
        hitSlop={6}
        className="min-h-11 flex-row items-center gap-2 active:opacity-65"
      >
        <Text className="font-archivo-bold text-[17px] text-foreground">
          {active.label}
        </Text>
        <Text
          accessibilityLabel={`${active.count ?? 0} episodes`}
          className="font-archivo-medium text-[15px] text-muted"
        >
          {active.count ?? "—"}
        </Text>
        <ChevronDown size={20} color={colors.ink} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View
          accessibilityViewIsModal
          className="flex-1"
          style={{ backgroundColor: colors.canvas }}
        >
          <View
            className="flex-1"
            style={{
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            }}
          >
            <View className="min-h-16 flex-row items-center gap-3 border-b border-border/60 px-5">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to episodes"
                onPress={() => setOpen(false)}
                hitSlop={12}
              >
                <ArrowLeft size={24} color={colors.ink} />
              </Pressable>
              <Text className="flex-1 font-archivo-bold text-xl text-foreground">
                Seasons
              </Text>
              <Text className="font-archivo-medium text-sm text-muted">
                {seasons.length} {seasons.length === 1 ? "season" : "seasons"}
              </Text>
            </View>
            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {seasons.map((season, index) => {
                const selected = season.number === active.number;
                return (
                  <Pressable
                    key={season.number}
                    accessibilityRole="button"
                    accessibilityLabel={`${season.label}, ${season.count ?? 0} episodes`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      triggerHaptic("selection");
                      setOpen(false);
                      if (!selected) onChange(season.number);
                    }}
                    className={cn(
                      "min-h-14 flex-row items-center gap-3 px-5 py-4 active:bg-surface-hover",
                      index > 0 && "border-t border-border/60",
                      selected && "bg-surface",
                    )}
                  >
                    <Text className="font-archivo-bold text-[16px] text-foreground">
                      {season.label}
                    </Text>
                    <Text className="font-archivo-medium text-[15px] text-muted">
                      {season.count ?? "—"}
                    </Text>
                    {selected && (
                      <View className="ml-auto">
                        <Check
                          size={19}
                          color={colors.brand}
                          strokeWidth={2.4}
                        />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
