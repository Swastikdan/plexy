import { useState } from "react";
import { Pressable,StyleSheet,Text,View } from "react-native";
import { IconCheck } from "./player-icons";

export function SheetItem({
  label,
  hint,
  selected,
  onPress,
  preferred,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress: () => void;
  preferred?: boolean;
}) {
  const [, setFocused] = useState(false);
  return (
    <Pressable
      focusable={true}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.sheetItem,
        selected && styles.sheetItemSelected,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[styles.sheetItemText, selected && styles.sheetItemTextSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {!!hint && (
        <Text style={[styles.sheetItemHint]} numberOfLines={1}>
          {hint}
        </Text>
      )}
      {selected ? (
        <View style={[styles.sheetCheckBadge]}>
          <IconCheck size={15} color="#000000" />
        </View>
      ) : null}
    </Pressable>
  );
}

export function SheetSection({ label }: { label: string }) {
  return (
    <View style={styles.sheetSection}>
      <Text style={styles.sheetSectionText}>{label}</Text>
    </View>
  );
}

type SheetChipOption = {
  key: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};

export function SheetChips({
  label,
  options,
}: {
  label: string;
  options: SheetChipOption[];
}) {
  return (
    <View style={styles.sheetChipsBlock}>
      <Text style={styles.sheetChipsLabel}>{label}</Text>
      <View style={styles.sheetChipsRow}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.active }}
            onPress={option.onPress}
            style={({ pressed }) => [
              styles.sheetChip,
              option.active && styles.sheetChipActive,
              pressed && { opacity: 0.72 },
            ]}
          >
            <Text
              style={[
                styles.sheetChipText,
                option.active && styles.sheetChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
sheetItemSelected: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
sheetItemText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
sheetItemTextSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
sheetItemHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "500",
    marginRight: 10,
  },
sheetCheckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
sheetSection: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 4,
  },
sheetSectionText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
sheetChipsBlock: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 10,
  },
sheetChipsLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
sheetChipsRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
  },
sheetChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
sheetChipActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
sheetChipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "600",
  },
sheetChipTextActive: {
    color: "#000000",
  }
});
