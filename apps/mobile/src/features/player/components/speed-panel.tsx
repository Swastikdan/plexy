import { triggerHaptic } from "@/shared/lib/haptics";
import { Check, X } from "@/shared/ui/icons";
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Centered speed picker, matching Audio & Subtitles. */
export function SpeedPanel({
  visible,
  rate,
  onClose,
  onSelect,
}: {
  visible: boolean;
  rate: number;
  onClose: () => void;
  onSelect: (rate: number) => void;
}) {
  const colors = useColors();
  const close = () => { triggerHaptic("light"); onClose(); };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={["landscape"]}
    >
      <View className="flex-1 items-center justify-center bg-black/55 p-4">
        <Pressable
          className="absolute inset-0"
          accessibilityLabel="Close speed picker"
          onPress={close}
        />
        <View
          className="w-[264px] rounded-[18px] border border-foreground/10 bg-overlay p-2.5"
          style={{
            maxHeight: "100%",
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <View className="flex-row items-center justify-between pl-3">
            <Text className="text-[14px] font-bold text-foreground">Playback speed</Text>
            <Pressable onPress={close} hitSlop={4} accessibilityRole="button"
              accessibilityLabel="Close speed picker"
              className="h-12 w-12 items-center justify-center rounded-full active:bg-foreground/10">
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
          {RATES.map((value) => {
            const active = Math.abs(rate - value) < 0.001;
            return (
              <Pressable
                key={String(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => { triggerHaptic("selection"); onSelect(value); }}
                className={cn(
                  "min-h-[48px] flex-row items-center justify-between rounded-[12px] px-3.5 py-3 active:bg-foreground/10",
                  active && "bg-foreground/[0.08]",
                )}
              >
                <Text
                  className={cn(
                    "text-[15px]",
                    active
                      ? "font-bold text-foreground"
                      : "font-medium text-foreground/85",
                  )}
                >
                  {value}×
                </Text>
                {active && (
                  <Check strokeWidth={2.5} size={16} color={colors.brand} />
                )}
              </Pressable>
            );
          })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
