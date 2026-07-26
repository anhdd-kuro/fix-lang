import React from "react";
import Select from "react-select";
import { normalizeForSearch } from "~/const";
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
   * Flat options, grouped options, or a mix. `filterOption` needs no change
   * for the grouped case: react-select flattens groups before filtering and
   * drops a heading whose options all filter out.
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

/**
 * Default heading for a grouped option list.
 *
 * react-select ships its own `GroupHeading`, but it is styled from
 * react-select's defaults (grey `#999`, its own font sizing) and ignores the
 * theme CSS vars every other part of this control uses, so an unstyled group
 * heading is visibly foreign in every one of the 149 bundled themes. Merged
 * *under* the caller's `components` below, so a caller supplying its own
 * `GroupHeading` still wins.
 */
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
  // An option with no searchable text at all is never filtered out. The one
  // such option is `<ModelSelect>`'s inherit row (`value: ""`, `label: ""`,
  // whose visible text comes from `t()` and so is not searchable by
  // construction) — without this it would vanish the moment a user typed
  // anything, making "use the global default" unreachable from the keyboard.
  if (!haystack) return true;
  return haystack.includes(query);
};

/**
 * Merge a caller's sub-components over the defaults this component supplies.
 *
 * The caller's entries win: `<ModelSelect>` renders a `GroupHeading` that also
 * shows a provider's fetch error, and it must not be shadowed by the plain
 * default above. Extracted so that precedence is pinned by a test rather than
 * by the order of a spread inside JSX.
 */
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
      styles={{
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
        // react-select pads groups generously and colours headings from its
        // own defaults; without these two entries a grouped list ignores the
        // theme entirely.
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
