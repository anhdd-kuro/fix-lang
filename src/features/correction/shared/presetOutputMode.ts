/**
 * @file presetOutputMode.ts
 * @description Per-preset override of the global correction output mode
 * ("paste" vs "popup"). "inherit" is the default: the preset defers to
 * whatever the global setting resolves to at request time, so switching the
 * global mode still moves every "inherit" preset, while a preset explicitly
 * pinned to "paste" or "popup" never moves with it.
 */
import { z } from "zod";
import type { CorrectionOutputMode } from "./outputMode";

export type PresetOutputMode = "inherit" | CorrectionOutputMode;

export const DEFAULT_PRESET_OUTPUT_MODE: PresetOutputMode = "inherit";

/** Only an exact `"paste"` or `"popup"` pins a preset; anything else inherits. */
const PresetOverrideSchema = z.enum(["paste", "popup"]);

/**
 * Resolves a preset's stored (possibly untrusted/legacy) output-mode field
 * against the current global mode. `undefined`, `"inherit"`, and any
 * unrecognized value all fall through to `globalMode` — only a positively
 * recognized `"paste"`/`"popup"` override wins.
 */
export const resolvePresetOutputMode = <Stored>(
  raw: Stored,
  globalMode: CorrectionOutputMode,
): CorrectionOutputMode => {
  const override = PresetOverrideSchema.safeParse(raw);
  return override.success ? override.data : globalMode;
};
