/**
 * @file comboProgressView.test.ts
 * @description Pure geometry for the overlay's combo progress ring: segment
 * angles, per-state colours, the centre glyph, the O1 liveness flag, and the
 * clamping that keeps a chain's live counters from emitting undrawable CSS.
 */
import { describe, expect, it } from "vitest";
import {
  COMBO_RING_GAP_DEG,
  MAX_COMBO_RING_SEGMENTS,
  buildComboProgressStyle,
  type ComboProgressState,
  type ComboProgressStyle,
} from "./comboProgressView";

const THEME_ACCENT = "var(--overlay-spinner)";
const FAILED_RED = "#e5484d";

const at = (
  total: number,
  step: number,
  state: ComboProgressState = "running",
): ComboProgressStyle =>
  // How the chain reports itself: `completed` is the index, `current` is index + 1.
  buildComboProgressStyle({ total, completed: step - 1, current: step, state });

describe("buildComboProgressStyle — running geometry", () => {
  it("splits a 2-step ring into halves and marks nothing done on step 1", () => {
    expect(at(2, 1).vars).toEqual({
      "--seg-total": "2",
      "--seg-done": "0",
      "--seg-deg": "180deg",
      "--gap-deg": "6deg",
      "--seg-active-start": "0deg",
      "--seg-active-end": "180deg",
      "--seg-active-color": THEME_ACCENT,
      "--digit-color": THEME_ACCENT,
      "--ring-opacity": "1",
    });
  });

  it("advances the active window and the done count on the 2-step ring's step 2", () => {
    const { vars } = at(2, 2);
    expect(vars["--seg-done"]).toBe("1");
    expect(vars["--seg-active-start"]).toBe("180deg");
    expect(vars["--seg-active-end"]).toBe("360deg");
  });

  it("splits a 3-step ring into thirds", () => {
    expect(at(3, 1).vars["--seg-deg"]).toBe("120deg");
    expect(at(3, 2).vars["--seg-deg"]).toBe("120deg");
    expect(at(3, 3).vars["--seg-deg"]).toBe("120deg");
  });

  it("walks the 3-step ring's active segment across each position", () => {
    expect([at(3, 1), at(3, 2), at(3, 3)].map((style) => style.vars)).toMatchObject([
      { "--seg-done": "0", "--seg-active-start": "0deg", "--seg-active-end": "120deg" },
      { "--seg-done": "1", "--seg-active-start": "120deg", "--seg-active-end": "240deg" },
      { "--seg-done": "2", "--seg-active-start": "240deg", "--seg-active-end": "360deg" },
    ]);
  });

  it("keeps the gap constant and well under one segment at the 5-step cap", () => {
    const { vars } = at(MAX_COMBO_RING_SEGMENTS, 5);
    expect(vars["--seg-deg"]).toBe("72deg");
    expect(vars["--gap-deg"]).toBe(`${COMBO_RING_GAP_DEG}deg`);
    expect(vars["--seg-active-end"]).toBe("360deg");
  });
});

describe("buildComboProgressStyle — state", () => {
  it("animates only while running (O1 liveness)", () => {
    expect(at(3, 2, "running").animate).toBe(true);
    expect(at(3, 2, "cancelling").animate).toBe(false);
    expect(at(3, 2, "failed").animate).toBe(false);
  });

  it("shows the current step number while running, and the state glyph otherwise", () => {
    expect(at(3, 2, "running").digit).toBe("2");
    expect(at(3, 3, "running").digit).toBe("3");
    expect(at(3, 2, "cancelling").digit).toBe("×");
    expect(at(3, 2, "failed").digit).toBe("!");
  });

  it("dims the whole ring while cancelling, keeping the accent colour", () => {
    const { vars } = at(3, 2, "cancelling");
    expect(vars["--ring-opacity"]).toBe("0.45");
    expect(vars["--seg-active-color"]).toBe(THEME_ACCENT);
    expect(vars["--digit-color"]).toBe(THEME_ACCENT);
  });

  it("reddens the failed segment and digit without dimming (O4 — no new theme var)", () => {
    const { vars } = at(3, 2, "failed");
    expect(vars["--seg-active-color"]).toBe(FAILED_RED);
    expect(vars["--digit-color"]).toBe(FAILED_RED);
    expect(vars["--ring-opacity"]).toBe("1");
  });

  it("keeps the failed segment positioned on the step that failed", () => {
    const { vars } = at(3, 2, "failed");
    expect(vars["--seg-done"]).toBe("1");
    expect(vars["--seg-active-start"]).toBe("120deg");
    expect(vars["--seg-active-end"]).toBe("240deg");
  });
});

