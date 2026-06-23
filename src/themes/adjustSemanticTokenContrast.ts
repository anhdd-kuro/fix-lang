/**
 * @file adjustSemanticTokenContrast.ts
 * @description Final readability safety net for derived semantic tokens.
 *
 * The surface elevation ladder and hue selection happen in
 * tmThemeToSemanticTokens. This pass only guarantees foreground/background
 * contrast floors and derives the overlay backdrop — it deliberately does NOT
 * re-derive surface colors (doing so collapsed distinct surfaces to one value).
 */
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import type { SemanticTokenKey, SemanticTokens } from "./tmThemeTypes";

extend([a11yPlugin]);

const MIN_BODY_CONTRAST = 4.5;
const MIN_MUTED_CONTRAST = 3.5;
/** Muted labels render on cards; keep them comfortably readable there. */
const MIN_MUTED_ON_CARD_CONTRAST = 4;

const readToken = (tokens: SemanticTokens, key: SemanticTokenKey): string =>
  tokens[key];

const writeToken = (
  tokens: SemanticTokens,
  key: SemanticTokenKey,
  value: string,
): void => {
  tokens[key] = value;
};

/**
 * Raises or lowers a foreground color until it meets a contrast ratio on a
 * background. Lightens against dark backgrounds, darkens against light ones.
 */
const ensureContrast = (
  foreground: string,
  background: string,
  minRatio: number,
): string => {
  const fg = colord(foreground);
  const bg = colord(background);

  if (fg.alpha() === 0) {
    return foreground;
  }
  // Margin absorbs the precision lost when colors are rounded to hex, so the
  // emitted value stays above the target when re-measured downstream.
  const target = minRatio + 0.1;

  if (fg.contrast(bg) >= target) {
    return fg.toHex();
  }

  const lighten = bg.isDark();

  for (let step = 1; step <= 24; step += 1) {
    const adjusted = lighten ? fg.lighten(step * 0.04) : fg.darken(step * 0.04);
    if (adjusted.contrast(bg) >= target) {
      return adjusted.toHex();
    }
  }

  return lighten ? "#e4e4e7" : "#18181b";
};

/**
 * Keeps muted labels neutral (desaturated) while meeting a softer contrast
 * floor against the page background.
 */
const normalizeMutedForeground = (muted: string, card: string): string => {
  let candidate = colord(muted);
  if (candidate.toHsl().s > 35) {
    candidate = candidate.desaturate(0.4);
  }
  return ensureContrast(candidate.toHex(), card, MIN_MUTED_ON_CARD_CONTRAST);
};

/** Pairs of (foreground token, background token) that must stay readable. */
const CONTRAST_PAIRS: readonly (readonly [
  SemanticTokenKey,
  SemanticTokenKey,
  number,
])[] = [
  ["--foreground", "--background", MIN_BODY_CONTRAST],
  ["--card-foreground", "--card", MIN_BODY_CONTRAST],
  ["--popover-foreground", "--popover", MIN_BODY_CONTRAST],
  ["--secondary-foreground", "--secondary", MIN_MUTED_CONTRAST],
  ["--accent-foreground", "--accent", MIN_MUTED_CONTRAST],
  ["--primary-foreground", "--primary", MIN_BODY_CONTRAST],
  ["--destructive-foreground", "--destructive", MIN_BODY_CONTRAST],
  ["--success-foreground", "--success", MIN_MUTED_CONTRAST],
  ["--warning-foreground", "--warning", MIN_MUTED_CONTRAST],
  ["--overlay-spinner-track", "--background", MIN_MUTED_CONTRAST],
];

/**
 * Enforces contrast floors on foreground tokens and derives the overlay
 * backdrop from the resolved background.
 */
export const adjustSemanticTokenContrast = (
  tokens: SemanticTokens,
): SemanticTokens => {
  const adjusted: SemanticTokens = { ...tokens };

  for (const [fgKey, bgKey, minRatio] of CONTRAST_PAIRS) {
    writeToken(
      adjusted,
      fgKey,
      ensureContrast(
        readToken(adjusted, fgKey),
        readToken(adjusted, bgKey),
        minRatio,
      ),
    );
  }

  writeToken(
    adjusted,
    "--muted-foreground",
    normalizeMutedForeground(
      readToken(adjusted, "--muted-foreground"),
      readToken(adjusted, "--card"),
    ),
  );

  writeToken(
    adjusted,
    "--overlay-backdrop",
    colord(readToken(adjusted, "--background")).alpha(0.72).toRgbString(),
  );

  return adjusted;
};
