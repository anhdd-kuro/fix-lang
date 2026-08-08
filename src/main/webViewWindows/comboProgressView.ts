/**
 * @file comboProgressView.ts
 * @description PURE geometry for the overlay's combo progress ring (plan O1–O5).
 * Same split as `cursorPlacement.ts` and `usage/usageChartView.ts`: this decides,
 * the asset renders. `overlay.html` is a 1074-line untestable asset, so every
 * segment angle, colour and centre glyph is settled here and the page only
 * assigns what this returns.
 *
 * Electron-free on purpose — the caller owns the single `executeJavaScript`
 * round trip per step boundary, this module owns nothing but arithmetic.
 */

export type ComboProgressState = "running" | "cancelling" | "failed";

export type ComboProgressView = {
  total: number;
  completed: number;
  current: number;
  state: ComboProgressState;
};

export type ComboProgressStyle = {
  /** CSS custom properties to set on the ring element. */
  vars: Record<string, string>;
  /** Glyph rendered in the centre of the ring. */
  digit: string;
  /**
   * O1 — whether the current segment pulses. A purely discrete ring reads as
   * *frozen* during a 10s step, re-creating the exact "is it working or hung?"
   * doubt the feature exists to remove. The segments carry progress; this
   * carries liveness. Both are required.
   */
  animate: boolean;
};

/**
 * Ring segment cap. Mirrors the 2–5 step limit enforced by combo validation
 * (D3) but does not replace it — this is the last line of defence for the
 * *drawing*. Past a handful of segments `--gap-deg` closes on `--seg-deg` and
 * the repeating-conic mask erases the ring outright, so an over-long chain
 * would render as an empty overlay: indistinguishable from hung.
 */
export const MAX_COMBO_RING_SEGMENTS = 5;

/** Gap between segments. Safe for every allowed total (smallest segment is 72deg). */
export const COMBO_RING_GAP_DEG = 6;

/**
 * O4 — the failed segment hardcodes one red rather than reading a theme var.
 * `--overlay-spinner` and `--overlay-spinner-track` already exist in all 149
 * themes; a third would mean regenerating every theme file and rerunning the
 * whole theme suite, which the plan explicitly rejects. This red only has to
 * read as "stopped" — the notification carries the actual error message.
 */
const FAILED_SEGMENT_COLOR = "#e5484d";

/** Done segments, the active segment and the digit all reuse the existing accent. */
const THEME_ACCENT = "var(--overlay-spinner)";

/** Cancelling dims the ring so the keypress visibly landed while the abort unwinds. */
const CANCELLING_RING_OPACITY = 0.45;

/**
 * Bounded-length degree literal. Every allowed total divides 360 exactly, so
 * rounding never fires today; it exists because these strings are interpolated
 * into an `executeJavaScript` payload and a raised cap must not start emitting
 * seventeen-digit floats.
 */
const degrees = (value: number): string => `${Math.round(value * 1000) / 1000}deg`;

const clampInteger = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

/** O3 — the step number alone. "2/3" is three glyphs at ~10px and unreadable. */
const centreGlyph = (state: ComboProgressState, current: number): string => {
  switch (state) {
    case "cancelling":
      return "×";
    case "failed":
      return "!";
    default:
      // An unrecognised state at runtime reads as running: a live-looking ring
      // is a better wrong answer than a false failure glyph.
      return String(current);
  }
};

/**
 * Maps combo progress onto the ring's custom properties. Values arrive from a
 * running chain and end up inside an `executeJavaScript` string, so every one
 * is clamped into a drawable range instead of trusted.
 */
export const buildComboProgressStyle = (view: ComboProgressView): ComboProgressStyle => {
  const total = clampInteger(view.total, 1, MAX_COMBO_RING_SEGMENTS);
  const current = clampInteger(view.current, 1, total);
  // Done segments sit strictly BEFORE the current one. The active overlay is
  // drawn on segment `current`, so letting `completed` reach it would pulse a
  // segment the conic gradient has already filled solid.
  const completed = clampInteger(view.completed, 0, current - 1);

  const segmentDegrees = 360 / total;
  const failed = view.state === "failed";
  const cancelling = view.state === "cancelling";
  const segmentColor = failed ? FAILED_SEGMENT_COLOR : THEME_ACCENT;

  return {
    vars: {
      "--seg-total": String(total),
      "--seg-done": String(completed),
      "--seg-deg": degrees(segmentDegrees),
      "--gap-deg": degrees(COMBO_RING_GAP_DEG),
      "--seg-active-start": degrees(segmentDegrees * (current - 1)),
      "--seg-active-end": degrees(segmentDegrees * current),
      "--seg-active-color": segmentColor,
      "--digit-color": segmentColor,
      "--ring-opacity": cancelling ? String(CANCELLING_RING_OPACITY) : "1",
    },
    digit: centreGlyph(view.state, current),
    animate: !failed && !cancelling,
  };
};
