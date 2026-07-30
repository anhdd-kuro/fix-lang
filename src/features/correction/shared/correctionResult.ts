export type CorrectionResultPayload = {
  /**
   * Preset that produced this correction. Carried as raw data — never a
   * pre-rendered sentence — so the renderer (and the native window title)
   * can build the localized heading at render/sync time via `t()` /
   * `mainT()`, and it re-resolves correctly after a locale switch. Absent
   * when a correction is delivered outside any preset context; consumers
   * fall back to the generic `notifications.window.correctionResult.title`
   * catalog key in that case (see `CorrectionResultWindow/index.tsx`).
   */
  presetName?: string;
  text: string;
};
