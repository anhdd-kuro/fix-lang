import React, { useEffect, useRef } from "react";
import { Spinner } from "./Spinner";

/**
 * Small spinner to indicate loading, positioned absolutely near the mouse.
 * Accessible, styled with Tailwind, pointer-events-none.
 * @param { x: number, y: number, visible: boolean }
 */
type MouseLoadingSpinnerProps = {
  visible: boolean;
};

/**
 * MouseLoadingSpinner
 * Shows a loading spinner near the mouse cursor during API calls..
 * Uses TailwindCSS for all styling except for dynamic transform (see below).
 *
 * Lint note: Dynamic position requires inline style for transform, which Tailwind cannot provide.
 * This is the only justified exception to the no-inline-style rule in this project.
 */
const MouseLoadingSpinner: React.FC<MouseLoadingSpinnerProps> = ({
  visible,
}) => {
  // Use refs to track mouse position and spinner DOM element
  const loadingSpinnerRef = useRef<HTMLDivElement>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    /**
     * Track mouse position in a ref on every event (no DOM update here).
     * The DOM transform is updated only at the animation frame rate for smoothness.
     */
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    // Use AbortController for event listener cleanup (modern, safe)
    const abortController = new AbortController();
    window.addEventListener("mousemove", handleMouseMove, {
      signal: abortController.signal,
    });

    let animationId: number;
    const update = () => {
      if (loadingSpinnerRef.current) {
        const { x, y } = mousePosRef.current;
        loadingSpinnerRef.current.style.transform = `translate(${x + 12}px, ${
          y + 6
        }px)`;
      }
      animationId = requestAnimationFrame(update);
    };
    animationId = requestAnimationFrame(update);

    return () => {
      abortController.abort(); // Clean up event listener
      cancelAnimationFrame(animationId);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      aria-label="Loading"
      className="fixed left-0 top-0 z-50 pointer-events-none will-change-transform"
      ref={loadingSpinnerRef}
      role="status"
    >
      <Spinner className="mr-3 -ml-1 size-5 text-foreground" />
    </div>
  );
};

export default MouseLoadingSpinner;
