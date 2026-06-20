import React, { useId } from "react";
import { twMerge } from "tailwind-merge";

export type TextAreaProps = {
  label?: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  textareaClassName?: string;
  /** Rendered above the textarea on the right (e.g. copy button) */
  headerAction?: React.ReactNode;
  /** Rendered below the textarea on the right (e.g. token count) */
  footer?: React.ReactNode;
  id?: string;
  "aria-label"?: string;
};

/**
 * Shared macOS-style TextArea primitive.
 *
 * Multi-line text area using foundation tokens.
 *   radius    6px   (rounded-[6px], matches control bezel)
 *   bg        var(--color-control)
 *   border    var(--color-separator) at 60% opacity (hairline)
 *   resize    none  (macOS native sheets don't allow user resize)
 *
 * Optional label above, optional headerAction slot (e.g. CopyButton),
 * optional footer slot (e.g. token count).
 */
export const TextArea: React.FC<TextAreaProps> = ({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled = false,
  readOnly = false,
  className,
  textareaClassName,
  headerAction,
  footer,
  id: idProp,
  "aria-label": ariaLabel,
}) => {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <div className={twMerge("flex flex-col gap-1", className)}>
      {(label || headerAction) && (
        <div className="flex items-center justify-between">
          {label && (
            <label
              htmlFor={id}
              className="text-[0.846rem] font-medium text-label-secondary"
            >
              {label}
            </label>
          )}
          {headerAction && (
            <div className="flex items-center">{headerAction}</div>
          )}
        </div>
      )}
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel ?? label}
        className={twMerge(
          "w-full flex-1 p-2 rounded-[6px] text-[0.846rem] leading-relaxed resize-none",
          "bg-control border border-separator/60",
          "text-label-primary placeholder:text-label-tertiary",
          "disabled:opacity-40 disabled:pointer-events-none",
          "focus-visible:outline-none",
          textareaClassName,
        )}
      />
      {footer && (
        <div className="flex items-center justify-end text-[0.769rem] text-label-secondary">
          {footer}
        </div>
      )}
    </div>
  );
};
