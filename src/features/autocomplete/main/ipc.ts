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
import { DAILY_REQUEST_CAP, requestAutocompleteSuggestion } from "~/features/autocomplete/main/service";
import { autocompleteUsageStore } from "~/features/autocomplete/store/autocompleteUsageStore";
import { logger } from "~/main/logging/logService";
import type { AutocompleteRequest } from "~/features/autocomplete/main/service";
import type {
  AutocompleteSuggestReply,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";

/**
 * Builds the request the service sees: `sessionId` always comes from
 * `sessionId` argument (the sender), never from `raw`. Malformed
 * `requestId`/`prefix`/`suffix` fields fall back to values that make the
 * service's own gates (min-prefix length, cache key) a no-op rather than a
 * thrown error — a renderer bug should return "no suggestion", not crash main.
 *
 * `AutocompleteRequest` is `AutocompleteSuggestRequest & { sessionId }`, so a
 * field added to the wire request that this function forgets to validate and
 * forward fails to compile here rather than being silently dropped.
 */
const toAutocompleteRequest = (raw: unknown, sessionId: string): AutocompleteRequest => {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  // `Number.isFinite` is not decoration. A `NaN` requestId echoes back
  // unchanged, and `NaN !== NaN` makes the renderer's staleness check reject
  // every reply — ghost text silently never appears, with no error anywhere.
  const requestId = typeof record.requestId === "number" && Number.isFinite(record.requestId) ? record.requestId : 0;
  const prefix = typeof record.prefix === "string" ? record.prefix : "";
  // The prompt is built OUTSIDE the service's try, so a non-string suffix
  // throws out of `ipcMain.handle` rather than returning "no suggestion".
  const suffix = typeof record.suffix === "string" ? record.suffix : undefined;
  return { requestId, prefix, suffix, sessionId };
};

/** Registers validated renderer access to autocomplete suggestions and usage. */
export const registerAutocompleteHandlers = (): void => {
  ipcMain.handle(
    "autocomplete-suggest",
    async (event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<AutocompleteSuggestReply> => {
      const sessionId = String(event.sender.id);
      const request = toAutocompleteRequest(raw, sessionId);
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

  ipcMain.handle(
    "autocomplete-usage",
    async (): Promise<AutocompleteUsageSnapshot> => ({
      today: autocompleteUsageStore.getDay(),
      month: autocompleteUsageStore.getMonth(),
      days: autocompleteUsageStore.getDays(),
      dailyCap: DAILY_REQUEST_CAP,
    }),
  );
};
