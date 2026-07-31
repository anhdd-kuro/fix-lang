import { ipcRenderer } from "electron";
import type {
  AutocompleteDayRollup,
  AutocompleteSuggestReply,
  AutocompleteSuggestRequest,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";

/**
 * Validates a day rollup crossing the preload boundary field by field.
 * Mirrors `~/features/ask/preload/ask.ts` — the shape is small enough that
 * widening any field to `unknown` would just move the crash into React.
 */
const isDayRollup = (value: unknown): value is AutocompleteDayRollup => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.date === "string" &&
    typeof record.requests === "number" &&
    // The coverage counters are what stop the renderer printing "$0.00" over a
    // day of unpriceable requests. A missing one reads as `undefined`, every
    // comparison against it is false, and the panel silently returns to
    // fabricating the zero — so they are required, not optional.
    typeof record.responses === "number" &&
    typeof record.tokenlessResponses === "number" &&
    typeof record.unpricedResponses === "number" &&
    typeof record.promptTokens === "number" &&
    typeof record.completionTokens === "number" &&
    typeof record.estimatedCostUsd === "number"
  );
};

/**
 * The suggestion string comes from a language model by way of `sanitize.ts`
 * on the main side — already cleaned there, but defence in depth is the
 * point of this boundary, so it is re-checked here before reaching React.
 */
const isSuggestReply = (value: unknown): value is AutocompleteSuggestReply => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "number") return false;
  if (record.suggestion !== null && typeof record.suggestion !== "string") {
    return false;
  }
  return true;
};

const isUsageSnapshot = (value: unknown): value is AutocompleteUsageSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isDayRollup(record.today)) return false;
  if (!isDayRollup(record.month)) return false;
  if (!Array.isArray(record.days) || !record.days.every(isDayRollup)) {
    return false;
  }
  if (typeof record.dailyCap !== "number") return false;
  return true;
};

/**
 * Zero requests, and therefore zero of everything else. Honest precisely
 * because `responses` is zero too: a rollup that reports no responses is making
 * no claim about prices or token counts, so nothing here can be read as a
 * measured zero.
 */
const emptyRollup = (): AutocompleteDayRollup => ({
  date: "",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

/**
 * A rejected `invoke` is as much a boundary failure as a malformed reply, and
 * it is the one the renderer handles worst: React sees an unhandled rejection
 * rather than a value. Main already answers rather than throwing, so reaching
 * this is a bug — but on a path that runs per keystroke, "no ghost text" beats
 * a console full of rejections.
 */
const invokeOrNull = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch {
    return null;
  }
};

export const autocompleteFeature = {
  /**
   * Requests a suggestion for the given prefix/suffix. `requestId` is echoed
   * back on success; a malformed or rejected main-process reply is dropped in
   * favor of a "no suggestion" result carrying the request's own id, so a
   * stale-reply check downstream still has a requestId to compare against.
   */
  requestAutocompleteSuggestion: async (
    request: AutocompleteSuggestRequest,
  ): Promise<AutocompleteSuggestReply> => {
    const result = await invokeOrNull("autocomplete-suggest", request);
    return isSuggestReply(result) ? result : { requestId: request.requestId, suggestion: null };
  },

  /** A malformed or rejected reply falls back to an empty, honestly-zeroed snapshot. */
  getAutocompleteUsage: async (): Promise<AutocompleteUsageSnapshot> => {
    const result = await invokeOrNull("autocomplete-usage");
    return isUsageSnapshot(result)
      ? result
      : { today: emptyRollup(), month: emptyRollup(), days: [], dailyCap: 0 };
  },
};

export type AutocompleteFeature = typeof autocompleteFeature;
