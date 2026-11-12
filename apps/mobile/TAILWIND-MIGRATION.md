# Tailwind / HeroUI migration spec (mechanical conversion rules)

Goal: every component's styles become Tailwind class names (uniwind). The theme
is the HeroUI Native default dark theme (tokens ship via `@import
"heroui-native/styles"` in `apps/mobile/global.css`). The app is dark-only
(`Uniwind.setTheme("dark")` in `src/app/_layout.tsx`).

Convert `StyleSheet.create` blocks and static inline style objects to
`className`. **Do not change any logic, props, accessibility, strings, or
component APIs. Presentation only. Keep every layout value identical.**

## Helpers

- Conditional classes: `import { cn } from "<rel>/shared/lib/cn";`
  (`cn("a", cond && "b")`).
- `className` works on all React Native core components (View, Text,
  Pressable, ScrollView, FlatList, SafeAreaView, Modal, Animated.View, …) and
  on heroui-native components — uniwind compiles it.
- `shared/ui/text.tsx` `Label`/`Heading` now also accept a `className` prop.

## Color token map (old shared/theme key → class)

| old                     | class                                  |
| ----------------------- | -------------------------------------- |
| `colors.canvas`         | `background` (`bg-background`)         |
| `colors.surface`        | `bg-surface`                           |
| `colors.elevated`       | `bg-surface-secondary`                 |
| `colors.hover`          | `bg-surface-hover`                     |
| `colors.ink` (#fcfcfc)  | `text-foreground` / `bg-foreground`    |
| `colors.muted`, `quiet` | `text-muted`                           |
| `colors.line`           | `border-border`                        |
| `colors.strong`         | `bg-accent/20`                         |
| `colors.brand`          | `bg-accent` / `text-accent`            |
| `colors.brandLight`     | `text-accent`                          |
| `colors.brandDark`      | `bg-accent`                            |
| `colors.amber`          | `text-warning` / `bg-warning`          |
| `colors.danger`         | `text-danger` / `bg-danger`            |
| `#fff` / `#ffffff`      | `text-white` / `bg-white`              |
| `#000`                  | `text-black` / `bg-black`              |
| `rgba(255,255,255,.N)`  | `bg-white/N` (e.g. `.1` → `bg-white/10`) |
| `rgba(0,0,0,.N)`        | `bg-black/N`                           |

Other available dark-theme tokens (use when they clearly match the intent):
`bg-overlay`, `bg-backdrop`, `bg-surface-tertiary`, `bg-default`, `text-muted`,
`bg-segment`, `text-accent-foreground`, `bg-success`, `bg-warning`, `bg-danger`,
`border-separator`, `bg-accent-soft`.

## Fonts

- `fonts.regular` → `font-archivo-regular`
- `fonts.medium` → `font-archivo-medium`
- `fonts.bold` → `font-archivo-bold`
- `fonts.black` → `font-archivo-black`
- `fonts.mono` → **keep** as `style={{ fontFamily: fonts.mono }}` (no class).

## Values

- fontSize N → `text-[Npx]`; lineHeight N → `leading-[Npx]`;
  letterSpacing N → `tracking-[Npx]` (negative allowed).
- borderRadius 999 (control.radius) → `rounded-full`; 18 (card.radius) →
  `rounded-[18px]`; other N → `rounded-[Npx]`.
- `StyleSheet.hairlineWidth` borders → `border-b-[0.33px]` (or `-t-`, `-l-`,
  `-r-`) plus a border color class.
- exact px width/height → `w-[Npx]` / `h-[Npx]`; `flex: 1` → `flex-1`;
  numeric opacity → `opacity-40`, `opacity-85`, etc.
- gap/px values may use Tailwind spacing scale only when it equals the exact
  pixel value (4px grid: `p-5` = 20px, `gap-3` = 12px…); otherwise use
  arbitrary: `gap-[9px]`, `pt-[13px]`.

## Keep as `style` (not classes)

- Dynamic values: measured sizes, insets, animated/interpolated values
  (`useAnimatedStyle`, `Animated` transforms, shared values).
- RN-only shadow/elevation props (`shadowColor/Offset/Opacity/Radius`,
  `elevation`) — keep as a small inline object.
- Component color props that take strings: `Icon color=`, `LinearGradient
  colors=`, `StatusBar`, video tint props. Import the updated
  `{ colors }` from shared theme and use the matching key (values already
  mirror the HeroUI dark tokens).
- `contentContainerStyle` / `columnWrapperStyle` / `style` function props on
  lists: convert their values to classes only if the prop accepts class names;
  otherwise keep a plain style object (never break layout).

## Press / state styles

- Pressable `style={({ pressed }) => [...]}` → static part in `className`,
  press part via uniwind state variants on the same className:
  `active:opacity-85 active:scale-[0.97] disabled:opacity-40 focus:border-2`.
  Keep `onPress`, `onFocus`, accessibility props untouched.
- Conditional style arrays (`[styles.a, cond && styles.b]`) →
  `cn("base-classes", cond && "extra-classes")`.

## Cleanup

- Delete the `StyleSheet` block and its `StyleSheet` import when fully
  converted. A file may keep a StyleSheet **only** if it holds RN
  shadow/elevation or interpolated animated styles.
- Remove now-unused imports (`colors`, `fonts`, `StyleSheet`, `Animated`, …).
- Do not rename anything, do not reformat unrelated code, match each file's
  existing formatting quirks.
- Do NOT run typecheck, tests or builds. Do not touch files outside your
  assigned list.
