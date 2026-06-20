import React from "react";
import { twMerge } from "tailwind-merge";

export type DialogProps = {
  isOpen: boolean;
  onClose?: () => void;
  onOverlayClick?: () => void;
  /** Title shown in the header bar */
  title?: React.ReactNode;
  /** Trailing content in header (e.g. close button) — if omitted a default × button renders */
  headerTrailing?: React.ReactNode;
  children: React.ReactNode;
  /** Footer slot — typically action buttons */
  footer?: React.ReactNode;
  className?: string;
  /** Width class. Defaults to "w-3/4 max-w-[800px]" */
  widthClassName?: string;
  /** Max height class. Defaults to "max-h-[85vh]" */
  maxHeightClassName?: string;
};

/**
 * Shared macOS-style Dialog (modal sheet) primitive.
 *
 * Renders as a dark-native sheet over a semi-transparent scrim.
 *   bg        var(--color-control)   (raised surface above window bg)
 *   radius    10px (rounded-[10px])  — macOS sheet/panel radius
 *   border    var(--color-separator) at 60% opacity (subtle edge definition)
 *   scrim     black/60
 *
 * Header and footer are optional; children are the body content.
 * Pass `headerTrailing` to replace the default close button.
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  onOverlayClick,
  title,
  headerTrailing,
  children,
  footer,
  className,
  widthClassName = "w-3/4 max-w-[800px]",
  maxHeightClassName = "max-h-[85vh]",
}) => {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      if (onOverlayClick) {
        onOverlayClick();
      } else {
        onClose?.();
      }
    }
  };

  const showHeader =
    title !== undefined ||
    headerTrailing !== undefined ||
    onClose !== undefined;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={handleOverlayClick}
    >
      <div
        className={twMerge(
          "flex flex-col bg-control border border-separator/60",
          "rounded-[10px] shadow-2xl overflow-hidden",
          widthClassName,
          maxHeightClassName,
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        {showHeader && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-separator/60 shrink-0">
            {title && (
              <h2 className="text-[0.923rem] font-semibold text-label-primary">
                {title}
              </h2>
            )}
            {headerTrailing !== undefined ? (
              headerTrailing
            ) : onClose !== undefined ? (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center size-5 rounded-full text-label-secondary hover:text-label-primary hover:bg-separator/40 text-lg leading-none transition-colors"
                aria-label="Close dialog"
              >
                &times;
              </button>
            ) : null}
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-separator/60 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
