/**
 * @file tmThemeToSemanticTokens.ts
 * @description Maps VS Code TextMate theme colors to FixLang semantic CSS variables.
 *
 * Strategy: instead of mapping each semantic role to a single VS Code key
 * (which collapses roles to identical colors and exposes translucent overlay
 * colors as solids), we extract a few stable anchors from the theme
 * (background, foreground, a vivid accent) and DERIVE a surface elevation
 * ladder + foreground ramp from them. Theme-provided surfaces are honored only
 * when they are solid AND visually distinct from the background. All colors are
 * composited to opaque values so the UI matches what VS Code/terminal render.
 */
import { adjustSemanticTokenContrast } from "./adjustSemanticTokenContrast";
import {
  blend,
  composite,
  ensureBrightnessDelta,
  isDarkColor,
  isFullyTransparent,
  readableOn,
  saturation,
  vivify,
} from "./compositeColor";
import type { SemanticTokens, TmTheme } from "./tmThemeTypes";

/** Minimum saturation for a candidate to qualify as an accent/status color. */
const MIN_ACCENT_SATURATION = 0.18;

/** Returns the first present, non-empty raw color string for the given keys. */
const rawPick = (
  colors: Record<string, string>,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const value = colors[key];
    if (value && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
};

/**
 * Returns a solid surface color elevated from `base` by at least `minDelta`
 * brightness. Honors a theme's own surface key (composited) when it is already
 * distinct enough; otherwise derives the surface so the elevation ladder always
 * has visible separation, even when the theme reuses the editor background.
 */
const deriveSurface = (
  colors: Record<string, string>,
  keys: readonly string[],
  base: string,
  minDelta: number,
  isDark: boolean,
): string => {
  const raw = rawPick(colors, keys);
  const start = raw ? composite(raw, base) : base;
  return ensureBrightnessDelta(start, base, minDelta, isDark);
};

/**
 * Picks the most vivid solid color among the candidate keys (composited over
 * the background); falls back to the first candidate, then to `fallback`.
 */
const deriveAccent = (
  colors: Record<string, string>,
  keys: readonly string[],
  background: string,
  fallback: string,
): string => {
  let first: string | undefined;
  for (const key of keys) {
    const raw = colors[key]?.trim();
    if (!raw || isFullyTransparent(raw)) {
      continue;
    }
    const solid = composite(raw, background);
    first ??= solid;
    if (saturation(solid) >= MIN_ACCENT_SATURATION) {
      return solid;
    }
  }
  return first ?? fallback;
};

/**
 * Converts a TextMate theme JSON object into semantic CSS variable values.
 */
export const tmThemeToSemanticTokens = (theme: TmTheme): SemanticTokens => {
  const colors = theme.colors ?? {};

  // --- Anchors -------------------------------------------------------------
  const declaredDark = theme.type !== "light";
  const background = composite(
    rawPick(colors, ["editor.background", "sideBar.background"]) ??
      (declaredDark ? "#111827" : "#ffffff"),
    declaredDark ? "#000000" : "#ffffff",
  );
  const isDark = isDarkColor(background);
  const foreground = composite(
    rawPick(colors, ["editor.foreground", "foreground"]) ??
      (isDark ? "#f9fafb" : "#1f2937"),
    background,
  );

  // --- Accents -------------------------------------------------------------
  // Button/heatmap accent — give muted theme accents (Nord, One Dark) a small
  // saturation floor so they still read as an accent without losing their hue.
  const primary = vivify(
    deriveAccent(
      colors,
      [
        "activityBarBadge.background",
        "progressBar.background",
        "button.background",
        "focusBorder",
        "textLink.foreground",
        "editorWidget.border",
        "terminal.ansiBlue",
      ],
      background,
      "#2563eb",
    ),
    0.35,
  );
  const ring = deriveAccent(
    colors,
    ["focusBorder", "activityBarBadge.background", "progressBar.background"],
    background,
    primary,
  );
  const destructive = deriveAccent(
    colors,
    [
      "errorForeground",
      "editorError.foreground",
      "terminal.ansiRed",
      "list.errorForeground",
    ],
    background,
    "#ef4444",
  );
  const success = deriveAccent(
    colors,
    [
      "terminal.ansiGreen",
      "gitDecoration.addedResourceForeground",
      "editorGutter.addedBackground",
    ],
    background,
    "#22c55e",
  );
  const warning = deriveAccent(
    colors,
    [
      "terminal.ansiYellow",
      "editorWarning.foreground",
      "editorGutter.modifiedBackground",
    ],
    background,
    "#eab308",
  );

  // --- Surface elevation ladder (monotonic brightness deltas from bg) ------
  const muted = deriveSurface(colors, [], background, 0.045, isDark);
  const input = deriveSurface(
    colors,
    ["input.background"],
    background,
    0.05,
    isDark,
  );
  const secondary = deriveSurface(
    colors,
    ["tab.inactiveBackground", "editorGroupHeader.tabsBackground"],
    background,
    0.06,
    isDark,
  );
  const card = deriveSurface(
    colors,
    ["sideBar.background", "editorWidget.background", "panel.background"],
    background,
    0.085,
    isDark,
  );
  const popover = deriveSurface(
    colors,
    ["dropdown.background", "menu.background", "editorWidget.background"],
    background,
    0.1,
    isDark,
  );
  const accent = deriveSurface(
    colors,
    ["list.hoverBackground", "list.activeSelectionBackground"],
    background,
    0.12,
    isDark,
  );
  // Subtle, neutral hairline derived from foreground — never a raw black/white
  // overlay. This is the key fix for the harsh borders.
  const border = blend(background, foreground, isDark ? 0.16 : 0.14);

  // --- Foreground ramp -----------------------------------------------------
  const cardForeground = composite(
    rawPick(colors, ["sideBar.foreground", "editor.foreground", "foreground"]) ??
      foreground,
    card,
  );
  const popoverForeground = composite(
    rawPick(colors, ["dropdown.foreground", "menu.foreground"]) ?? foreground,
    popover,
  );

  // --- Charts (vivid, distinct) -------------------------------------------
  const chart2 = deriveAccent(
    colors,
    ["terminal.ansiBlue", "textLink.foreground"],
    background,
    primary,
  );
  const chart3 = deriveAccent(
    colors,
    ["terminal.ansiMagenta", "terminal.ansiBrightMagenta"],
    background,
    success,
  );
  const chart4 = deriveAccent(
    colors,
    ["terminal.ansiCyan", "terminal.ansiBrightCyan"],
    background,
    warning,
  );
  const chart5 = deriveAccent(
    colors,
    ["terminal.ansiYellow", "terminal.ansiBrightYellow"],
    background,
    destructive,
  );

  const tokens: SemanticTokens = {
    "--background": background,
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": cardForeground,
    "--popover": popover,
    "--popover-foreground": popoverForeground,
    "--primary": primary,
    "--primary-foreground": readableOn(primary),
    "--secondary": secondary,
    "--secondary-foreground": blend(foreground, background, 0.25),
    "--muted": muted,
    "--muted-foreground": blend(foreground, background, 0.45),
    "--accent": accent,
    "--accent-foreground": foreground,
    "--destructive": destructive,
    "--destructive-foreground": readableOn(destructive),
    "--border": border,
    "--input": input,
    "--ring": ring,
    "--success": success,
    "--success-foreground": readableOn(success),
    "--warning": warning,
    "--warning-foreground": readableOn(warning),
    "--chart-1": primary,
    "--chart-2": chart2,
    "--chart-3": chart3,
    "--chart-4": chart4,
    "--chart-5": chart5,
    "--overlay-spinner": primary,
    "--overlay-spinner-track": border,
    "--overlay-backdrop": "rgba(0, 0, 0, 0.72)",
  };

  return adjustSemanticTokenContrast(tokens);
};
