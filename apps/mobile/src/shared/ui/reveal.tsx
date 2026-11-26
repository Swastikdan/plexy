import React, { useState } from "react";
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { cn } from "@/shared/lib/cn";
import { motion } from "@/shared/theme";

const ENTER = FadeIn.duration(motion.duration.enter)
  .easing(Easing.bezier(...motion.easeOut))
  .reduceMotion(ReduceMotion.System);
const EXIT = FadeOut.duration(motion.duration.exit).reduceMotion(ReduceMotion.System);

/**
 * Crossfades between the phases of a page (skeleton → content, content →
 * error). Change `phase` to swap: the outgoing view leaves layout at once and
 * fades out on top while the incoming one fades in, so nothing jumps.
 *
 * The first phase renders without motion; the Screen entrance already covers
 * the page arriving, and a cached page should not blink when it mounts.
 */
export function Reveal({
  phase,
  className,
  children,
}: React.PropsWithChildren<{ phase: string; className?: string }>) {
  const [initial] = useState(phase);
  const [changed, setChanged] = useState(false);
  if (!changed && phase !== initial) setChanged(true);
  return (
    <Animated.View
      key={phase}
      entering={changed || phase !== initial ? ENTER : undefined}
      exiting={EXIT}
      className={cn("flex-1", className)}
    >
      {children}
    </Animated.View>
  );
}
