/**
 * @file Select.test.ts
 * Tests for the Select primitive's buildSelectStyles helper.
 * Verifies px→rem conversion and semantic token mapping (no React mount needed).
 */
import { describe, expect, it } from "vitest";
import { buildSelectStyles, CONTROL_HEIGHT_REM, MENU_BORDER_RADIUS_REM } from "./Select";

describe("buildSelectStyles", () => {
  it("returns an object with required react-select style keys", () => {
    const styles = buildSelectStyles();
    expect(styles).toHaveProperty("control");
    expect(styles).toHaveProperty("menu");
    expect(styles).toHaveProperty("menuList");
    expect(styles).toHaveProperty("option");
    expect(styles).toHaveProperty("singleValue");
    expect(styles).toHaveProperty("input");
    expect(styles).toHaveProperty("placeholder");
    expect(styles).toHaveProperty("dropdownIndicator");
    expect(styles).toHaveProperty("indicatorSeparator");
    expect(styles).toHaveProperty("clearIndicator");
    expect(styles).toHaveProperty("valueContainer");
    expect(styles).toHaveProperty("container");
  });

  it("control fn is a function (react-select style function)", () => {
    const styles = buildSelectStyles();
    expect(typeof styles.control).toBe("function");
  });

  it("menu fn is a function", () => {
    const styles = buildSelectStyles();
    expect(typeof styles.menu).toBe("function");
  });

  it("option fn is a function", () => {
    const styles = buildSelectStyles();
    expect(typeof styles.option).toBe("function");
  });

  it("CONTROL_HEIGHT_REM is rem string (not px)", () => {
    expect(CONTROL_HEIGHT_REM).toMatch(/rem$/);
  });

  it("MENU_BORDER_RADIUS_REM is rem string (not px)", () => {
    expect(MENU_BORDER_RADIUS_REM).toMatch(/rem$/);
  });

  it("control returns backgroundColor using CSS variable (semantic token)", () => {
    const styles = buildSelectStyles();
    // react-select passes (base, state); provide minimal state
    const result = (styles.control as (
      base: Record<string, unknown>,
      state: { isFocused: boolean; isDisabled: boolean }
    ) => Record<string, unknown>)({}, { isFocused: false, isDisabled: false });
    expect(result.backgroundColor).toContain("var(--color-control)");
  });

  it("menu returns backgroundColor using CSS variable (semantic token)", () => {
    const styles = buildSelectStyles();
    const result = (styles.menu as (
      base: Record<string, unknown>,
      state: Record<string, unknown>
    ) => Record<string, unknown>)({}, {});
    expect(result.backgroundColor).toContain("var(--color-control)");
  });

  it("option returns accent bg when selected", () => {
    const styles = buildSelectStyles();
    const result = (styles.option as (
      base: Record<string, unknown>,
      state: { isSelected: boolean; isFocused: boolean }
    ) => Record<string, unknown>)({}, { isSelected: true, isFocused: false });
    expect(result.backgroundColor).toContain("var(--color-accent)");
  });

  it("option returns control-hover bg when focused but not selected", () => {
    const styles = buildSelectStyles();
    const result = (styles.option as (
      base: Record<string, unknown>,
      state: { isSelected: boolean; isFocused: boolean }
    ) => Record<string, unknown>)({}, { isSelected: false, isFocused: true });
    expect(result.backgroundColor).toContain("var(--color-control-hover)");
  });

  it("option returns transparent bg when not focused and not selected", () => {
    const styles = buildSelectStyles();
    const result = (styles.option as (
      base: Record<string, unknown>,
      state: { isSelected: boolean; isFocused: boolean }
    ) => Record<string, unknown>)({}, { isSelected: false, isFocused: false });
    expect(result.backgroundColor).toBe("transparent");
  });

  it("singleValue color uses semantic label-primary token", () => {
    const styles = buildSelectStyles();
    const result = (styles.singleValue as (base: Record<string, unknown>) => Record<string, unknown>)({});
    expect(result.color).toContain("var(--color-label-primary)");
  });

  it("no px values in control output (all rem or token-based)", () => {
    const styles = buildSelectStyles();
    const result = (styles.control as (
      base: Record<string, unknown>,
      state: { isFocused: boolean; isDisabled: boolean }
    ) => Record<string, unknown>)({}, { isFocused: false, isDisabled: false });
    // Stringify and check no bare px values (only rem or var())
    const str = JSON.stringify(result);
    // Allow 0px (zero has no rem equivalent), but no non-zero px sizing
    const hasBadPx = /[1-9]\d*px/.test(str);
    expect(hasBadPx).toBe(false);
  });

  it("no px values in menu output", () => {
    const styles = buildSelectStyles();
    const result = (styles.menu as (
      base: Record<string, unknown>,
      state: Record<string, unknown>
    ) => Record<string, unknown>)({}, {});
    const str = JSON.stringify(result);
    const hasBadPx = /[1-9]\d*px/.test(str);
    expect(hasBadPx).toBe(false);
  });
});
