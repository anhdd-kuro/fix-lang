import React from "react";
import { twMerge } from "tailwind-merge";

/** macOS-style button variants */
export type ButtonVariant = "default" | "prominent" | "destructive";

export type ButtonProps = {
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
};

/**
 * Shared macOS-style Button primitive.
 *
 * Variants:
 *   default     — control-surface bg, label-primary text. Standard action.
 *   prominent   — accent bg, white text. Primary call-to-action.
 *   destructive — muted red tint on control, label-primary text. Destructive action.
 *
 * Sizing mirrors native macOS: ~22px height at 13px root (h-[1.7rem] ≈ 22px),
 * 6px radius (rounded-[6px]) matching NSButton bezel.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = "default",
  className,
  children,
  onClick,
  type = "button",
  disabled = false,
  "aria-label": ariaLabel,
  title,
}) => {
  const base =
    "inline-flex items-center justify-center gap-1.5 h-[1.7rem] px-3 rounded-[6px] text-[0.846rem] font-medium leading-none select-none transition-colors focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none";

  const variants: Record<ButtonVariant, string> = {
    default:
      "bg-control hover:bg-control-hover text-label-primary border border-separator/60",
    prominent:
      "bg-accent hover:bg-accent-hover text-white border border-transparent",
    destructive:
      "bg-[#3a1a1a] hover:bg-[#4a2020] text-label-primary border border-separator/60",
  };

  return (
    <button
      type={type}
      className={twMerge(base, variants[variant], className)}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
};

export default Button;
