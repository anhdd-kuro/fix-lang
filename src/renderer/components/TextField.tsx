import React, { useId } from "react";
import { twMerge } from "tailwind-merge";

export type TextFieldProps = {
  label?: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "number" | "search" | "url";
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  /** Rendered after the input, inside the field row (e.g. a clear/action button) */
  suffix?: React.ReactNode;
  id?: string;
  "aria-label"?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
};

/**
 * Shared macOS-style TextField primitive.
 *
 * Single-line text input using foundation tokens.
 *   height    ~22px  (h-[1.7rem] at 13px root density, matching NSTextField)
 *   radius    6px    (matching NSTextField bezel)
 *   bg        var(--color-control)
 *   border    var(--color-separator) at 60% opacity (hairline)
 *   focus     accent-glow via :focus-visible in main.css
 *
 * Optional label rendered above in label-secondary colour.
 * Optional suffix slot for inline actions (e.g. clear button).
 */
export const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  readOnly = false,
  className,
  inputClassName,
  suffix,
  id: idProp,
  "aria-label": ariaLabel,
  autoComplete,
  autoFocus,
  onKeyDown,
}) => {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <div className={twMerge("flex flex-col gap-1", className)}>
      {label && (
        <label
          htmlFor={id}
          className="text-[0.846rem] font-medium text-label-secondary"
        >
          {label}
        </label>
      )}
      <div className="flex items-center gap-1">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={ariaLabel ?? label}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          className={twMerge(
            "flex-1 h-[1.7rem] px-2 rounded-[6px] text-[0.846rem] leading-none",
            "bg-control border border-separator/60",
            "text-label-primary placeholder:text-label-tertiary",
            "disabled:opacity-40 disabled:pointer-events-none",
            "focus-visible:outline-none",
            inputClassName,
          )}
        />
        {suffix && <div className="flex items-center">{suffix}</div>}
      </div>
    </div>
  );
};
