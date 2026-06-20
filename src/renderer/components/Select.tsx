/**
 * @file Select.tsx
 * Reusable macOS-native Select primitive wrapping react-select.
 *
 * All sizing uses rem so values scale with the 13px root density set in main.css.
 * react-select customStyles are JS objects in px that do NOT rem-scale automatically —
 * every px value is converted by hand here (1rem = 13px at native density).
 *
 * Tokens:
 *   --color-control        → control / menu background
 *   --color-control-hover  → focused option background
 *   --color-separator      → control border
 *   --color-label-primary  → text, input
 *   --color-label-secondary→ placeholder
 *   --color-label-tertiary → indicator / separator
 *   --color-accent         → selected option bg + focus ring
 */

import React from "react";
import ReactSelect, {
  type GroupBase,
  type Props as ReactSelectProps,
  type StylesConfig,
} from "react-select";

// ── Sizing constants (rem at 13px root) ─────────────────────────────────────
// 26px control height → 26/13 = 2rem
export const CONTROL_HEIGHT_REM = "2rem";
// 6px border-radius  → 6/13 ≈ 0.462rem
export const MENU_BORDER_RADIUS_REM = "0.462rem";
// 2px border width   → 2/13 ≈ 0.154rem  (react-select default is 2px)
const BORDER_WIDTH_REM = "0.154rem";
// 8px horizontal padding → 8/13 ≈ 0.615rem
const H_PADDING_REM = "0.615rem";
// 4px vertical padding → 4/13 ≈ 0.307rem
const V_PADDING_REM = "0.307rem";
// 1px separator width
const SEPARATOR_WIDTH_REM = "0.077rem";

// ── Style builder ────────────────────────────────────────────────────────────

/**
 * Build a react-select StylesConfig with macOS semantic tokens and rem sizing.
 * Returned object is passed directly to `<ReactSelect styles={…} />`.
 */
export const buildSelectStyles = <
  Option = unknown,
  IsMulti extends boolean = false,
  Group extends GroupBase<Option> = GroupBase<Option>,
