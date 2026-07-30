/**
 * @file cursorPlacement.test.ts
 * @description Pure geometry for placing a popup window near the cursor,
 * clamped inside the current display's work area, with a per-window cascade
 * offset for the multi-instance Ask result window (cap 5, index 0..4).
 */
import { describe, expect, it } from "vitest";
import { clampToWorkArea } from "./cursorPlacement";

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 };
const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 400;
const CURSOR_OFFSET = 16;

describe("clampToWorkArea", () => {
  it("places the window at cursor + offset when there's room (top-left corner)", () => {
    const result = clampToWorkArea({
      cursor: { x: 10, y: 10 },
      workArea: WORK_AREA,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    expect(result).toEqual({
      x: 10 + CURSOR_OFFSET,
      y: 10 + CURSOR_OFFSET,
    });
  });

  it("clamps against the right edge when the cursor is near it (top-right corner)", () => {
    const result = clampToWorkArea({
      cursor: { x: 1430, y: 10 },
      workArea: WORK_AREA,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    expect(result.x).toBe(WORK_AREA.x + WORK_AREA.width - WINDOW_WIDTH);
    expect(result.y).toBe(10 + CURSOR_OFFSET);
  });

  it("clamps against the bottom edge when the cursor is near it (bottom-left corner)", () => {
    const result = clampToWorkArea({
      cursor: { x: 10, y: 890 },
      workArea: WORK_AREA,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    expect(result.x).toBe(10 + CURSOR_OFFSET);
    expect(result.y).toBe(WORK_AREA.y + WORK_AREA.height - WINDOW_HEIGHT);
  });

  it("clamps against both edges when the cursor is in the bottom-right corner", () => {
    const result = clampToWorkArea({
      cursor: { x: 1430, y: 890 },
      workArea: WORK_AREA,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    expect(result).toEqual({
      x: WORK_AREA.x + WORK_AREA.width - WINDOW_WIDTH,
      y: WORK_AREA.y + WORK_AREA.height - WINDOW_HEIGHT,
    });
  });

  it("keeps the window fully inside a work area with a nonzero origin", () => {
    const offsetWorkArea = { x: 200, y: 100, width: 1440, height: 900 };
    const result = clampToWorkArea({
      // Cursor sits left/above the work area's own origin (e.g. a secondary
      // display to the left) — offset alone would place the window outside it.
      cursor: { x: 150, y: 50 },
      workArea: offsetWorkArea,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    expect(result.x).toBe(offsetWorkArea.x);
    expect(result.y).toBe(offsetWorkArea.y);
  });

  it("cascades each subsequent window by 24px, still clamped, for index 0..4", () => {
    const positions = [0, 1, 2, 3, 4].map((index) =>
      clampToWorkArea({
        cursor: { x: 10, y: 10 },
        workArea: WORK_AREA,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        index,
      }),
    );

    expect(positions).toEqual([
      { x: 26, y: 26 },
      { x: 50, y: 50 },
      { x: 74, y: 74 },
      { x: 98, y: 98 },
      { x: 122, y: 122 },
    ]);
  });

  it("clamps a cascaded window that would otherwise spill past the work area edge", () => {
    const result = clampToWorkArea({
      cursor: { x: 1400, y: 10 },
      workArea: WORK_AREA,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      index: 4,
    });
    expect(result.x).toBe(WORK_AREA.x + WORK_AREA.width - WINDOW_WIDTH);
  });
});
