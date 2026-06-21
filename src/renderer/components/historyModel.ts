/**
 * @file historyModel.ts
 * @description Pure presentation helper for history model lineage. Shows the
 * requested model and, when an alias resolved to a different concrete model,
 * the served id as "requested → resolved". No React/electron dependency —
 * primary test seam for the history model display.
 */

/**
 * Build the model label shown for a history entry.
 * @param model The requested model id (may be a floating alias or empty).
 * @param resolvedModel The concrete model the request actually used.
 * @returns "requested → resolved" when they differ, else whichever is set, else "".
 */
export const formatModelLineage = (
  model?: string,
  resolvedModel?: string,
): string => {
  const requested = model?.trim() ?? "";
  const resolved = resolvedModel?.trim() ?? "";

  if (requested && resolved && requested !== resolved) {
    return `${requested} → ${resolved}`;
  }
  return requested || resolved;
};