describe("buildComboProgressStyle — clamping", () => {
  it("draws a single-step total as one full segment", () => {
    const { vars, digit } = at(1, 1);
    expect(vars["--seg-total"]).toBe("1");
    expect(vars["--seg-deg"]).toBe("360deg");
    expect(vars["--seg-done"]).toBe("0");
    expect(vars["--seg-active-start"]).toBe("0deg");
    expect(vars["--seg-active-end"]).toBe("360deg");
    expect(digit).toBe("1");
  });

  it("lifts a zero or negative total to one segment rather than dividing by zero", () => {
    for (const total of [0, -3]) {
      const { vars } = buildComboProgressStyle({
        total,
        completed: 0,
        current: 1,
        state: "running",
      });
      expect(vars["--seg-total"]).toBe("1");
      expect(vars["--seg-deg"]).toBe("360deg");
    }
  });

  it("caps an over-long chain at the ring cap so the mask cannot erase the ring", () => {
    const { vars } = buildComboProgressStyle({
      total: 40,
      completed: 20,
      current: 21,
      state: "running",
    });
    expect(vars["--seg-total"]).toBe(String(MAX_COMBO_RING_SEGMENTS));
    expect(vars["--seg-deg"]).toBe("72deg");
    // Digit and ring stay internally consistent — no segment index past the cap.
    expect(vars["--seg-active-end"]).toBe("360deg");
  });

  it("clamps a current step past the total onto the last segment", () => {
    const { vars, digit } = buildComboProgressStyle({
      total: 3,
      completed: 2,
      current: 9,
      state: "running",
    });
    expect(vars["--seg-active-start"]).toBe("240deg");
    expect(vars["--seg-active-end"]).toBe("360deg");
    expect(digit).toBe("3");
  });

  it("lifts a zero or negative current step onto the first segment", () => {
    for (const current of [0, -1]) {
      const { vars, digit } = buildComboProgressStyle({
        total: 3,
        completed: 0,
        current,
        state: "running",
      });
      expect(vars["--seg-active-start"]).toBe("0deg");
      expect(digit).toBe("1");
    }
  });

  it("never lets completed reach the current segment, even when it exceeds the total", () => {
    const { vars } = buildComboProgressStyle({
      total: 3,
      completed: 99,
      current: 2,
      state: "running",
    });
    // Solid fill stops before the segment the animated overlay is drawn on.
    expect(vars["--seg-done"]).toBe("1");
  });

  it("floors a negative completed count to zero", () => {
    const { vars } = buildComboProgressStyle({
      total: 3,
      completed: -5,
      current: 2,
      state: "running",
    });
    expect(vars["--seg-done"]).toBe("0");
  });

  it("truncates fractional counters instead of emitting fractional segments", () => {
    const { vars, digit } = buildComboProgressStyle({
      total: 3.9,
      completed: 1.7,
      current: 2.4,
      state: "running",
    });
    expect(vars["--seg-total"]).toBe("3");
    expect(vars["--seg-done"]).toBe("1");
    expect(vars["--seg-deg"]).toBe("120deg");
    expect(digit).toBe("2");
  });

  it("falls back to a drawable ring for NaN counters", () => {
    const { vars, digit } = buildComboProgressStyle({
      total: Number.NaN,
      completed: Number.NaN,
      current: Number.NaN,
      state: "running",
    });
    expect(vars["--seg-total"]).toBe("1");
    expect(vars["--seg-done"]).toBe("0");
    expect(vars["--seg-deg"]).toBe("360deg");
    expect(digit).toBe("1");
  });

  it("emits only finite, quote-free strings — the payload is interpolated into JS", () => {
    const { vars } = buildComboProgressStyle({
      total: Number.POSITIVE_INFINITY,
      completed: Number.POSITIVE_INFINITY,
      current: Number.POSITIVE_INFINITY,
      state: "running",
    });
    for (const value of Object.values(vars)) {
      expect(value).not.toMatch(/["'\\<>]|Infinity|NaN/);
    }
  });
});
