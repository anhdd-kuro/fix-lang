import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

type TooltipProps = {
  tooltipText: string;
  width?: string;
  maxHeight?: string;
  activator?: ReactNode;
  className?: string;
  /** Render popup in document.body so overflow containers do not scroll. */
  portal?: boolean;
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
  portal = false,
}) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0 });

  const openPortal = useCallback((): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPortalPos({ top: rect.bottom + 8, left: rect.left });
    setPortalOpen(true);
  }, []);

  const closePortal = useCallback((): void => {
    setPortalOpen(false);
  }, []);

  const defaultActivator = (
    <div className="size-4 rounded-full bg-secondary flex items-center justify-center text-card-foreground border border-control-border">
      <span className="text-xs">?</span>
    </div>
  );

  const popupClassName = `py-2 px-4 ${width} max-w-xs bg-card border border-card-control-border rounded shadow-lg text-card-foreground h-max`;

  const popupContent = (
    <pre className="text-xs whitespace-pre-wrap break-words">{tooltipText.trim()}</pre>
  );

  return (
    <div
      ref={anchorRef}
      className={`relative group cursor-help ${className}`}
      onMouseEnter={portal ? openPortal : undefined}
      onMouseLeave={portal ? closePortal : undefined}
      onFocus={portal ? openPortal : undefined}
      onBlur={portal ? closePortal : undefined}
    >
      {activator || defaultActivator}
      {portal ? (
        portalOpen &&
        createPortal(
          <div
            className={popupClassName}
            style={{
              position: "fixed",
              top: portalPos.top,
              left: portalPos.left,
              zIndex: 9999,
            }}
            role="tooltip"
          >
            {popupContent}
          </div>,
          document.body,
        )
      ) : (
        <div
          className={`absolute left-0 mt-2 ${popupClassName} z-10 hidden group-hover:block group-focus-within:block`}
        >
          {popupContent}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
