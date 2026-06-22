/**
 * @file alacrittyToTmTheme.ts
 * @description Converts Alacritty TOML color schemes into TextMate-style theme JSON.
 */
import { colord } from "colord";
import type { TmTheme } from "./tmThemeTypes";

type AlacrittyPalette = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

const readTomlSectionValue = (
  content: string,
  section: string,
  key: string,
): string | undefined => {
  const sectionPattern = new RegExp(
    `\\[colors\\.${section.replace(".", "\\.")}\\][\\s\\S]*?(?=\\[|$)`,
  );
  const sectionMatch = sectionPattern.exec(content);
  if (!sectionMatch) {
    return undefined;
  }

  const keyPattern = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
  const keyMatch = keyPattern.exec(sectionMatch[0]);
  return keyMatch?.[1];
};

/**
 * Parses a terminalcolors.com Alacritty TOML file into a flat palette.
 */
export const parseAlacrittyToml = (content: string): AlacrittyPalette => {
  const required = (section: string, key: string): string => {
    const value = readTomlSectionValue(content, section, key);
    if (!value) {
      throw new Error(`Missing [colors.${section}] ${key} in Alacritty theme`);
    }
    return value;
  };

  return {
    background: required("primary", "background"),
    foreground: required("primary", "foreground"),
    cursor: required("cursor", "cursor"),
    selectionBackground: required("selection", "background"),
    selectionForeground: required("selection", "text"),
    black: required("normal", "black"),
    red: required("normal", "red"),
    green: required("normal", "green"),
    yellow: required("normal", "yellow"),
    blue: required("normal", "blue"),
    magenta: required("normal", "magenta"),
    cyan: required("normal", "cyan"),
    white: required("normal", "white"),
    brightBlack: required("bright", "black"),
    brightRed: required("bright", "red"),
    brightGreen: required("bright", "green"),
    brightYellow: required("bright", "yellow"),
    brightBlue: required("bright", "blue"),
    brightMagenta: required("bright", "magenta"),
    brightCyan: required("bright", "cyan"),
    brightWhite: required("bright", "white"),
  };
};

const titleCase = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/**
 * Maps an Alacritty palette to VS Code theme color keys for semantic token conversion.
 */
export const alacrittyToTmTheme = (
  slug: string,
  palette: AlacrittyPalette,
  accentHint?: string,
): TmTheme => {
  const isDark = colord(palette.background).isDark();
  const accent = accentHint ?? palette.blue;
  const panel = palette.brightBlack;
  const border = palette.brightBlack;

  const colors: Record<string, string> = {
    foreground: palette.foreground,
    focusBorder: accent,
    "editor.background": palette.background,
    "editor.foreground": palette.foreground,
    "editor.selectionBackground": palette.selectionBackground,
    "editor.lineHighlightBackground": panel,
    "editorLineNumber.foreground": palette.brightBlack,
    "editorCursor.foreground": palette.cursor,
    "editorError.foreground": palette.red,
    "editorWarning.foreground": palette.yellow,
    "activityBar.background": panel,
    "activityBar.foreground": palette.foreground,
    "activityBarBadge.background": accent,
    "activityBarBadge.foreground": palette.background,
    "sideBar.background": panel,
    "sideBar.foreground": palette.foreground,
    "sideBar.border": border,
    "panel.background": panel,
    "panel.border": border,
    "tab.activeBackground": palette.background,
    "tab.inactiveBackground": panel,
    "tab.inactiveForeground": palette.brightBlack,
    "tab.border": border,
    "editorGroup.border": border,
    "button.background": accent,
    "button.foreground": isDark ? palette.foreground : palette.background,
    "dropdown.background": panel,
    "dropdown.foreground": palette.foreground,
    "dropdown.border": border,
    "input.background": panel,
    "input.foreground": palette.foreground,
    "input.border": border,
    "list.hoverBackground": panel,
    "list.activeSelectionBackground": palette.selectionBackground,
    "list.hoverForeground": palette.foreground,
    "list.activeSelectionForeground": palette.selectionForeground,
    "menu.background": panel,
    "menu.foreground": palette.foreground,
    "editorWidget.background": panel,
    "descriptionForeground": palette.brightBlack,
    "progressBar.background": accent,
    "terminal.ansiBlack": palette.black,
    "terminal.ansiRed": palette.red,
    "terminal.ansiGreen": palette.green,
    "terminal.ansiYellow": palette.yellow,
    "terminal.ansiBlue": palette.blue,
    "terminal.ansiMagenta": palette.magenta,
    "terminal.ansiCyan": palette.cyan,
    "terminal.ansiWhite": palette.white,
    "terminal.ansiBrightBlack": palette.brightBlack,
    "terminal.ansiBrightRed": palette.brightRed,
    "terminal.ansiBrightGreen": palette.brightGreen,
    "terminal.ansiBrightYellow": palette.brightYellow,
    "terminal.ansiBrightBlue": palette.brightBlue,
    "terminal.ansiBrightMagenta": palette.brightMagenta,
    "terminal.ansiBrightCyan": palette.brightCyan,
    "terminal.ansiBrightWhite": palette.brightWhite,
    "gitDecoration.addedResourceForeground": palette.green,
    errorForeground: palette.red,
  };

  const [family, ...variantParts] = slug.split("-");
  const variant = variantParts.join("-") || "default";
  const labelFamily = titleCase(family);
  const labelVariant =
    variant === "default" ? "Default" : titleCase(variant.replace(/-/g, " "));

  return {
    name: `tc-${slug}`,
    displayName: `${labelFamily} ${labelVariant}`.trim(),
    type: isDark ? "dark" : "light",
    colors,
  };
};
