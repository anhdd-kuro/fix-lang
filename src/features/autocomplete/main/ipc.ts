/**
 * @file ipc.ts
 * @description IPC handlers for autocomplete suggestions and usage reads.
 *
 * `sessionId` is derived from `event.sender.id`, NEVER from the request
 * payload. `service.ts` keys its single-flight abort map by session id, so a
 * renderer that could supply its own value could abort another window's
 * in-flight request. `String(...)` because `sender.id` is a number and the
 * map is keyed by string.
 */
import { ipcMain } from "electron";
import { z } from "zod";
import {
  requestAutocompleteSuggestion,
  takeAutocompleteResolution,
} from "~/features/autocomplete/main/service";
import {
  AUTOCOMPLETE_SKIP_CHANNEL,
  createSkipThrottle,
  wastedSuggestionLogLevel,
} from "~/features/autocomplete/shared/autocompleteDiagnostics";
import {
  AutocompleteRendererSkipReasonSchema,
  objectLike,
} from "~/features/autocomplete/shared/autocompleteSchemas";
import { normalizeDailyCostCapUsd } from "~/features/autocomplete/shared/autocompleteSettings";
import { autocompleteUsageStore } from "~/features/autocomplete/store/autocompleteUsageStore";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { logger } from "~/main/logging/logService";
import type { AutocompleteRequest } from "~/features/autocomplete/main/service";
import type {
  AutocompleteSkipReport,
  AutocompleteWastedReason,
} from "~/features/autocomplete/shared/autocompleteDiagnostics";
import type {
  AutocompleteSuggestReply,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";

/**
 * The suggest payload, field by field. Malformed `requestId`/`prefix`/`suffix`
 * fields — and a payload that is not an object at all — fall back to values
 * that make the service's own gates (min-prefix length, cache key) a no-op
 * rather than a thrown error: a renderer bug should return "no suggestion",
 * not crash main.
 *
 * `requestId` must be FINITE, and that is not decoration. A `NaN` requestId
 * echoes back unchanged, and `NaN !== NaN` makes the renderer's staleness check
 * reject every reply — ghost text silently never appears, with no error
 * anywhere. A non-string `suffix` must not get through either: the prompt is
 * built OUTSIDE the service's try, so it would throw out of `ipcMain.handle`
 * rather than return "no suggestion".
 */
const SuggestPayloadSchema = objectLike({
  requestId: z.number().catch(0),
  prefix: z.string().catch(""),
  suffix: z.string().optional().catch(undefined),
}).catch({ requestId: 0, prefix: "", suffix: undefined });

type SuggestPayload = z.output<typeof SuggestPayloadSchema>;

/**
 * Builds the request the service sees: `sessionId` always comes from the
 * `sessionId` argument (the sender), never from the payload.
 *
 * `AutocompleteRequest` is `AutocompleteSuggestRequest & { sessionId }`, so a
 * field added to the wire request that this function forgets to validate and
 * forward fails to compile here rather than being silently dropped.
 */
const toAutocompleteRequest = (
  { requestId, prefix, suffix }: SuggestPayload,
  sessionId: string,
): AutocompleteRequest => ({ requestId, prefix, suffix, sessionId });

/**
 * A count the log can state without lying: finite, non-negative, whole.
 *
 * `-1`, `NaN` and `1e308` all satisfy `typeof === "number"` and would be
 * written verbatim into an exportable file as if measured.
 */
const CountSchema = z.number().min(0).transform(Math.floor).catch(0);

/**
 * The renderer's skip report, or a rejection.
 *
 * This is renderer input crossing a trust boundary and it ends up in
 * `userData/logs/*.jsonl`, which the user can copy and export — an
 * unvalidated field would be renderer-controlled text written into that file,
 * and an unknown `reason` would be exactly that. A bad report is DROPPED
 * rather than logged as "malformed": logging it would hand the flood back to
 * whoever sent it.
 *
 * `requestId` is never logged, only matched. An unmatched id yields no line at
 * all, so a junk value costs a dropped id rather than a fabricated one.
 */
const SkipReportSchema = objectLike({
  reason: AutocompleteRendererSkipReasonSchema,
  prefixLength: CountSchema,
  suppressedSincePrevious: CountSchema,
  requestId: z.number().optional().catch(undefined),
});

/**
 * Rebuilds the parsed report field by field. Nothing is spread: the schema
 * keeps unknown keys, and an unknown key is exactly what must not reach the log.
 */
const toSkipReport = ({
  reason,
  prefixLength,
  suppressedSincePrevious,
  requestId,
}: z.output<typeof SkipReportSchema>): AutocompleteSkipReport => {
  const report: AutocompleteSkipReport = {
    reason,
    prefixLength,
    suppressedSincePrevious,
  };
  if (requestId !== undefined) report.requestId = requestId;
  return report;
};

/** The two suppressed counts every renderer-reported line carries. */
type SuppressedCounts = {
  suppressedInRenderer: number;
  suppressedInMain: number;
};

/**
 * States that a billed suggestion arrived after the surface had moved on, and
 * names the model that was slow.
 *
 * The split of knowledge is the whole reason this function exists. Only the
 * RENDERER can tell that a reply was too late — main has no idea where the
 * caret is. Only MAIN may say which model it was: a model id sent up from the
 * renderer would be renderer-controlled text in a file the user can export,
 * which `toSkipReport` refuses everything else for. So the report carries an id
 * and main answers it from its own measurements.
 *
 * No matching record means the reply came from the cache or from a refusal —
 * no provider was called, so there is no model or latency to blame, and a line
 * without those two says nothing a user could act on. Silence is the honest
 * outcome; `takeAutocompleteResolution` also consumes the record, so a renderer
 * replaying an id cannot re-emit the line.
 *
 * The level follows the same rule as main's own wasted-suggestion lines: one
 * late reply while typing fast is ordinary, EVERY reply late is a model that
 * cannot serve this feature at all and a user who will never find out unless
 * told. Both throttles' suppressed counts feed that decision, because a repeat
 * swallowed by the renderer is just as much evidence as one swallowed here.
 */
const logLateArrival = (
  event: Electron.IpcMainEvent,
  report: AutocompleteSkipReport,
  suppressed: SuppressedCounts,
): void => {
  if (report.requestId === undefined) return;
  const resolution = takeAutocompleteResolution(
    String(event.sender.id),
    report.requestId,
  );
  if (resolution === null) return;
  const level = wastedSuggestionLogLevel(
    suppressed.suppressedInRenderer + suppressed.suppressedInMain,
  );
  logger[level](
    "autocomplete",
    "Suggestion arrived too late to be shown; the caret had already moved on",
    {
      reason: "reply-too-late" satisfies AutocompleteWastedReason,
      // The two fields that make it actionable — "which model is slow" is the
      // entire question. Both are main's own measurements.
      model: resolution.model,
      provider: resolution.provider,
      latencyMs: resolution.latencyMs,
      // The LENGTH of what was typed, never the text.
      prefixLength: report.prefixLength,
      ...suppressed,
    },
  );
};

/** Registers validated renderer access to autocomplete suggestions and usage. */
export const registerAutocompleteHandlers = (): void => {
  /**
   * Main's own throttle over renderer reports.
   *
   * The renderer throttles too, but that one only keeps traffic off the wire.
   * This is the one that protects the log file, because the renderer is
   * untrusted and a renderer stuck in a loop is the very thing these reports
   * exist to expose. Same rule at both ends: one line per reason per interval.
   *
   * Scoped to the registration rather than the module so it has no lifetime
   * beyond the handlers it belongs to — and so no test-only reset export has to
   * exist to undo module state.
   */
  const rendererSkipThrottle = createSkipThrottle();

  ipcMain.handle(
    "autocomplete-suggest",
    async (
      event: Electron.IpcMainInvokeEvent,
      raw,
    ): Promise<AutocompleteSuggestReply> => {
      const sessionId = String(event.sender.id);
      const request = toAutocompleteRequest(
        SuggestPayloadSchema.parse(raw),
        sessionId,
      );
      try {
        return await requestAutocompleteSuggestion(request);
      } catch (error) {
        // Last stop before IPC. A rejection here crosses as a rejected
        // `invoke` and lands in the renderer as an unhandled rejection once per
        // keystroke; the honest outcome of any failure on this path is no ghost
        // text. Logged rather than swallowed, so it is still findable.
        logger.warn("autocomplete", "Suggestion handler failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return { requestId: request.requestId, suggestion: null };
      }
    },
  );

  // One-way and answerless by design: the renderer is telling main something,
  // not asking. See the preload bridge for why this is `send` and not `invoke`.
  ipcMain.on(AUTOCOMPLETE_SKIP_CHANNEL, (event: Electron.IpcMainEvent, raw) => {
    const parsed = SkipReportSchema.safeParse(raw);
    if (!parsed.success) return;
    const report = toSkipReport(parsed.data);
    const decision = rendererSkipThrottle.admit(report.reason, Date.now());
    if (!decision.emit) return;
    // Two counters, because the throttles are two. The renderer's says what
    // never reached the wire; main's says what reached it and was dropped
    // here. Collapsing them would hide a renderer whose own throttle is broken.
    const suppressed = {
      suppressedInRenderer: report.suppressedSincePrevious,
      suppressedInMain: decision.suppressedSincePrevious,
    };

    if (report.reason === "reply-too-late") {
      logLateArrival(event, report, suppressed);
      return;
    }

    logger.debug(
      "autocomplete",
      "Ghost text not requested by the input window",
      {
        reason: report.reason,
        // The LENGTH of what was typed, never the text: these lines are copyable
        // and exportable, and the typed text is the payload the user has not
        // chosen to send anywhere.
        prefixLength: report.prefixLength,
        ...suppressed,
      },
    );
  });

  ipcMain.handle(
    "autocomplete-usage",
    async (): Promise<AutocompleteUsageSnapshot> => ({
      today: autocompleteUsageStore.getDay(),
      month: autocompleteUsageStore.getMonth(),
      days: autocompleteUsageStore.getDays(),
      // Read per call, from the ACTIVE profile: the cap is a profile setting,
      // so a snapshot built from a cached value would report the cap of
      // whichever profile happened to be active when this handler registered.
      dailyCostCapUsd: normalizeDailyCostCapUsd(
        getProfileSetting("settingsAutocomplete").dailyCostCapUsd,
      ),
    }),
  );
};