>(): StylesConfig<Option, IsMulti, Group> => ({
  container: () => ({
    position: "relative",
    width: "100%",
  }),

  control: (_base, state) => ({
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "space-between",
    minHeight: CONTROL_HEIGHT_REM,
    backgroundColor: "var(--color-control)",
    borderWidth: BORDER_WIDTH_REM,
    borderStyle: "solid",
    borderColor: state.isFocused
      ? "var(--color-accent)"
      : "var(--color-separator)",
    borderRadius: MENU_BORDER_RADIUS_REM,
    // Accent focus ring consistent with :focus-visible treatment in main.css
    boxShadow: state.isFocused
      ? `0 0 0 0.231rem color-mix(in srgb, var(--color-accent) 50%, transparent)`
      : "none",
    cursor: "default",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    "&:hover": {
      borderColor: state.isFocused
        ? "var(--color-accent)"
        : "var(--color-label-tertiary)",
    },
  }),

  valueContainer: (_base) => ({
    display: "flex",
    flex: "1 1 0%",
    flexWrap: "wrap",
    alignItems: "center",
    padding: `${V_PADDING_REM} ${H_PADDING_REM}`,
    overflow: "hidden",
  }),

  singleValue: (_base) => ({
    color: "var(--color-label-primary)",
    gridArea: "1 / 1 / 2 / 3",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  placeholder: (_base) => ({
    color: "var(--color-label-secondary)",
    gridArea: "1 / 1 / 2 / 3",
    marginLeft: "0",
    marginRight: "0",
  }),

  input: (_base) => ({
    color: "var(--color-label-primary)",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: "0",
    margin: "0",
  }),

  menu: (_base) => ({
    backgroundColor: "var(--color-control)",
    borderRadius: MENU_BORDER_RADIUS_REM,
    borderWidth: BORDER_WIDTH_REM,
    borderStyle: "solid",
    borderColor: "var(--color-separator)",
    marginTop: "0.154rem",
    position: "absolute",
    width: "100%",
    zIndex: 10,
    overflow: "hidden",
    // Subtle shadow for depth
    boxShadow:
      "0 0.308rem 0.923rem rgba(0, 0, 0, 0.5), 0 0.077rem 0.231rem rgba(0, 0, 0, 0.3)",
  }),

  menuList: (_base) => ({
    padding: `${V_PADDING_REM} 0`,
    maxHeight: "15.385rem", // 200px / 13 ≈ 15.385rem
    overflowY: "auto",
  }),

  option: (_base, state) => ({
    backgroundColor: state.isSelected
      ? "var(--color-accent)"
      : state.isFocused
        ? "var(--color-control-hover)"
        : "transparent",
    color: state.isSelected
      ? "var(--color-label-primary)"
      : "var(--color-label-primary)",
    padding: `${V_PADDING_REM} ${H_PADDING_REM}`,
    cursor: "default",
    "&:active": {
      backgroundColor: "var(--color-accent)",
    },
  }),

  dropdownIndicator: (_base, state) => ({
    color: state.isFocused
      ? "var(--color-label-secondary)"
      : "var(--color-label-tertiary)",
    padding: `0 ${H_PADDING_REM}`,
    display: "flex",
    alignItems: "center",
    "&:hover": {
      color: "var(--color-label-secondary)",
    },
  }),

  indicatorSeparator: (_base) => ({
    backgroundColor: "var(--color-separator)",
    width: SEPARATOR_WIDTH_REM,
    alignSelf: "stretch",
    margin: `${V_PADDING_REM} 0`,
  }),

  clearIndicator: (_base) => ({
    color: "var(--color-label-tertiary)",
    padding: `0 ${V_PADDING_REM}`,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    "&:hover": {
      color: "var(--color-label-secondary)",
    },
  }),

  noOptionsMessage: (_base) => ({
    color: "var(--color-label-secondary)",
    padding: `${V_PADDING_REM} ${H_PADDING_REM}`,
    textAlign: "center",
  }),

  loadingMessage: (_base) => ({
    color: "var(--color-label-secondary)",
    padding: `${V_PADDING_REM} ${H_PADDING_REM}`,
    textAlign: "center",
  }),
});

// ── Select primitive ─────────────────────────────────────────────────────────

export type SelectProps<
  Option = unknown,
  IsMulti extends boolean = false,
  Group extends GroupBase<Option> = GroupBase<Option>,
> = ReactSelectProps<Option, IsMulti, Group>;

/**
 * macOS-native Select primitive.
 * Drop-in replacement for `<ReactSelect>` with macOS token-based styles baked in.
 * Accepts all react-select props; callers can override `styles` to extend.
 */
export const Select = <
  Option = unknown,
  IsMulti extends boolean = false,
  Group extends GroupBase<Option> = GroupBase<Option>,
>({
  styles: styleOverrides,
  ...props
}: SelectProps<Option, IsMulti, Group>): React.ReactElement => {
  const baseStyles = buildSelectStyles<Option, IsMulti, Group>();

  // Merge caller overrides on top of base styles
  const mergedStyles: StylesConfig<Option, IsMulti, Group> = styleOverrides
    ? (Object.fromEntries(
        Object.keys({ ...baseStyles, ...styleOverrides }).map((key) => {
          const k = key as keyof StylesConfig<Option, IsMulti, Group>;
          const baseF = baseStyles[k];
          const overF = styleOverrides[k];
          if (overF && baseF) {
            // Both defined — compose: base first, override on top
            return [
              k,
              // react-select style functions are (base, state) => CSSObject
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- style fn signature varies per key; any safe here for merge
              (base: any, state: any) => (overF as any)((baseF as any)(base, state), state),
            ];
          }
          return [k, overF ?? baseF];
        }),
      ) as StylesConfig<Option, IsMulti, Group>)
    : baseStyles;

  return (
    <ReactSelect<Option, IsMulti, Group>
      {...props}
      styles={mergedStyles}
    />
  );
};
