/**
 * @file normalizeColor.ts
 * @description Normalizes VS Code theme color strings for CSS usage.
 */

const HEX_SHORT = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const HEX_LONG = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/**
 * Expands #RGB to #RRGGBB and converts #RRGGBBAA to rgba when needed.
 */
export const normalizeColor = (input: string): string => {
  const color = input.trim();
  if (!color.startsWith("#")) {
    return color;
  }

  const shortMatch = HEX_SHORT.exec(color);
  if (shortMatch) {
    const [, r, g, b] = shortMatch;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const longMatch = HEX_LONG.exec(color);
  if (!longMatch) {
    return color;
  }

  const [, rgb, alphaHex] = longMatch;
  if (!alphaHex) {
    return `#${rgb}`;
  }

  const alpha = Number.parseInt(alphaHex, 16) / 255;
  if (alpha >= 0.95) {
    return `#${rgb}`;
  }

  const r = Number.parseInt(rgb.slice(0, 2), 16);
  const g = Number.parseInt(rgb.slice(2, 4), 16);
  const b = Number.parseInt(rgb.slice(4, 6), 16);

  if (alpha <= 0.2) {
    return `#${rgb}`;
  }

  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${alpha.toFixed(2)})`;
};
