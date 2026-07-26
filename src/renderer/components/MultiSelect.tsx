/**
 * @file MultiSelect.tsx
 * @description Checkbox dropdown for "pick any subset" filters. A native
 * `<select multiple>` needs modifier-clicks and cannot be themed, so this is a
 * button + popover of `Checkbox` rows instead.
 *
 * Presentational and locale-free — every string (`triggerLabel`, option labels,
 * `ariaLabel`) arrives already resolved through `t()`, matching
 * `SearchableSelect.tsx`. All selection state stays with the caller.
 */
import { useEffect, useId, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { Checkbox } from "./Checkbox";

export type MultiSelectOption = {
  value: string;
  label: string;
};

export type MultiSelectProps = {
  options: readonly MultiSelectOption[];
  /** Currently checked option values. */
  selected: readonly string[];
  /** Receives the next selection, in `options` order. */
  onChange: (values: string[]) => void;
  /** Resolved summary text for the closed trigger (e.g. "All levels"). */
  triggerLabel: string;
  /** Accessible name for the trigger and the option group. */
  ariaLabel: string;
  className?: string;
};

/** Returns `values` with `value` toggled, ordered to match `options`. */
export const toggleSelection = (
  options: readonly MultiSelectOption[],
  values: readonly string[],
  value: string,
): string[] => {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return options
    .map((option) => option.value)
    .filter((candidate) => next.has(candidate));
};

/** Dropdown of checkboxes; closes on outside pointerdown or Escape. */
export const MultiSelect = ({
  options,
  selected,
  onChange,
  triggerLabel,
  ariaLabel,
  className,
}: MultiSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      setIsOpen(false);
      // Escape must not leave focus stranded inside a removed popover.
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={twMerge("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={isOpen ? listId : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="truncate">{triggerLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="size-3 shrink-0 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {isOpen ? (
        <div
          id={listId}
          role="group"
          aria-label={ariaLabel}
          className="absolute right-0 z-20 mt-1 flex min-w-full flex-col gap-1 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          {options.map((option) => (
            <Checkbox
              key={option.value}
              checked={selected.includes(option.value)}
              onChange={() =>
                onChange(toggleSelection(options, selected, option.value))
              }
              label={option.label}
              className="w-full rounded px-1 py-0.5 whitespace-nowrap hover:bg-accent hover:text-accent-foreground"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
