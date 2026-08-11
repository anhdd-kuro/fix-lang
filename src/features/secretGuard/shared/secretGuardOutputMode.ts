/**
 * @file secretGuardOutputMode.ts
 * @description Delivery override for a failed secret restore.
 *
 * Own file, own test, following the `presetOutputMode.ts` precedent: the rule
 * is two cases, and it is the one that keeps a half-restored reply off the
 * paste path.
 */
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";

/**
 * A reply whose placeholders could not all be restored goes to the popup —
 * whatever the preset and the global setting resolved to.
 *
 * The popup shows the MASKED reply, placeholders intact. Pasting a partial
 * restore would write a mixture of real secrets and placeholders over the
 * user's selection in another app, with nothing to tell them apart.
 */
export const resolveSecretGuardOutputMode = (
  resolvedMode: CorrectionOutputMode,
  restoreOk: boolean,
): CorrectionOutputMode => (restoreOk ? resolvedMode : "popup");
