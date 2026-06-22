/**
 * @file tmThemeToSemanticTokens.ts
 * @description Maps VS Code TextMate theme colors to FixLang semantic CSS variables.
 */
import { adjustSemanticTokenContrast } from "./adjustSemanticTokenContrast";
import { normalizeColor } from "./normalizeColor";
import type { SemanticTokenKey, SemanticTokens, TmTheme } from "./tmThemeTypes";

const SEMANTIC_SOURCE_KEYS: Record<SemanticTokenKey, readonly string[]> = {
  "--background": ["editor.background", "sideBar.background"],
  "--foreground": ["editor.foreground", "foreground"],
  "--card": [
    "sideBar.background",
    "editorWidget.background",
    "panel.background",
  ],
  "--card-foreground": [
    "sideBar.foreground",
    "editor.foreground",
    "foreground",
  ],
  "--popover": [
    "dropdown.background",
    "menu.background",
    "editorWidget.background",
  ],
  "--popover-foreground": [
    "dropdown.foreground",
    "menu.foreground",
    "editor.foreground",
  ],
  "--primary": [
    "activityBarBadge.background",
    "button.background",
    "progressBar.background",
  ],
  "--primary-foreground": ["button.foreground", "activityBarBadge.foreground"],
  "--secondary": ["tab.inactiveBackground", "editor.selectionBackground"],
  "--secondary-foreground": ["tab.inactiveForeground", "sideBar.foreground"],
  "--muted": ["tab.inactiveBackground", "editor.lineHighlightBackground"],
  "--muted-foreground": [
    "descriptionForeground",
    "editorLineNumber.foreground",
    "sideBar.foreground",
    "editorCodeLens.foreground",
  ],
  "--accent": [
    "list.hoverBackground",
    "list.activeSelectionBackground",
    "list.focusBackground",
  ],
  "--accent-foreground": [
    "list.hoverForeground",
    "list.activeSelectionForeground",
    "editor.foreground",
  ],
  "--destructive": ["errorForeground", "editorError.foreground"],
  "--destructive-foreground": ["editor.foreground", "foreground"],
  "--border": [
    "editorGroup.border",
    "panel.border",
    "sideBar.border",
    "tab.border",
  ],
  "--input": ["input.background", "dropdown.background"],
  "--ring": [
    "focusBorder",
    "activityBarBadge.background",
    "progressBar.background",
  ],
  "--success": ["terminal.ansiGreen", "gitDecoration.addedResourceForeground"],
  "--success-foreground": ["editor.background", "sideBar.background"],
  "--warning": ["terminal.ansiYellow", "editorWarning.foreground"],
  "--warning-foreground": ["editor.background", "sideBar.background"],
  "--chart-1": ["editorIndentGuide.background", "editorGutter.background"],
  "--chart-2": ["editorLineNumber.foreground", "sideBar.foreground"],
  "--chart-3": ["terminal.ansiBlue"],
  "--chart-4": ["activityBarBadge.background", "progressBar.background"],
  "--chart-5": ["terminal.ansiCyan"],
  "--overlay-spinner": [
    "progressBar.background",
    "activityBarBadge.background",
  ],
  "--overlay-spinner-track": ["editor.foreground", "foreground"],
};

const FALLBACK_TOKENS: SemanticTokens = {
  "--background": "#111827",
  "--foreground": "#f9fafb",
  "--card": "#1f2937",
  "--card-foreground": "#f9fafb",
  "--popover": "#1f2937",
  "--popover-foreground": "#f9fafb",
  "--primary": "#2563eb",
  "--primary-foreground": "#f9fafb",
  "--secondary": "#374151",
  "--secondary-foreground": "#d1d5db",
  "--muted": "#1f2937",
  "--muted-foreground": "#9ca3af",
  "--accent": "#374151",
  "--accent-foreground": "#f9fafb",
  "--destructive": "#ef4444",
  "--destructive-foreground": "#f9fafb",
  "--border": "#374151",
  "--input": "#1f2937",
  "--ring": "#2563eb",
  "--success": "#22c55e",
  "--success-foreground": "#111827",
  "--warning": "#eab308",
  "--warning-foreground": "#111827",
  "--chart-1": "#1f2937",
  "--chart-2": "#374151",
  "--chart-3": "#3b82f6",
  "--chart-4": "#2563eb",
  "--chart-5": "#06b6d4",
  "--overlay-spinner": "#2563eb",
  "--overlay-spinner-track": "#f9fafb",
  "--overlay-backdrop": "rgba(0, 0, 0, 0.72)",
};

const pickColor = (
  colors: Record<string, string>,
  keys: readonly string[],
  fallback: string,
): string => {
  for (const key of keys) {
    const value = colors[key];
    if (value) {
      return normalizeColor(value);
    }
  }
  return fallback;
};

/**
 * Converts a TextMate theme JSON object into semantic CSS variable values.
 */
export const tmThemeToSemanticTokens = (theme: TmTheme): SemanticTokens => {
  const colors = theme.colors ?? {};
  const entries = Object.entries(SEMANTIC_SOURCE_KEYS) as [
    SemanticTokenKey,
    readonly string[],
  ][];

  const tokens = {} as SemanticTokens;
  for (const [tokenKey, sourceKeys] of entries) {
    tokens[tokenKey] = pickColor(colors, sourceKeys, FALLBACK_TOKENS[tokenKey]);
  }

  return adjustSemanticTokenContrast(tokens);
};
