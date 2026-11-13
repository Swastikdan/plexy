# 012 - Render the complete player drawer exit

- **Status**: TODO
- **Commit**: d8c59db
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 native TypeScript file

## Problem

At `apps/mobile/src/features/player/components/player-drawer.tsx:68-93,125`, the current code causes feedback restarts, ineffective reduced motion, or an invisible exit.

```tsx
<Modal visible={menu != null} ... />
// exit timing starts only after menu becomes null
```

## Target

Retain a renderedMenu state separate from requested menu. On non-null request set renderedMenu and animate from the current drawer value to zero. On close animate translateX to 560 over 180ms using shared easings.out, and only set renderedMenu null in a finished callback for the still-current request. Modal visibility and drawer content use renderedMenu. Reduced motion closes immediately with no translation. Stop animation on effect cleanup so a stale close cannot hide a re-opened drawer. Preserve existing opening spring configuration (damping 32, stiffness 320, mass 1), a documented existing app choice, rather than replacing it.

## Repo conventions to follow

The app uses React Native Animated with useNativeDriver for transform/opacity and useReducedMotion from @/shared/hooks/use-reduced-motion. Shared easing tokens live at apps/mobile/src/shared/theme.ts:53: easings.out is Easing.bezier(0.23, 1, 0.32, 1), easings.inOut is Easing.bezier(0.77, 0, 0.175, 1), and easings.drawer is Easing.bezier(0.32, 0.72, 0, 1). Extend these conventions; do not add a motion library. The hero already cancels superseded animations in apps/mobile/src/features/home/hooks/use-hero-transition.ts:68-72.

## Steps

1. Import easings from @/shared/theme.
2. Add renderedMenu state initialized from menu and a request revision ref.
3. Replace the effect with interruptible opening/closing branches, completion guarded by revision and finished.
4. Bind Modal visible to renderedMenu != null and use renderedMenu to select visible content during exit.
5. Return animation.stop() from the effect and keep onRequestClose calling close().

## Boundaries

- Modify only the cited component/hook for this plan.
- Do not alter player source selection, orientation, playback state or styling.
- Add no dependencies.
- If the excerpt no longer matches, re-read and report drift before adapting.

## Verification

- Mechanical: `bun run typecheck:native` and `bun run test:native` must pass.
- Feel check: Open settings, close it, re-open before exit finishes, and switch directly to episodes. The panel must stay visible through exit, never flash blank, never hide a new request from an old completion. On a physical device and in slow motion, confirm it leaves the same edge it entered. Reduced motion has immediate hide with no stray translation.
- Done when: the specified repeated-input and reduced-motion behaviors are observed on a device or emulator and mechanical checks pass.
