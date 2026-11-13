# 010 - Keep player feedback stable during repeated input

- **Status**: TODO
- **Commit**: d8c59db
- **Severity**: HIGH
- **Category**: Interruptibility
- **Estimated scope**: 1 native TypeScript file

## Problem

At `apps/mobile/src/features/player/hooks/use-player-gestures.ts:72-98`, the current code causes feedback restarts, ineffective reduced motion, or an invisible exit.

```tsx
toastOpacity.setValue(0);
 toastScale.setValue(0.88);
```

## Target

Animate visibility rather than label text. Use `const toastVisible = fitToast != null` as the effect dependency. Do not reset animated values on each message. Start scale at 0.95; retarget opacity to toastVisible ? 1 : 0 and scale to reduceMotion ? 1 : toastVisible ? 1 : 0.95, using native-driver timing and shared easings.out. Enter duration 160ms; exit duration 120ms. Store the parallel animation, start it, and return cleanup calling stop(). Keep the last visible label while opacity exits if necessary. All text updates inside a seek burst must remain immediately readable.

## Repo conventions to follow

The app uses React Native Animated with useNativeDriver for transform/opacity and useReducedMotion from @/shared/hooks/use-reduced-motion. Shared easing tokens live at apps/mobile/src/shared/theme.ts:53: easings.out is Easing.bezier(0.23, 1, 0.32, 1), easings.inOut is Easing.bezier(0.77, 0, 0.175, 1), and easings.drawer is Easing.bezier(0.32, 0.72, 0, 1). Extend these conventions; do not add a motion library. The hero already cancels superseded animations in apps/mobile/src/features/home/hooks/use-hero-transition.ts:68-72.

## Steps

1. Import easings from @/shared/theme and remove local Easing usage when no other consumer needs it.
2. Initialize toastScale at 0.95 and derive toastVisible from fitToast.
3. Replace the reset-and-restart effect with retargeted Animated.parallel timing using the values above. Depend on visibility, reduceMotion and animated values, never the message string.
4. Keep timer cancellation and gesture cleanup intact.

## Boundaries

- Modify only the cited component/hook for this plan.
- Do not alter player source selection, orientation, playback state or styling.
- Add no dependencies.
- If the excerpt no longer matches, re-read and report drift before adapting.

## Verification

- Mechanical: `bun run typecheck:native` and `bun run test:native` must pass.
- Feel check: Tap repeatedly on the seek side, alternate sides, change fit mode and close the player while feedback is visible. Labels must change without disappearing or shrinking anew. Enable reduced motion: scale stays 1. At 5x slowed animation, confirm uninterrupted retargeting and a 120ms symmetric fade-out.
- Done when: the specified repeated-input and reduced-motion behaviors are observed on a device or emulator and mechanical checks pass.
