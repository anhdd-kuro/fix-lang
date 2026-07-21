export type CorrectionOutputMode = "paste" | "popup";

export const DEFAULT_CORRECTION_OUTPUT_MODE: CorrectionOutputMode = "paste";

export const normalizeCorrectionOutputMode = (
  value: unknown,
): CorrectionOutputMode => (value === "popup" ? "popup" : "paste");
