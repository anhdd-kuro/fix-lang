# Shared Button Variants

## Goal

Replace the one-purpose `PrimaryButton` and every renderer-native button with a
shared `Button` component. Color is selected through one of five variants:
`primary`, `secondary`, `outline`, `ghost`, or `destructive`.

The migration must preserve each control's layout, semantics, keyboard behavior,
and characteristic colors across all 149 themes.

## Component API

`Button` forwards its ref to the native `<button>`, accepts all native button
attributes, defaults `type` to `button`, and defaults `variant` to `primary`.

```ts
type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}
```

The shared base owns focus-visible, disabled, transition, and reduced-motion
states. It stays layout-neutral: padding, dimensions, typography, and component-
specific positioning remain at call sites.

## Variant Contract

- `primary`: primary background and foreground with opaque theme-derived hover
  and active colors.
- `secondary`: secondary background and foreground with opaque theme-derived
  hover and active colors.
- `outline`: transparent background with inherited readable text and
  `border-current`. Inheriting the host surface's semantic text color avoids a
  single border token that cannot contrast with both light and dark surfaces in
  every theme.
- `ghost`: transparent background with inherited readable text; hover and active
  states use secondary interaction surfaces.
- `destructive`: destructive background and foreground with opaque theme-derived
  hover and active colors.

Selected tabs, toggles, and segmented controls choose their variant dynamically,
usually `primary` when selected and `ghost` or `secondary` otherwise.

## Theme Tokens

Add `--secondary-hover`, `--secondary-active`, `--destructive-hover`, and
`--destructive-active`. Derive each from that theme's own colors instead of
opacity modifiers.

Adjust `--secondary-foreground` so it reaches at least 4.5:1 on the normal,
hover, and active secondary surfaces. Preserve each theme's existing primary and
destructive hues.

## Migration

Migrate all 81 rendered button call sites:

- Primary actions use `primary`.
- Neutral filled actions use `secondary`.
- Bordered neutral controls and card-like selectors use `outline`.
- Icon, close, toolbar, link-like, and low-emphasis controls use `ghost`.
- Irreversible actions use `destructive`.
- Stateful controls select variants from their current selected/error state.

Specialized components such as `CopyButton`, `TrashButton`, `SettingTabBtn`, and
tray icon buttons remain as behavioral wrappers but render `Button` internally.
No raw renderer `<button>` remains outside the shared component.

## Testing and Visual Validation

- Unit-test all five variants, default and explicit button types, native props,
  ref forwarding, disabled behavior, caller-controlled geometry, and class
  merging.
- Assert text contrast for primary, secondary, and destructive normal, hover,
  and active states across all 149 themes.
- Assert every generated CSS file has the complete, duplicate-free token set.
- Confirm no raw renderer button remains outside `Button`.
- Render a representative matrix of all variants and normal, hover, focus,
  active, disabled, and selected states across dark, light, brand, and terminal
  themes.
- Run the canonical tests, lint, i18n check, build, bundle-external check, and
  final independent diff review.

## Non-goals

- No new size API.
- No spacing, typography, or layout redesign.
- No sixth link, success, or destructive-outline variant.
- No change to non-button theme surfaces beyond the interaction tokens required
  by these variants.
