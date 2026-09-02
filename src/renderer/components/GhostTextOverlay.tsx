/**
 * @file GhostTextOverlay.tsx
 * @description Renders the ghost-text suggestion as an absolutely-positioned
 * mirror behind the textarea: an invisible copy of the typed text (so its
 * width/wrap matches the real caret position) followed by the muted-color
 * suggestion.
 *
 * PLAIN TEXT ONLY — never `MarkdownView`, never `dangerouslySetInnerHTML`.
 * `MarkdownView.tsx`'s header explains why an Ask AI answer is untrusted
 * model output (`img` suppressed, links routed through `openExternalLink`):
 * a ghost suggestion is that same untrusted output aimed at something more
 * sensitive than a read-only result window — an input the user is about to
 * submit back to a provider. Rendering it as markdown would let an injected
 * suggestion draw links, images, or arbitrary emphasis into the user's own
 * question; rendering it as a raw string means the worst it can do is be
 * wrong text.
 *
 * SCROLL SYNC. The mirror clips at the container edge, so once the textarea
 * has scrolled, an unsynced mirror still draws the suggestion at document
 * offset zero — off-view — while the footer keeps offering "Tab to accept".
 * Tab would then insert up to 200 characters of model output the user never
 * saw into text they are about to send. The fix is to move the mirror with
 * the textarea (`scrollTop`) rather than to withhold acceptance: the caret is
 * what the browser keeps in view while typing, and the ghost is drawn at the
 * caret, so a synced mirror puts it on screen exactly when Tab is offered.
 * Withholding instead would silently disable Tab in any question long enough
 * to scroll — a feature that stops working with no explanation, which is the
 * worse failure.
 *
 * That argument rests entirely on `typed` being the text BEFORE the caret.
 * Hand it the whole question and the ghost paints after the last character
 * instead of at the caret, at which point scroll-sync guarantees nothing: a
 * long question can scroll the ghost out of view while the footer still
 * offers Tab, which is the very bug the sync was added to prevent.
 *
 * Font/padding must mirror the textarea's own classes exactly or the
 * suggestion drifts out of alignment with the real caret — that is a
 * `bun run dev` visual check, not something jsdom (no layout engine) can
 * verify. What the tests CAN pin is the wiring: a given `scrollTop` produces
 * the matching offset, and the suggestion reaches the DOM as text.
 */

export type GhostTextOverlayProps = {
  /** The text already typed, up to the caret — shown invisibly, for spacing only. */
  typed: string;
  /** The suggestion to preview, or `null` to render nothing. */
  suggestion: string | null;
  /**
   * The mirrored textarea's current `scrollTop`, in CSS pixels. Required, not
   * defaulted: a caller that forgets it would ship the clipped-ghost bug back
   * with no compile error.
   */
  scrollTop: number;
  /** Optional class for the suggestion span when the mirror sits on a tinted surface. */
  suggestionClassName?: string;
};

export const GhostTextOverlay = ({
  typed,
  suggestion,
  scrollTop,
  suggestionClassName = "text-muted-foreground",
}: GhostTextOverlayProps) => {
  if (suggestion === null || suggestion.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        data-ghost-mirror=""
        className="whitespace-pre-wrap break-words p-3 text-sm leading-relaxed"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        <span className="invisible">{typed}</span>
        <span data-ghost-suggestion="" className={suggestionClassName}>
          {suggestion}
        </span>
      </div>
    </div>
  );
};

export default GhostTextOverlay;
