export const DEFAULT_CLIPBOARD_FALLBACK_ENABLED = true;

// Absent/garbage config falls to the default (on). Only an explicit `false` disables.
export const normalizeClipboardFallbackEnabled = (value: unknown): boolean =>
  value !== false;
