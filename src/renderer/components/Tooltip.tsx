import React from "react";
import type { ReactNode } from "react";

type TooltipProps = {
  tooltipText: string;
  width?: string;
  maxHeight?: string;
  activator?: ReactNode;
  className?: string;
};

/**
 * A reusable tooltip component with customizable activator element
 * @param tooltipText - Text to display in tooltip
 * @param width - Width of tooltip (default: "w-80")
 * @param maxHeight - Maximum height of tooltip (default: no limit)
 * @param activator - Element to trigger the tooltip (default: question mark icon)
 * @param className - Additional classes for the container
 */
const Tooltip: React.FC<TooltipProps> = ({
  tooltipText,
  width = "w-80",
  activator,
  className = "",
}) => {
  // Default question mark icon if no activator provided
  const defaultActivator = (
    <div className="size-4 rounded-full bg-secondary flex items-center justify-center text-card-foreground border border-border">
      <span className="text-xs">?</span>
    </div>
  );

  return (
    <div className={`relative group cursor-help ${className}`}>
      {activator || defaultActivator}
      <div
        className={`absolute left-0 mt-2 py-2 px-4 ${width} max-w-xs bg-card border border-border rounded shadow-lg z-10 text-card-foreground hidden group-hover:block h-max`}
      >
        <pre className="text-xs whitespace-pre-wrap break-words">
          {tooltipText.trim()}
        </pre>
      </div>
    </div>
  );
};

export default Tooltip;
