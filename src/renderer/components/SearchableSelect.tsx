import React from "react";
import Select from "react-select";
import { normalizeForSearch } from "~/const";
import type { GroupBase, SelectComponentsConfig } from "react-select";

/** Minimum shape every searchable option must satisfy. */
export type SearchableOption = {
  value: string;
  label: string;
};

export type SearchableSelectProps<Option extends SearchableOption> = {
  options: readonly Option[];
  value: Option | null;
  onChange: (option: Option | null) => void;
  /** DOM id of the select container (react-select's `id`). */
  id?: string;
  /** DOM id of the inner text input — point `<label htmlFor>` at this. */
  inputId?: string;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  /** Text shown when the filter matches nothing. */
  noOptionsMessage?: string;
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
  return haystack.includes(query);
};

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
  noOptionsMessage = "No options found",
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
      }}
      components={components}
    />
  );
};
