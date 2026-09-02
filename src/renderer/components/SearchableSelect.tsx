import React from "react";
import Select from "react-select";
import { normalizeForSearch } from "~/const";
import { controlFocusBoxShadow } from "./Input";
import { selectOptionStyle, withThemeColors } from "./selectOptionSurface";
import type {
  GroupBase,
  GroupHeadingProps,
  SelectComponentsConfig,
} from "react-select";

/** Minimum shape every searchable option must satisfy. */
export type SearchableOption = {
  value: string;
  label: string;
};

export type SearchableSelectProps<Option extends SearchableOption> = {
  /**
   * Flat, grouped, or mixed — `filterOption` needs no group handling because
   * react-select flattens groups before filtering and hides emptied groups.
   */
  options: readonly (Option | GroupBase<Option>)[];
  value: Option | null;
  onChange: (option: Option | null) => void;
  /** DOM id of the select container (react-select's `id`). */
  id?: string;
  /** DOM id of the inner text input — point `<label htmlFor>` at this. */
  inputId?: string;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  /**
   * Text shown when the filter matches nothing. Required (no hardcoded
   * default) so every caller supplies an already-`t()`-resolved string —
   * this component has no `useI18n()` access of its own, matching the
   * locale-free presentational pattern used by `dashboardTabs.ts`.
   */
  noOptionsMessage: string;
  isDisabled?: boolean;
  /** Render the menu in a portal on document.body with fixed positioning. */
  menuPortal?: boolean;
  /** Max menu height, applied only when portalled. Defaults to 200. */
  menuMaxHeight?: number;
  /** Pin the portalled menu to this pixel width (e.g. a measured row width). */
  menuWidth?: number;
  /** Custom sub-components, e.g. a bespoke Option renderer. */
  components?: SelectComponentsConfig<Option, false, GroupBase<Option>>;
};

const DEFAULT_MENU_MAX_HEIGHT = 200;

/** Replaces react-select's own heading, which ignores the theme CSS vars. */
export const DefaultGroupHeading = <Option extends SearchableOption>({
  data,
}: GroupHeadingProps<Option, false, GroupBase<Option>>): React.ReactElement | null => {
  const label = typeof data.label === "string" ? data.label : "";
  if (label === "") return null;
  return (
    <div className="px-3 pt-2 pb-1 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
};

/**
 * Flexible match: normalize both sides (lowercase + strip every non-alphanumeric
 * char) so "gpt 5" matches "openai/gpt-5".
 */
export const matchesSearch = (
  option: { value: string; label: string },
  rawInput: string,
): boolean => {
  const query = normalizeForSearch(rawInput);
  if (!query) return true;
  const haystack = normalizeForSearch(`${option.value} ${option.label}`);
  // Never filter out an option with no searchable text: `<ModelSelect>`'s
  // inherit row is one, and would vanish the moment a user typed anything.
  if (!haystack) return true;
  return haystack.includes(query);
};

/** Caller entries win over the defaults. */
export const withDefaultComponents = <Option extends SearchableOption>(
  components?: SelectComponentsConfig<Option, false, GroupBase<Option>>,
): SelectComponentsConfig<Option, false, GroupBase<Option>> => ({
  GroupHeading: DefaultGroupHeading,
  ...components,
});

/**
 * Presentational wrapper around react-select that owns the theme CSS-var
 * styling, the normalized search filter, and portal/menu sizing. Callers keep
 * all state and may override sub-components (e.g. a custom Option renderer).
 */
export const SearchableSelect = <Option extends SearchableOption>({
  options,
  value,
  onChange,
  id,
  inputId,
  ariaLabel,
  className = "w-full",
  placeholder,
  noOptionsMessage,
  isDisabled = false,
  menuPortal = false,
  menuMaxHeight,
  menuWidth,
  components,
}: SearchableSelectProps<Option>): React.ReactElement => {
  const resolvedMaxHeight = menuMaxHeight ?? DEFAULT_MENU_MAX_HEIGHT;

  return (
    <Select<Option, false, GroupBase<Option>>
      id={id}
      inputId={inputId}
      className={className}
      aria-label={ariaLabel}
      value={value}
      onChange={(option) => onChange(option ?? null)}
      options={options}
      filterOption={(option, rawInput) => matchesSearch(option, rawInput)}
      isDisabled={isDisabled}
      placeholder={placeholder}
      noOptionsMessage={() => noOptionsMessage}
      menuPortalTarget={menuPortal ? document.body : undefined}
      menuPosition={menuPortal ? "fixed" : "absolute"}
      menuShouldScrollIntoView={false}
      maxMenuHeight={menuPortal ? resolvedMaxHeight : undefined}
      theme={withThemeColors}
      styles={{
        option: selectOptionStyle,
        // Control chrome matches Settings → General → API key (`--secondary`).
        // Text uses the paired `--secondary-foreground` (4.5:1 in all 149);
        // `foreground` on `secondary` fails that floor. See selectContrast.test.ts.
        placeholder: (base) => ({
          ...base,
          color: "var(--secondary-foreground)",
        }),
        // Renders inside the menu, so its surface is `popover`, where
        // `muted-foreground` drops to 2.02:1 (`#9e9e9e` on `#e0e0e0`). It is
        // also the select's only feedback when a search matches nothing.
        noOptionsMessage: (base) => ({
          ...base,
          color: "var(--popover-foreground)",
        }),
        // Icons, so the floor is 3:1 (WCAG 1.4.11) rather than 4.5:1 — which is
        // what lets these stay dimmer than the text beside them. Hover lifts to
        // the same token the value uses.
        dropdownIndicator: (base) => ({
          ...base,
          color: "var(--accent-foreground)",
          "&:hover": {
            color: "var(--secondary-foreground)",
          },
        }),
        clearIndicator: (base) => ({
          ...base,
          color: "var(--accent-foreground)",
          "&:hover": {
            color: "var(--secondary-foreground)",
          },
        }),
        indicatorSeparator: (base) => ({
          ...base,
          backgroundColor: "var(--card-control-border)",
        }),
        control: (base, state) => ({
          ...base,
          backgroundColor: "var(--secondary)",
          borderColor: "var(--control-border)",
          borderRadius: "0.25rem",
          outline: "none",
          boxShadow: state.isFocused ? controlFocusBoxShadow : "none",
          "&:hover": {
            borderColor: "var(--ring)",
          },
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: "var(--popover)",
          zIndex: menuPortal ? 9999 : 10,
          borderRadius: "8px",
          ...(menuPortal && menuWidth
            ? { width: menuWidth, minWidth: menuWidth }
            : {}),
        }),
        menuList: (base) => ({
          ...base,
          maxHeight: menuPortal ? resolvedMaxHeight : base.maxHeight,
          overflowY: "auto",
        }),
        singleValue: (base) => ({
          ...base,
          color: "var(--secondary-foreground)",
        }),
        input: (base) => ({
          ...base,
          color: "var(--secondary-foreground)",
          outline: "none",
          boxShadow: "none",
        }),
        group: (base) => ({
          ...base,
          paddingTop: 0,
          paddingBottom: 4,
        }),
        groupHeading: (base) => ({
          ...base,
          color: "var(--muted-foreground)",
          backgroundColor: "var(--popover)",
        }),
      }}
      components={withDefaultComponents(components)}
    />
  );
};
