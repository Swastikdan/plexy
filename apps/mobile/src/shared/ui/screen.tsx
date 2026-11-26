import React from "react";
import Animated, { Easing, FadeInDown, ReduceMotion } from "react-native-reanimated";
import type { Edge } from "react-native-safe-area-context";
import { cn } from "@/shared/lib/cn";
import { motion } from "@/shared/theme";
import { PageHeader } from "./page-header";
import { SafeAreaView } from "./safe-area-view";

/**
 * Content arrives with a short fade and an 8pt rise. The header is not
 * animated, so during a push it travels with the screen as a solid anchor and
 * only the body settles in. Reduced motion skips the animation entirely.
 */
const CONTENT_ENTER = FadeInDown.duration(motion.duration.enter)
  .easing(Easing.bezier(...motion.easeOut))
  .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
  .reduceMotion(ReduceMotion.System);

/** Screens pushed over the tabs own every edge. */
const PUSHED_EDGES: readonly Edge[] = ["top", "left", "right", "bottom"];
/** Tab roots leave the bottom edge to the tab bar. */
export const TAB_EDGES: readonly Edge[] = ["top", "left", "right"];

/**
 * The frame every full page shares: themed background, safe area, the
 * standard PageHeader and the content entrance. Screens hosted by a layout
 * that already applies the safe area pass `edges={[]}`.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  right,
  header,
  edges = PUSHED_EDGES,
  animated = true,
  className,
  children,
}: React.PropsWithChildren<{
  /** Renders the standard PageHeader. Omit it (or pass `header`) to own the top. */
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** A custom header in place of PageHeader. */
  header?: React.ReactNode;
  edges?: readonly Edge[];
  animated?: boolean;
  className?: string;
}>) {
  return (
    <SafeAreaView edges={edges} className={cn("flex-1 bg-background", className)}>
      {header ??
        (title !== undefined && (
          <PageHeader
            title={title}
            subtitle={subtitle}
            onBack={onBack}
            right={right}
          />
        ))}
      <ScreenContent animated={animated}>{children}</ScreenContent>
    </SafeAreaView>
  );
}

/** The content entrance alone, for screens whose frame comes from a layout. */
export function ScreenContent({
  animated = true,
  className,
  children,
}: React.PropsWithChildren<{ animated?: boolean; className?: string }>) {
  return (
    <Animated.View
      entering={animated ? CONTENT_ENTER : undefined}
      className={cn("flex-1", className)}
    >
      {children}
    </Animated.View>
  );
}
