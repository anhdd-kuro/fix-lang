import React, { useCallback, useEffect, useRef, useState } from "react";
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

const PORTAL_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

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
  const popupRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0 });

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePortalPos = useCallback((): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popupWidth = popupRef.current?.offsetWidth ?? 256;
    const popupHeight = popupRef.current?.offsetHeight ?? 96;
    const belowTop = rect.bottom + PORTAL_GAP_PX;
    const aboveTop = rect.top - popupHeight - PORTAL_GAP_PX;
    const fitsBelow =
      belowTop + popupHeight <= window.innerHeight - VIEWPORT_MARGIN_PX;
    const top = fitsBelow
      ? belowTop
      : Math.max(VIEWPORT_MARGIN_PX, aboveTop);
    const maxLeft = window.innerWidth - popupWidth - VIEWPORT_MARGIN_PX;
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN_PX),
      Math.max(VIEWPORT_MARGIN_PX, maxLeft),
    );
    setPortalPos({ top, left });
  }, []);

  const openPortal = useCallback((): void => {
    clearCloseTimer();
    hoverRef.current = true;
    setPortalOpen(true);
  }, [clearCloseTimer]);

  const scheduleClosePortal = useCallback((): void => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      if (!hoverRef.current) {
        setPortalOpen(false);
      }
    }, 80);
  }, [clearCloseTimer]);

  const handleAnchorLeave = useCallback((): void => {
    hoverRef.current = false;
    scheduleClosePortal();
  }, [scheduleClosePortal]);

  const handlePopupEnter = useCallback((): void => {
    clearCloseTimer();
    hoverRef.current = true;
  }, [clearCloseTimer]);

  const handlePopupLeave = useCallback((): void => {
    hoverRef.current = false;
    scheduleClosePortal();
  }, [scheduleClosePortal]);

  useEffect(() => {
    if (!portal || !portalOpen) return;
    updatePortalPos();
    const onReposition = (): void => {
      updatePortalPos();
    };
    window.addEventListener("resize", onReposition);
    document.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      document.removeEventListener("scroll", onReposition, true);
    };
  }, [portal, portalOpen, updatePortalPos]);

  useEffect(() => {
    if (!portalOpen) return;
    updatePortalPos();
  }, [portalOpen, tooltipText, updatePortalPos]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

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
      onMouseLeave={portal ? handleAnchorLeave : undefined}
      onFocus={portal ? openPortal : undefined}
      onBlur={portal ? handleAnchorLeave : undefined}
    >
      {activator || defaultActivator}
      {portal ? (
        portalOpen &&
        createPortal(
          <div
            ref={popupRef}
            className={popupClassName}
            style={{
              position: "fixed",
              top: portalPos.top,
              left: portalPos.left,
              zIndex: 9999,
            }}
            role="tooltip"
            onMouseEnter={handlePopupEnter}
            onMouseLeave={handlePopupLeave}
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
