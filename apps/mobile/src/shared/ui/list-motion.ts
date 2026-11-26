import { Easing, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { motion } from "@/shared/theme";

/**
 * Motion for lists the user edits in place (reorder, remove, restore).
 * A removed row fades out while the rows below glide up into its place, so
 * the list never jumps. Rows already on screen at mount do not animate in.
 */
export const LIST_LAYOUT = LinearTransition.duration(motion.duration.enter)
  .easing(Easing.bezier(...motion.easeOut))
  .reduceMotion(ReduceMotion.System);

export const LIST_ITEM_EXIT = FadeOut.duration(motion.duration.exit)
  .reduceMotion(ReduceMotion.System);
