export type CorrectionOutputMode = "paste" | "popup";

export const DEFAULT_CORRECTION_OUTPUT_MODE: CorrectionOutputMode = "paste";

/** Exactly `"popup"` selects the popup; every other value, junk included, pastes. */
export const normalizeCorrectionOutputMode = <Stored>(
  value: Stored,
): CorrectionOutputMode => (value === "popup" ? "popup" : "paste");
