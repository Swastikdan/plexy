import React, { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { Check, ChevronDown } from "@/shared/ui/icons";

/**
 * Collapsible season selector. The season list opens in a modal anchored
 * underneath the row, so it floats over the episode list instead of pushing
 * it down.
 */
export function SeasonPicker({
  seasons,
  value,
  onChange,
}: {
  seasons: { number: number; label: string }[];
  value: number | null;
  onChange: (season: number) => void;
}) {
  const colors = useColors();
  const { height: windowHeight } = useWindowDimensions();
  const row = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    width: number;
  } | null>(null);
  if (!seasons.length) return null;
  const active =
    seasons.find((season) => season.number === value) ?? seasons[0]!;
  const canSwitch = seasons.length > 1;

  const openMenu = () => {
    triggerHaptic("selection");
    row.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y: y + height + 6, width });
      setOpen(true);
    });
  };

  return (
    <View
      ref={row}
      className="w-full flex-row items-center justify-between"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Season selector, ${active.label}`}
        accessibilityState={{ expanded: open }}
        disabled={!canSwitch}
        onPress={() => {
          if (!canSwitch) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        hitSlop={6}
        className="flex-row items-center gap-1.5 py-1 active:opacity-65"
      >
        <Text className="font-archivo-bold text-[17px] tracking-[-0.2px] text-foreground">
          {active.label}
        </Text>
        {canSwitch && (
          <View
            style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
          >
            <ChevronDown size={20} color={colors.ink} strokeWidth={2} />
          </View>
        )}
      </Pressable>

      <Modal
        visible={open && anchor != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1"
          accessibilityLabel="Close season menu"
          onPress={() => setOpen(false)}
        >
          {anchor && (
            <View
              className="overflow-hidden rounded-2xl border border-border bg-overlay"
              style={{
                position: "absolute",
                left: anchor.x,
                top: anchor.y,
                width: anchor.width,
              }}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{
                  maxHeight: anchor
                    ? Math.max(160, windowHeight - anchor.y - 24)
                    : 320,
                }}
              >
                {seasons.map((season, index) => {
                  const selected = season.number === active.number;
                  return (
                    <Pressable
                      key={season.number}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        triggerHaptic("selection");
                        setOpen(false);
                        if (!selected) onChange(season.number);
                      }}
                      className={cn(
                        "min-h-12 flex-row items-center justify-between gap-3 px-4 py-3 active:bg-surface-hover",
                        index > 0 && "border-t border-border",
                      )}
                    >
                      <Text
                        className={cn(
                          "text-[15px]",
                          selected
                            ? "font-archivo-bold text-foreground"
                            : "font-archivo-medium text-muted",
                        )}
                      >
                        {season.label}
                      </Text>
                      {selected && (
                        <Check
                          size={18}
                          color={colors.brand}
                          strokeWidth={2.4}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
