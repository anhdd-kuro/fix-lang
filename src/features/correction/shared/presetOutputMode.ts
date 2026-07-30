/**
 * @file presetOutputMode.ts
 * @description Per-preset override of the global correction output mode
 * ("paste" vs "popup"). "inherit" is the default: the preset defers to
 * whatever the global setting resolves to at request time, so switching the
 * global mode still moves every "inherit" preset, while a preset explicitly
 * pinned to "paste" or "popup" never moves with it.
 */
import type { CorrectionOutputMode } from "./outputMode";

export type PresetOutputMode = "inherit" | CorrectionOutputMode;

export const DEFAULT_PRESET_OUTPUT_MODE: PresetOutputMode = "inherit";

/**
 * Resolves a preset's stored (possibly untrusted/legacy) output-mode field
 * against the current global mode. `undefined`, `"inherit"`, and any
 * unrecognized value all fall through to `globalMode` — only a positively
 * recognized `"paste"`/`"popup"` override wins.
 */
export const resolvePresetOutputMode = (
  raw: unknown,
  globalMode: CorrectionOutputMode,
): CorrectionOutputMode =>
  raw === "paste" || raw === "popup" ? raw : globalMode;
