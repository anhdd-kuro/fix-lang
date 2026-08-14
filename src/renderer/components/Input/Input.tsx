/**
 * Shared themed text control. Chrome matches Settings → General → API key:
 * `rounded` + `border-control-border` + `bg-secondary` + `p-2` + `text-sm`.
 * Focus tokens match Button (`ring-ring` + offset). `outline-none` is always
 * on so Chromium's macOS orange UA outline cannot show.
 */
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Keyboard focus ring shared by Input, Textarea, and native Select.
 * Always includes `outline-none` (UA outline is `:focus`, not `:focus-visible`).
 */
export const controlFocusClassName =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * CSS box-shadow equivalent of `controlFocusClassName` for emotion/react-select,
 * where Tailwind ring utilities cannot apply.
 */
export const controlFocusBoxShadow =
  "0 0 0 2px var(--background), 0 0 0 4px var(--ring)";

/** Settings → General → API key chrome. Callers only add layout (`w-full`, `w-24`). */
export const inputControlClassName = [
  "rounded border border-control-border bg-secondary p-2 text-sm text-foreground placeholder:text-muted-foreground",
  "disabled:cursor-not-allowed disabled:opacity-50",
  controlFocusClassName,
].join(" ");

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type={type}
      className={twMerge(inputControlClassName, className)}
    />
  ),
);

Input.displayName = "Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      {...props}
      ref={ref}
      className={twMerge(inputControlClassName, className)}
    />
  ),
);

Textarea.displayName = "Textarea";
