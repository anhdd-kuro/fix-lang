import React from "react";
import Select from "react-select";
import { normalizeForSearch } from "~/const";
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
    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
        // De-emphasized, and safe to be: it sits on `input`, where
        // `muted-foreground` clears 3:1 in 148 of the 149 themes.
        placeholder: (base) => ({
          ...base,
          color: "var(--muted-foreground)",
        }),
        // NOT muted, unlike the placeholder: this renders inside the menu, so
        // its surface is `popover` — where `muted-foreground` drops to 2.03:1 in
        // `slack-ochin` (`#9e9e9e` on `#e0e0e0`). It is also the select's only
        // feedback when a search matches nothing, so it takes the surface's
        // paired token, which clears 4.5:1 in all 149.
        noOptionsMessage: (base) => ({
          ...base,
          color: "var(--popover-foreground)",
        }),
        dropdownIndicator: (base) => ({
          ...base,
          color: "var(--muted-foreground)",
          "&:hover": {
            color: "var(--foreground)",
          },
        }),
        clearIndicator: (base) => ({
          ...base,
          color: "var(--muted-foreground)",
          "&:hover": {
            color: "var(--foreground)",
          },
        }),
        indicatorSeparator: (base) => ({
          ...base,
          backgroundColor: "var(--card-control-border)",
        }),
        control: (base) => ({
          ...base,
          backgroundColor: "var(--input)",
          borderColor: "var(--border)",
          "&:hover": {
            borderColor: "var(--ring)",
          },
          boxShadow: "none",
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
          color: "var(--foreground)",
        }),
        input: (base) => ({
          ...base,
          color: "var(--foreground)",
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
