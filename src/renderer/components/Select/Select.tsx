/** Shared themed select control. Chrome matches Settings → General → API key. */
import { forwardRef, type SelectHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";
import { controlFocusClassName } from "../Input";

export const selectControlClassName = [
  "rounded border border-control-border bg-secondary p-2 text-sm text-foreground",
  "transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  controlFocusClassName,
].join(" ");

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      {...props}
      ref={ref}
      className={twMerge(selectControlClassName, className)}
    />
  ),
);

Select.displayName = "Select";
