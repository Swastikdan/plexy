# 011 - Stop the loading loop under reduced motion

- **Status**: TODO
- **Commit**: d8c59db
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 native TypeScript file

## Problem

At `apps/mobile/src/shared/ui/loading.tsx:21-41`, the current code causes feedback restarts, ineffective reduced motion, or an invisible exit.

```tsx
if (!shouldShowLogo) return;
const loop = Animated.loop(... duration: reduceMotion ? 0 : 1150 ...);
```

## Target

Before constructing any loop, if shouldShowLogo is false or reduceMotion is true, stop the slide animation, set slide to 0, and return. When motion is allowed retain the existing 1150ms/800ms loop: long indeterminate loading motion is deliberate and exempt from ordinary UI duration budgets. Loading remains identifiable through its logo and accessibility label; do not introduce a spinner loop as a replacement.

## Repo conventions to follow

The app uses React Native Animated with useNativeDriver for transform/opacity and useReducedMotion from @/shared/hooks/use-reduced-motion. Shared easing tokens live at apps/mobile/src/shared/theme.ts:53: easings.out is Easing.bezier(0.23, 1, 0.32, 1), easings.inOut is Easing.bezier(0.77, 0, 0.175, 1), and easings.drawer is Easing.bezier(0.32, 0.72, 0, 1). Extend these conventions; do not add a motion library. The hero already cancels superseded animations in apps/mobile/src/features/home/hooks/use-hero-transition.ts:68-72.

## Steps

1. Add a guarded branch at the top of the useEffect: if (!shouldShowLogo || reduceMotion) { slide.stopAnimation(); slide.setValue(0); return; }.
2. Remove ternary zero durations inside the loop, retaining 1150 and 800.
3. Preserve the existing loop.stop() cleanup.

## Boundaries

- Modify only the cited component/hook for this plan.
- Do not alter player source selection, orientation, playback state or styling.
- Add no dependencies.
- If the excerpt no longer matches, re-read and report drift before adapting.

## Verification

- Mechanical: `bun run typecheck:native` and `bun run test:native` must pass.
- Feel check: Enable Reduce Motion on device before mounting loading, then toggle while loading is mounted. The track remains static, and no loop survives the toggle. Disable Reduce Motion and confirm the normal indeterminate motion resumes without duplicate loops.
- Done when: the specified repeated-input and reduced-motion behaviors are observed on a device or emulator and mechanical checks pass.
