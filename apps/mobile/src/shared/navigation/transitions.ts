import type { BottomTabNavigationOptions } from "expo-router/tabs";
import type { NativeStackNavigationOptions } from "expo-router";
import { easings } from "@/shared/theme";

/**
 * One transition vocabulary for every navigator, so moving between a tab, a
 * settings page and a title page all read as the same app.
 *
 * - push: going one level deeper (title, settings page, collection).
 * - immersive: the player owns the screen and must appear instantly.
 * - tab: sibling destinations shift and fade briefly instead of hard-cutting.
 *
 * Reduced motion swaps movement for a plain fade (or nothing for tabs).
 */
export function pushTransition(
  reducedMotion: boolean,
  canvas: string,
): NativeStackNavigationOptions {
  return {
    headerShown: false,
    // Horizontal travel matches the edge back gesture and the chevron in
    // PageHeader, which the Android default (fade from bottom) does not.
    animation: reducedMotion ? "fade" : "ios_from_right",
    // Every stack paints the themed canvas behind its screens; without it a
    // nested stack flashes its default white background during transitions.
    contentStyle: { backgroundColor: canvas },
  };
}

export const immersiveTransition: NativeStackNavigationOptions = {
  animation: "none",
  gestureEnabled: false,
  contentStyle: { backgroundColor: "#000" },
};

export function tabTransition(
  reducedMotion: boolean,
): Pick<BottomTabNavigationOptions, "animation" | "transitionSpec"> {
  if (reducedMotion) return { animation: "none" };
  return {
    // A short shift (fade plus a small slide toward the tapped side) reads
    // as moving between siblings without the weight of a push.
    animation: "shift",
    transitionSpec: {
      animation: "timing",
      config: { duration: 200, easing: easings.out },
    },
  };
}
