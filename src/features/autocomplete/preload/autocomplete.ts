import { ipcRenderer } from "electron";
import { z } from "zod";
import { AUTOCOMPLETE_SKIP_CHANNEL } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import {
  AnyNumberSchema,
  objectLike,
} from "~/features/autocomplete/shared/autocompleteSchemas";
import type { AutocompleteSkipReport } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import type {
  AutocompleteDayRollup,
  AutocompleteSuggestReply,
  AutocompleteSuggestRequest,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";

/**
 * A day rollup crossing the preload boundary, field by field — the shape is
 * small enough that widening any field would just move the crash into React.
 *
 * The coverage counters are what stop the renderer printing "$0.00" over a day
 * of unpriceable requests. A missing one reads as `undefined`, every comparison
 * against it is false, and the panel silently returns to fabricating the zero —
 * so they are required, not optional.
 */
const DayRollupSchema = objectLike({
  date: z.string(),
  requests: AnyNumberSchema,
  responses: AnyNumberSchema,
  tokenlessResponses: AnyNumberSchema,
  unpricedResponses: AnyNumberSchema,
  promptTokens: AnyNumberSchema,
  completionTokens: AnyNumberSchema,
  estimatedCostUsd: AnyNumberSchema,
});

/**
 * The suggestion string comes from a language model by way of `sanitize.ts`
 * on the main side — already cleaned there, but defence in depth is the
 * point of this boundary, so it is re-checked here before reaching React.
 */
const SuggestReplySchema = objectLike({
  requestId: AnyNumberSchema,
  suggestion: z.string().nullable(),
});

const UsageSnapshotSchema = objectLike({
  today: DayRollupSchema,
  month: DayRollupSchema,
  days: z.array(DayRollupSchema),
  dailyCostCapUsd: AnyNumberSchema,
});

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
const invokeParsed = async <Reply>(
  schema: z.ZodType<Reply>,
  channel: string,
  ...args: [request?: AutocompleteSuggestRequest]
): Promise<Reply | null> => {
  try {
    const reply = schema.safeParse(await ipcRenderer.invoke(channel, ...args));
    return reply.success ? reply.data : null;
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
    const reply = await invokeParsed(
      SuggestReplySchema,
      "autocomplete-suggest",
      request,
    );
    return reply ?? { requestId: request.requestId, suggestion: null };
  },

  /**
   * Tells main why the renderer did NOT ask for a suggestion.
   *
   * `send`, not `invoke`, and that is the whole design. The gap this closes is
   * that a renderer which never dispatches leaves main with nothing to log, so
   * "it did nothing" and "main refused" look identical from the Logs tab. But
   * the paths being reported sit on the typing route, so the report must cost
   * nothing: one-way, no round trip, no reply, no promise for the caller to
   * await or forget to catch. The renderer throttles what it sends and main
   * throttles again on arrival — the second one is the load-bearing one, since
   * a buggy renderer is precisely what this exists to diagnose.
   *
   * Also carries `reply-too-late`, which is not a non-dispatch: the request
   * went out and was billed, and the answer landed after the surface had moved
   * on. The renderer is the only side that can see that, so it is the same
   * one-way report — but it names no model, only the `requestId` main should
   * look the model up under.
   *
   * The payload carries lengths, ids and a closed-set reason, never typed text.
   * Field by field, never a spread: the caller's object is the one place a
   * future field carrying typed content could arrive from.
   */
  reportAutocompleteSkip: (report: AutocompleteSkipReport): void => {
    const payload: AutocompleteSkipReport = {
      reason: report.reason,
      prefixLength: report.prefixLength,
      suppressedSincePrevious: report.suppressedSincePrevious,
    };
    if (report.requestId !== undefined) payload.requestId = report.requestId;
    ipcRenderer.send(AUTOCOMPLETE_SKIP_CHANNEL, payload);
  },

  /** A malformed or rejected reply falls back to an empty, honestly-zeroed snapshot. */
  getAutocompleteUsage: async (): Promise<AutocompleteUsageSnapshot> => {
    const snapshot = await invokeParsed(
      UsageSnapshotSchema,
      "autocomplete-usage",
    );
    return (
      snapshot ?? {
        today: emptyRollup(),
        month: emptyRollup(),
        days: [],
        dailyCostCapUsd: 0,
      }
    );
  },
};

export type AutocompleteFeature = typeof autocompleteFeature;
