/**
 * @file tmThemeTypes.ts
 * @description Types for Shiki / VS Code TextMate theme JSON files.
 */

export type TmTheme = {
  name: string;
  displayName?: string;
  type?: "dark" | "light";
  colors?: Record<string, string>;
};

export type SemanticTokenKey =
  | "--background"
  | "--foreground"
  | "--card"
  | "--card-foreground"
  | "--popover"
  | "--popover-foreground"
  | "--primary"
  | "--primary-foreground"
  | "--secondary"
  | "--secondary-foreground"
  | "--muted"
  | "--muted-foreground"
  | "--accent"
  | "--accent-foreground"
  | "--destructive"
  | "--destructive-foreground"
  | "--border"
  | "--input"
  | "--ring"
  | "--success"
  | "--success-foreground"
  | "--warning"
  | "--warning-foreground"
  | "--chart-1"
  | "--chart-2"
  | "--chart-3"
  | "--chart-4"
  | "--chart-5"
  | "--overlay-spinner"
  | "--overlay-spinner-track"
  | "--overlay-backdrop";

export type SemanticTokens = Record<SemanticTokenKey, string>;
