/**
 * @file compositeColor.ts
 * @description Color math for theme derivation: flatten translucent VS Code
 * colors over a base, lift/lower surfaces, and blend toward another color.
 *
 * VS Code theme JSON uses many translucent overlay colors (e.g. `#00000030`,
 * `#717CB450`) that the editor composites over a base surface. Using them as
 * solid CSS colors produces harsh, wrong results (pure-black borders, washed
 * accents). These helpers reproduce the composite so we store solid colors.
 */
import { colord, extend } from "colord";
import mixPlugin from "colord/plugins/mix";

extend([mixPlugin]);

/**
 * Flattens a (possibly translucent) color onto an opaque base, returning a
 * solid hex string — the color the eye actually sees in VS Code.
 */
export const composite = (input: string, base: string): string => {
  const color = colord(input);
  const alpha = color.alpha();

  if (alpha >= 1) {
    return color.toHex();
  }
  if (alpha <= 0) {
    return colord(base).toHex();
  }

  // out = fg * alpha + base * (1 - alpha) === base.mix(fgOpaque, alpha)
  return colord(base).mix(color.alpha(1), alpha).toHex();
};

/**
 * Lifts a surface away from the page background by `amount` (0–1 lightness):
 * lighter on dark themes, darker on light themes. Used to build the surface
 * elevation ladder (background < card < popover …).
 */
export const elevate = (base: string, amount: number, isDark: boolean): string =>
  isDark
    ? colord(base).lighten(amount).toHex()
    : colord(base).darken(amount).toHex();

/**
 * Blends `from` toward `toward` by `ratio` (0 = unchanged, 1 = fully toward).
 * Used to derive muted/secondary foregrounds by pulling text toward the bg.
 */
export const blend = (from: string, toward: string, ratio: number): string =>
  colord(from).mix(colord(toward), ratio).toHex();

/**
 * Pushes a surface away from `base` (lighter on dark themes, darker on light)
 * until its perceptual brightness differs by at least `minDelta` (0–1). A
 * surface already distinct enough is returned unchanged, preserving authentic
 * theme colors; collapsed surfaces are separated to build the elevation ladder.
 */
export const ensureBrightnessDelta = (
  surface: string,
  base: string,
  minDelta: number,
  isDark: boolean,
): string => {
  let color = colord(surface);
  const baseBrightness = colord(base).brightness();

  for (let step = 0; step <= 24; step += 1) {
    if (Math.abs(color.brightness() - baseBrightness) >= minDelta) {
      return color.toHex();
    }
    color = isDark ? color.lighten(0.02) : color.darken(0.02);
  }
  return color.toHex();
};

/**
 * Perceptual brightness delta (0–1) between two colors. Used to decide whether
 * a theme's own surface key is distinct enough to keep, or must be derived.
 */
export const brightnessDelta = (a: string, b: string): number =>
  Math.abs(colord(a).brightness() - colord(b).brightness());

/** True when the color is dark enough that white text reads better than black. */
export const isDarkColor = (color: string): boolean => colord(color).isDark();

/** True for fully transparent colors (e.g. `#FFFFFF00`) — they carry no hue. */
export const isFullyTransparent = (color: string): boolean =>
  colord(color).alpha() <= 0;

/** Saturation (0–1) in HSL space. */
export const saturation = (color: string): number => colord(color).toHsl().s / 100;

/**
 * Lifts a color's saturation up to `minSat` (0–1) without changing its hue,
 * so muted theme accents (e.g. Nord, One Dark) still read as a real accent on
 * a button. Already-saturated colors are returned unchanged.
 */
export const vivify = (color: string, minSat: number): string => {
  const current = colord(color);
  const sat = current.toHsl().s / 100;
  if (sat >= minSat) {
    return current.toHex();
  }
  return current.saturate(minSat - sat).toHex();
};

/**
 * Picks a readable foreground (near-black or near-white) for a given surface.
 */
export const readableOn = (surface: string): string =>
  colord(surface).isDark() ? "#fafafa" : "#18181b";
