/**
 * @file adjustSemanticTokenContrast.ts
 * @description Post-processes semantic theme tokens for readable UI contrast.
 */
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import type { SemanticTokenKey, SemanticTokens } from "./tmThemeTypes";

extend([a11yPlugin]);

const MIN_BODY_CONTRAST = 4.5;
const MIN_MUTED_CONTRAST = 3.5;
const MIN_CARD_BRIGHTNESS_DELTA = 0.08;
const MIN_BORDER_BRIGHTNESS_DELTA = 0.1;

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
 * Raises or lowers a foreground color until it meets a contrast ratio on a background.
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

  if (fg.contrast(bg) >= minRatio) {
    return fg.toRgbString();
  }

  const lighten = !bg.isDark();

  for (let step = 1; step <= 24; step += 1) {
    const adjusted = lighten
      ? fg.lighten(step * 0.04)
      : fg.darken(step * 0.04);

    if (adjusted.contrast(bg) >= minRatio) {
      return adjusted.toRgbString();
    }
  }

  return lighten ? "rgb(24, 24, 27)" : "rgb(228, 228, 231)";
};

/**
 * Ensures a surface color is visually distinct from a reference surface.
 */
const ensureSurfaceDelta = (
  surface: string,
  reference: string,
  minBrightnessDelta: number,
): string => {
  let surfaceColor = colord(surface);
  const referenceColor = colord(reference);
  let delta = Math.abs(surfaceColor.brightness() - referenceColor.brightness());

  if (delta >= minBrightnessDelta) {
    return surfaceColor.toRgbString();
  }

  const isDark = referenceColor.isDark();

  for (let step = 1; step <= 20; step += 1) {
    surfaceColor = isDark
      ? referenceColor.lighten(step * 0.05)
      : referenceColor.darken(step * 0.05);
    delta = Math.abs(surfaceColor.brightness() - referenceColor.brightness());
    if (delta >= minBrightnessDelta) {
      return surfaceColor.toRgbString();
    }
  }

  return isDark
    ? referenceColor.lighten(0.12).toRgbString()
    : referenceColor.darken(0.12).toRgbString();
};

/**
 * Keeps muted label colors neutral instead of picking saturated accent hues.
 */
const normalizeMutedForeground = (muted: string, card: string): string => {
  let candidate = colord(muted);
  const { s } = candidate.toHsl();

  if (s > 0.35) {
    candidate = candidate.desaturate(0.55);
  }

  return ensureContrast(candidate.toRgbString(), card, MIN_MUTED_CONTRAST);
};

const deriveOverlayBackdrop = (background: string): string =>
  colord(background).alpha(0.72).toRgbString();

/**
 * Ensures chart steps remain visually distinct on the page background.
 */
const normalizeChartTokens = (tokens: SemanticTokens): void => {
  const background = readToken(tokens, "--background");
  const bg = colord(background);
  const isDark = bg.isDark();

  const chartKeys: SemanticTokenKey[] = [
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
  ];

  for (const [index, key] of chartKeys.entries()) {
    const current = colord(readToken(tokens, key));
    const minDelta = (index + 1) * 0.08;
    const delta = Math.abs(current.brightness() - bg.brightness());

    if (delta < minDelta) {
      const adjusted = isDark
        ? bg.lighten(0.08 + index * 0.04)
        : bg.darken(0.08 + index * 0.04);
      writeToken(tokens, key, adjusted.toRgbString());
    }
  }
};

/**
 * Adjusts mapped semantic tokens so labels, borders, and surfaces stay readable.
 */
export const adjustSemanticTokenContrast = (
  tokens: SemanticTokens,
): SemanticTokens => {
  const adjusted: SemanticTokens = { ...tokens };
  const background = readToken(adjusted, "--background");

  writeToken(
    adjusted,
    "--foreground",
    ensureContrast(readToken(adjusted, "--foreground"), background, MIN_BODY_CONTRAST),
  );

  writeToken(
    adjusted,
    "--card",
    ensureSurfaceDelta(
      readToken(adjusted, "--card"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA,
    ),
  );

  const resolvedCard = readToken(adjusted, "--card");

  writeToken(
    adjusted,
    "--card-foreground",
    ensureContrast(
      readToken(adjusted, "--card-foreground"),
      resolvedCard,
      MIN_BODY_CONTRAST,
    ),
  );

  writeToken(
    adjusted,
    "--muted-foreground",
    normalizeMutedForeground(readToken(adjusted, "--muted-foreground"), resolvedCard),
  );

  writeToken(
    adjusted,
    "--secondary",
    ensureSurfaceDelta(
      readToken(adjusted, "--secondary"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA * 0.75,
    ),
  );

  writeToken(
    adjusted,
    "--muted",
    ensureSurfaceDelta(
      readToken(adjusted, "--muted"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA * 0.75,
    ),
  );

  writeToken(
    adjusted,
    "--accent",
    ensureSurfaceDelta(
      readToken(adjusted, "--accent"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA,
    ),
  );

  writeToken(
    adjusted,
    "--border",
    ensureSurfaceDelta(
      readToken(adjusted, "--border"),
      resolvedCard,
      MIN_BORDER_BRIGHTNESS_DELTA,
    ),
  );

  writeToken(
    adjusted,
    "--input",
    ensureSurfaceDelta(
      readToken(adjusted, "--input"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA * 0.5,
    ),
  );

  writeToken(
    adjusted,
    "--popover",
    ensureSurfaceDelta(
      readToken(adjusted, "--popover"),
      background,
      MIN_CARD_BRIGHTNESS_DELTA,
    ),
  );

  writeToken(
    adjusted,
    "--primary-foreground",
    ensureContrast(
      readToken(adjusted, "--primary-foreground"),
      readToken(adjusted, "--primary"),
      MIN_BODY_CONTRAST,
    ),
  );

  writeToken(
    adjusted,
    "--overlay-spinner-track",
    ensureContrast(
      readToken(adjusted, "--overlay-spinner-track"),
      background,
      MIN_MUTED_CONTRAST,
    ),
  );

  writeToken(adjusted, "--overlay-backdrop", deriveOverlayBackdrop(background));

  normalizeChartTokens(adjusted);

  return adjusted;
};
