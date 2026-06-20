import React from "react";
import { twMerge } from "tailwind-merge";

export type ListRowProps = {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  /** Trailing slot — typically an action button (trash, chevron, etc.) */
  trailing?: React.ReactNode;
  as?: "div" | "li";
};

/**
 * Shared macOS-style ListRow primitive.
 *
 * A single row in a vertically-stacked list.
 *   height    auto (min ~28px at 13px root density)
 *   radius    0     (rows span edge-to-edge; enclosing list clips)
 *   hover     var(--color-control-hover)
 *   selected  var(--color-accent) bg with label-primary text
 *   separator hairline border-b var(--color-separator)
 *
 * Pass `as="li"` when inside a <ul>.
 */
export const ListRow: React.FC<ListRowProps> = ({
  children,
  onClick,
  selected = false,
  disabled = false,
  className,
  trailing,
  as: Tag = "div",
}) => {
  return (
    <Tag
      onClick={disabled ? undefined : onClick}
      className={twMerge(
        "flex items-center justify-between gap-2 px-2 py-1.5",
        "text-[0.846rem] leading-snug border-b border-separator/40 last:border-b-0",
        onClick && !disabled && "cursor-pointer",
        selected
          ? "bg-accent text-label-primary"
          : "text-label-primary hover:bg-control-hover",
        disabled && "opacity-40 pointer-events-none",
        className,
      )}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {trailing && (
        <div className="flex items-center shrink-0">{trailing}</div>
      )}
    </Tag>
  );
};
