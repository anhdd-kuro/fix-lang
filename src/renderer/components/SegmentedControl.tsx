import React from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "./Button";

/**
 * Mutually-exclusive option picker rendered as a segmented control ("pills").
 * Shared by the dashboard time-range pills, overview token-activity modes, and
 * the language switcher so all three stay visually and behaviourally identical.
 *
 * ARIA: `role="group"` + `aria-pressed` — the established idiom in this
 * codebase for "pick one of N" controls that do not swap tab panels.
 */

export type SegmentedControlSize = "sm" | "md";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** When set, forwarded to the option button's `lang` attribute. */
  lang?: string;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedControlOption<T>[];
  /** Accessible name for the `role="group"` container. */
  ariaLabel: string;
  size?: SegmentedControlSize;
  /** When true, each option grows equally to fill the container. */
  equalWidth?: boolean;
  className?: string;
};

const SIZE_CLASSES: Record<SegmentedControlSize, string> = {
  sm: "px-3 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "sm",
  equalWidth = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={twJoin(
        "flex gap-1 rounded-lg bg-background/60 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Button
            key={option.value}
            variant={isActive ? "primary" : "ghost"}
            type="button"
            lang={option.lang}
            aria-pressed={isActive}
            disabled={option.disabled}
            onClick={() => {
              if (isActive) return;
              onChange(option.value);
            }}
            className={twJoin(
              "rounded-md font-medium whitespace-nowrap",
              SIZE_CLASSES[size],
              equalWidth && "flex-1",
              isActive
                ? "shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
