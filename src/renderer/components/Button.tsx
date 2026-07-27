import { forwardRef, type ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

const buttonVariants = {
  primary:
    "bg-primary text-primary-foreground [&:where(:enabled:hover)]:bg-primary-hover [&:where(:enabled:active)]:bg-primary-active",
  secondary:
    "bg-secondary text-secondary-foreground [&:where(:enabled:hover)]:bg-secondary-hover [&:where(:enabled:active)]:bg-secondary-active",
  outline: "border border-current bg-transparent text-inherit",
  ghost:
    "bg-transparent text-inherit [&:where(:enabled:hover)]:bg-secondary-hover [&:where(:enabled:active)]:bg-secondary-active",
  destructive:
    "bg-destructive text-destructive-foreground [&:where(:enabled:hover)]:bg-destructive-hover [&:where(:enabled:active)]:bg-destructive-active",
} as const;

const buttonBase =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 transition-colors motion-reduce:transition-none";

export type ButtonVariant = keyof typeof buttonVariants;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, type = "button", variant = "primary", ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={twMerge(buttonBase, buttonVariants[variant], className)}
    />
  ),
);

Button.displayName = "Button";
