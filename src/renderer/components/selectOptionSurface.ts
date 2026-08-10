/**
 * @file selectOptionSurface.ts
 * @description The one menu-row palette every select control in the app draws
 * from, in BOTH representations a caller can need: CSS values for
 * react-select's own `Option` (emotion, no Tailwind) and Tailwind classes for a
 * custom `Option` renderer (`ModelSelect`) or a popover that is not a
 * react-select at all (`MultiSelect`).
 *
 * Type-only imports of react-select, so a control that merely wants the hover
 * pairing does not pull the library into its window's bundle.
 */
import type { CSSObjectWithLabel, Theme } from "react-select";

export type SelectOptionState = {
  isFocused: boolean;
  isSelected: boolean;
  isDisabled?: boolean;
};

export type SelectOptionSurface = {
  className: string;
  backgroundColor: string;
  color: string;
};

/**
 * One table, because these used to be maintained apart and only `ModelSelect`
 * had one: react-select's `optionCSS` hardcodes `colors.primary25` (#DEEBFF)
 * for the focused row and merely inherits the text colour, so every select on
 * the default `Option` painted the theme's own foreground on a light blue
 * nothing in the theme chose.
 *
 * **Each background carries its own foreground token, never the ambient one.**
 * The 149 generated themes define those in pairs, and mixing them is its own
 * bug: `foreground` over `secondary` drops below 3:1 in 36 themes and is
 * *identical* in `tc-night-owl-light` (both `#403f53`), while `foreground` over
 * `primary` fails in 123. The paired tokens below clear 4.5:1 in all 149.
 */
const OPTION_SURFACES = {
  selected: {
    className: "bg-primary text-primary-foreground",
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  focused: {
    className: "bg-secondary text-secondary-foreground",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
  },
  // Transparent so the menu's own `popover` background shows through, which is
  // what makes `popover-foreground` the correct text token for a resting row.
  resting: {
    className: "bg-transparent text-popover-foreground",
    backgroundColor: "transparent",
    color: "var(--popover-foreground)",
  },
} as const;

export const selectOptionSurface = ({
  isSelected,
  isFocused,
}: SelectOptionState): SelectOptionSurface =>
  isSelected
    ? OPTION_SURFACES.selected
    : isFocused
      ? OPTION_SURFACES.focused
      : OPTION_SURFACES.resting;

/**
 * Tailwind classes for a custom `Option` renderer — the same pairing the
 * default `Option` gets from `selectOptionStyle`, so a bespoke row cannot drift
 * from the shared one.
 */
export const selectOptionClassName = (state: SelectOptionState): string =>
  state.isDisabled
    ? "bg-transparent text-muted-foreground"
    : selectOptionSurface(state).className;

/**
 * Hover pairing for an option row outside react-select (`MultiSelect`'s
 * checkbox popover), so its rows highlight like every menu row. Spelled out
 * rather than built from `OPTION_SURFACES` because Tailwind scans source text
 * and would never emit a class assembled at runtime — the tests assert the two
 * stay in step.
 */
export const selectOptionHoverClassName =
  "hover:bg-secondary hover:text-secondary-foreground";

/** react-select `styles.option`, themed. */
export const selectOptionStyle = (
  base: CSSObjectWithLabel,
  state: SelectOptionState,
): CSSObjectWithLabel => ({
  ...base,
  backgroundColor: selectOptionSurface(state).backgroundColor,
  color: state.isDisabled
    ? "var(--muted-foreground)"
    : selectOptionSurface(state).color,
  cursor: state.isDisabled ? "not-allowed" : "pointer",
  // react-select's touch affordance re-introduces its own blue (`primary50`)
  // on press, so the pressed row is themed here too.
  ":active": state.isDisabled
    ? { backgroundColor: undefined }
    : {
        backgroundColor: selectOptionSurface({ ...state, isFocused: true })
          .backgroundColor,
        color: selectOptionSurface({ ...state, isFocused: true }).color,
      },
});

/**
 * react-select's palette drives anything not covered by an explicit `styles`
 * entry (and any sub-component a caller adds later). Its blues are remapped to
 * theme vars so no unthemed highlight can come back through that path.
 */
export const withThemeColors = (base: Theme): Theme => ({
  ...base,
  colors: {
    ...base.colors,
    primary: "var(--primary)",
    primary75: "var(--secondary)",
    primary50: "var(--secondary)",
    primary25: "var(--secondary)",
    neutral0: "var(--popover)",
    danger: "var(--destructive)",
  },
});
