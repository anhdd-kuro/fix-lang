/**
 * @file selectContrast.test.ts
 * @description Asserts every colour pairing a select control uses against the
 * REAL generated presets, not against the CSS variable name.
 *
 * A test that only checks `color: var(--popover-foreground)` proves the token
 * was spelled right, which is exactly the mistake this whole change fixes: the
 * broken code was also spelling a real token, just not the one paired with the
 * surface underneath it. So these read all 149 `preset-*.css` files, resolve
 * both sides of each pairing, and measure with the app's own `contrastRatio`.
 *
 * Floors are WCAG 2.2 AA: 4.5:1 for text (1.4.3), 3:1 for icons and other
 * non-text UI (1.4.11).
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "~/themes/compositeColor";
import { selectOptionSurface } from "./selectOptionSurface";

const PRESET_DIR = "src/renderer/themes/generated";
const TEXT_FLOOR = 4.5;
const NON_TEXT_FLOOR = 3;

type Preset = { theme: string; tokens: Map<string, string> };

/** `--name: #value;` lines from one preset's single `html[data-theme=…]` block. */
const readPresets = (): Preset[] =>
  readdirSync(PRESET_DIR)
    .filter((file) => file.startsWith("preset-") && file.endsWith(".css"))
    .map((file) => {
      const css = readFileSync(`${PRESET_DIR}/${file}`, "utf8");
      const tokens = new Map<string, string>();
      for (const [, name, value] of css.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) {
        if (name !== undefined && value !== undefined && !tokens.has(name)) {
          tokens.set(name, value.trim());
        }
      }
      return { theme: file.replace(/^preset-|\.css$/g, ""), tokens };
    });

const PRESETS = readPresets();

/** `var(--x)` → `x`; anything else (e.g. `transparent`) is returned as null. */
const tokenName = (cssValue: string): string | null =>
  /^var\(--([\w-]+)\)$/.exec(cssValue)?.[1] ?? null;

const resolve = (preset: Preset, token: string): string => {
  const value = preset.tokens.get(token);
  if (value === undefined) {
    throw new Error(`${preset.theme} is missing --${token}`);
  }
  return value;
};

const worstPairing = (
  background: string,
  foreground: string,
): { ratio: number; theme: string } =>
  PRESETS.reduce(
    (worst, preset) => {
      const ratio = contrastRatio(
        resolve(preset, background),
        resolve(preset, foreground),
      );
      return ratio < worst.ratio ? { ratio, theme: preset.theme } : worst;
    },
    { ratio: Infinity, theme: "" },
  );

const expectFloor = (
  background: string,
  foreground: string,
  floor: number,
): void => {
  const { ratio, theme } = worstPairing(background, foreground);
  expect(
    ratio,
    `--${foreground} on --${background} is ${ratio.toFixed(2)}:1 in ${theme}, below ${floor}:1`,
  ).toBeGreaterThanOrEqual(floor);
};

describe("select colour pairings across every generated theme", () => {
  it("reads all 149 presets", () => {
    expect(PRESETS).toHaveLength(149);
    expect(PRESETS.every((preset) => preset.tokens.size > 0)).toBe(true);
  });

  it("keeps every menu row's text readable on the row it sits on", () => {
    // Straight from the shared table, so a token swapped there is measured here
    // rather than merely re-asserted.
    const rows = [
      { state: { isFocused: false, isSelected: false }, background: "popover" },
      { state: { isFocused: true, isSelected: false }, background: "secondary" },
      { state: { isFocused: false, isSelected: true }, background: "primary" },
    ];

    for (const { state, background } of rows) {
      const foreground = tokenName(selectOptionSurface(state).color);
      expect(foreground).not.toBeNull();
      expectFloor(background, foreground as string, TEXT_FLOOR);
    }
  });

  it("keeps the control's own text readable on the secondary surface", () => {
    // `singleValue`, typed `input`, and the placeholder sit on `--secondary`,
    // matching Settings → General → API key. The paired foreground is required;
    // `foreground` on `secondary` fails 4.5:1.
    expectFloor("secondary", "secondary-foreground", TEXT_FLOOR);
  });

  it("keeps the empty-result message readable on the menu", () => {
    expectFloor("popover", "popover-foreground", TEXT_FLOOR);
  });

  it("keeps both indicator icons above the non-text floor, resting and hovered", () => {
    expectFloor("secondary", "accent-foreground", NON_TEXT_FLOOR);
    expectFloor("secondary", "secondary-foreground", NON_TEXT_FLOOR);
  });

  it("keeps MultiSelect's hovered row readable, since it shares the hover pairing", () => {
    expectFloor("secondary", "secondary-foreground", TEXT_FLOOR);
  });

  it("records the disabled row rather than asserting a floor it is exempt from", () => {
    // WCAG 1.4.3 exempts inactive controls, and the dimming is the only
    // "not selectable" signal the default `Option` has. This pins what that
    // costs so a future reader sees it was measured, not overlooked — and fails
    // if the derive ladder ever makes it WORSE than what was accepted here.
    const { ratio, theme } = worstPairing("popover", "muted-foreground");
    expect(theme).toBe("slack-ochin");
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(TEXT_FLOOR);
  });

  it("proves the pre-fix pairings really did fail, so the floors above bite", () => {
    // Guards the guard: if `contrastRatio` or the parsing broke, everything
    // above would pass vacuously.
    const focusedBefore = worstPairing("secondary", "foreground");
    const selectedBefore = worstPairing("primary", "foreground");
    const controlBefore = worstPairing("input", "foreground");

    expect(focusedBefore.ratio).toBeLessThan(NON_TEXT_FLOOR);
    expect(selectedBefore.ratio).toBeLessThan(NON_TEXT_FLOOR);
    expect(controlBefore.ratio).toBeLessThan(NON_TEXT_FLOOR);
  });
});
