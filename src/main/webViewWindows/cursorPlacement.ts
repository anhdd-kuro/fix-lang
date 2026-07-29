/**
 * @file cursorPlacement.ts
 * @description Pure geometry for placing a popup window near the cursor,
 * clamped inside the current display's work area. Generalises the clamp in
 * `correctionResultWindow.ts` (`showCorrectionResultWindow`) so it can be
 * reused for the Ask input/result windows, adding a per-window cascade offset
 * for the multi-instance Ask result window (index 0..4, one per open popup).
 *
 * Electron-free on purpose: `cursor` and `workArea` are plain data so this
 * can be unit-tested without a display and reused by any window, not just
 * ones backed by `electron.screen`.
 */

export type Point = {
  x: number;
  y: number;
}

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Matches the offset `showCorrectionResultWindow` already uses. */
export const DEFAULT_CURSOR_OFFSET = 16;

/** Per-window stagger so stacked Ask result popups don't fully overlap. */
export const CASCADE_STEP = 24;

export type ClampToWorkAreaInput = {
  cursor: Point;
  workArea: Rect;
  width: number;
  height: number;
  /** Distance from the cursor before clamping. Defaults to 16, matching correctionResultWindow. */
  offset?: number;
  /** Cascade position for the Nth simultaneously-open window (0-based). Defaults to 0 (no cascade). */
  index?: number;
}

/**
 * Positions a `width`x`height` window near `cursor`, offset by `offset` (and
 * further staggered by `index * CASCADE_STEP` for cascaded windows), then
 * clamps the result so the whole window stays inside `workArea`.
 */
export const clampToWorkArea = ({
  cursor,
  workArea,
  width,
  height,
  offset = DEFAULT_CURSOR_OFFSET,
  index = 0,
}: ClampToWorkAreaInput): Point => {
  const shift = offset + index * CASCADE_STEP;

  const x = Math.min(
    Math.max(cursor.x + shift, workArea.x),
    workArea.x + workArea.width - width,
  );
  const y = Math.min(
    Math.max(cursor.y + shift, workArea.y),
    workArea.y + workArea.height - height,
  );

  return { x, y };
};
