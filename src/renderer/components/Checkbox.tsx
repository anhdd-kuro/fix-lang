/**
 * @file Checkbox.tsx
 * @description Shared theme-aware checkbox. The native input stays in the DOM
 * (keyboard, form semantics, and tests all rely on it) but is visually hidden;
 * the visible box is a sibling `<span>` styled off `peer-checked`, so the
 * checked state uses `--primary` instead of the platform accent color.
 *
 * Presentational and locale-free — callers pass already-`t()`-resolved text,
 * matching `SearchableSelect.tsx`.
 */
import { twJoin, twMerge } from "tailwind-merge";
import type { ReactNode } from "react";

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Omit for a bare box and pass `ariaLabel` instead. */
  label?: ReactNode;
  /** Accessible name when there is no visible `label`. */
  ariaLabel?: string;
  name?: string;
  disabled?: boolean;
  /** Extra classes for the wrapping `<label>`. */
  className?: string;
};

/** Checkbox with a `--primary` checked state and a visible focus ring. */
export const Checkbox = ({
  checked,
  onChange,
  label,
  ariaLabel,
  name,
  disabled = false,
  className,
}: CheckboxProps) => (
  <label
    className={twMerge(
      "inline-flex items-center gap-2 text-sm",
      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      className,
    )}
  >
    <input
      type="checkbox"
      name={name}
      checked={checked}
      disabled={disabled}
      aria-label={label === undefined ? ariaLabel : undefined}
      onChange={(event) => onChange(event.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className={twJoin(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        "border-border bg-input text-primary-foreground",
        "peer-checked:border-primary peer-checked:bg-primary",
        "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
      )}
    >
      <svg
        viewBox="0 0 12 12"
        className={twJoin("size-3", checked ? "opacity-100" : "opacity-0")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 6.4 4.7 8.6 9.5 3.6" />
      </svg>
    </span>
    {label === undefined ? null : <span>{label}</span>}
  </label>
);
