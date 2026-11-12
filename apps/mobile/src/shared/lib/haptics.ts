import * as Haptics from "expo-haptics";
export function triggerHaptic(
  style: "light" | "medium" | "selection" = "light",
) {
  try {
    if (style === "selection") {
      void Haptics.selectionAsync();
    } else if (style === "medium") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // Graceful fallback
  }
}
