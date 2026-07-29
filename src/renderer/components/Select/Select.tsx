/** Shared themed select control. */
import { forwardRef, type SelectHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export const selectControlClassName =
  "rounded-md border border-card-control-border bg-input text-foreground outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

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
