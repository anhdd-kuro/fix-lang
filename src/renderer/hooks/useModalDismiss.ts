import { useEffect, useRef, type RefObject } from "react";

/**
 * Dismisses an open modal on Escape and on a mousedown that starts outside its
 * content. Listening to mousedown (never click) keeps a text selection dragged
 * from inside the modal past its edge from closing it.
 */
export const useModalDismiss = <T extends HTMLElement>(
  isOpen: boolean,
  onDismiss: () => void,
): RefObject<T | null> => {
  const contentRef = useRef<T>(null);

  useEffect(() => {
    if (!isOpen) return;

    const dismissOnOutsideMouseDown = (event: MouseEvent) => {
      const content = contentRef.current;
      if (content && !content.contains(event.target as Node)) {
        onDismiss();
      }
    };

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("mousedown", dismissOnOutsideMouseDown);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismissOnOutsideMouseDown);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [isOpen, onDismiss]);

  return contentRef;
};
