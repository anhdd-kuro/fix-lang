/**
 * @file autocompleteWire.ts
 * @description The autocomplete IPC wire contract. Read by main, preload AND
 * the renderer, so this file must stay Electron-free: no `electron` import,
 * no `~/features/providers/store/apiStore` import, nothing that resolves
 * `app.getPath` at import time.
 *
 * `AutocompleteDayRollup` is DEFINED here rather than in
 * `autocompleteUsageStore.ts`. That store module is not Electron-free (its
 * `store` getter constructs an `electron-store`), so if the renderer imported
 * the type from there, bundling the type would risk bundling the store
 * alongside it. Defining the shape here and having the store import it back
 * keeps the direction of the dependency renderer-safe. The store deliberately
 * does NOT re-export the type — a second import path would make that module a
 * discoverable route into the renderer bundle, and the failure is invisible to
 * `dev`, `test` and `lint`. Its own header forbids restoring the re-export.
 *
 * `sessionId` is deliberately absent from `AutocompleteSuggestRequest`.
 * `service.ts` keys its single-flight abort map by session, and a renderer
 * that could name its own session could abort another window's in-flight
 * request. Main derives the session id from `event.sender.id` instead — see
 * `main/ipc.ts`.
 *
 * `surface`/`appBundleId` are off this type for the same reason, with more at
 * stake: they live on `AutocompleteRequest` in `main/service.ts` so a renderer
 * cannot express them.
 */

/**
 * Fewer characters than this before the caret and no request is made.
 *
 * INCLUSIVE: a prefix of exactly this length already qualifies (the gate is
 * `< MIN_PREFIX_CHARS`), so at 3 the third keystroke is the first that can
 * dispatch.
 *
 * Three, not twelve. Twelve was chosen as a cost gate — below it a
 * continuation is guesswork, so refusing was free — but it also meant the
 * feature never fired at all for the short questions the Ask AI window mostly
 * gets. A user typing `tes` and expecting a dimmed `t` saw nothing, forever,
 * with no way to tell that from a broken feature; twelve characters is most of
 * a short question, so the ghost only ever appeared once it had stopped being
 * useful. Three is the smallest prefix a model has any chance of continuing
 * meaningfully, and it is a deliberate product choice to pay for that.
 *
 * WHAT IT COSTS, stated rather than discovered later. The threshold was doing
 * most of the rate limiting: at twelve, the first eleven keystrokes of every
 * question were free. At three, essentially the whole question is live, so
 * `GHOST_TEXT_DEBOUNCE_MS` in `~/renderer/hooks/useGhostText` is now nearly the
 * only thing between a keystroke and a billed request — it was raised in the
 * same change for exactly that reason, and lowering it re-opens this. The other
 * backstops are the day's spend cap (`settingsAutocomplete.dailyCostCapUsd`)
 * and `DAILY_REQUEST_BACKSTOP` in `main/service.ts`, which this change moves
 * from unreachable to merely unlikely.
 *
 * Lives here, not in `service.ts`, for the same reason the spend cap rides the
 * usage snapshot: the renderer gates on this threshold too, and `service.ts`
 * imports `apiStore`, `logService` and `~/prompts`, so nothing renderer-side
 * can reach it there. A hardcoded copy in a hook would go stale on the next
 * change with no compile error. `LOG_QUERY_PAGE_SIZE` in
 * `~/features/logs/shared/logging` sets the precedent. `service.ts`
 * re-exports it so existing importers keep working.
 */
export const MIN_PREFIX_CHARS = 3;

/**
 * One day's counters.
 *
 * The three "how much of this is actually known" counters exist because a
 * rollup with no way to say "unknown" has to say `0`, and `$0.00` against a day
 * of genuinely billed requests is the false zero that `cost.ts` and
 * `overviewAggregations.ts` both refuse to print. Two independent things can be
 * missing, and a single flag cannot express both:
 *
 * - a LOCAL provider (Ollama, LM Studio) returns no token counts, yet its cost
 *   is honestly known to be `$0` — tokens unknown, price known;
 * - DIRECT OpenAI returns real token counts, yet `computeCost` refuses to price
 *   its bare model ids — tokens known, price unknown.
 *
 * So the counters come in pairs against `responses`, and every one of them sums
 * cleanly, which is what makes a month that mixes the two states readable
 * rather than silently collapsed into its knowable half.
 *
 * Separate axes, but NOT independent ones. A price computed as
 * `tokens × price` is only as knowable as the tokens it came from, so a
 * PRICEABLE provider that omits its usage block is counted on BOTH axes at
 * once: tokens unknown AND price unknown. Left as tokens-only, `computeCost`
 * hands back a confident `status: "ok"` at zero over tokens the provider never
 * sent, the response lands among the priced, and the day claims full coverage
 * over a real bill — the same false `$0.00` these counters were added to stop.
 * Only a LOCAL provider's `$0` survives a token gap as a known price, because
 * it was never calculated from tokens (`computeCost` short-circuits it to
 * `status: "zero"`). `resolveResponseCostUsd` in `main/service.ts` owns that
 * distinction; the reading rules below are untouched by it.
 *
 * Reading it (this is the whole contract, no heuristics needed):
 *
 * - `requests === 0` — nothing happened. A genuine zero; render it as `0`.
 * - `unpricedResponses === 0 && responses > 0` — every price is known.
 *   `estimatedCostUsd` is the whole truth.
 * - `unpricedResponses === responses` — no price is known. Render N/A, NEVER a
 *   number, however tempting the `0` sitting in `estimatedCostUsd` looks.
 * - `0 < unpricedResponses < responses` — part known, part not. Render the
 *   amount AND say how much of it is covered; reporting the known part alone is
 *   another false number.
 *
 * `tokenlessResponses` reads the same way against `promptTokens` /
 * `completionTokens`.
 *
 * The cost triple maps 1:1 onto `CostSum` in `~/renderer/analytics/shared`, so
 * the renderer can hand it straight to `resolveOverviewCostHint` and inherit
 * the none/na/amount/partial rendering the Overview card already uses:
 * `{ totalUsd: estimatedCostUsd, pricedCount: responses - unpricedResponses,
 *    total: responses, hasNa: unpricedResponses > 0 }`.
 */
export type AutocompleteDayRollup = {
  /** `YYYY-MM-DD` in local time, matching how the user reads "today". */
  date: string;
  /**
   * Requests DISPATCHED to a provider — attempts, not completions. A request
   * superseded a keystroke later was still asked for and still billed, and the
   * daily cap counts these.
   */
  requests: number;
  /** Of `requests`, how many came back. The rest aborted or failed. */
  responses: number;
  /** Of `responses`, how many reported incomplete token counts. */
  tokenlessResponses: number;
  /** Of `responses`, how many carried no knowable price. */
  unpricedResponses: number;
  /** Summed over the responses that reported them; see `tokenlessResponses`. */
  promptTokens: number;
  completionTokens: number;
  /**
   * Summed over PRICED responses only. Meaningless on its own — always read it
   * next to `unpricedResponses`, which says how much of the day it covers.
   *
   * That is an invariant, not a description, and the sums must agree with the
   * counters on the SAME day: money here that no `responses - unpricedResponses`
   * can account for reappears as a real number the moment the day is summed with
   * another. Summing breaks the `unpricedResponses === responses` equality that
   * makes a lone all-unknown day render as N/A, so a month reads the leftover
   * amount as "amount plus coverage" and prints it behind a coverage badge that
   * disowns it. A day migrated from before these counters therefore carries
   * `0` in all three sums — no priced responses, so no money, and the same for
   * the token pair (`normalizeRollup` in `~/features/autocomplete/store/autocompleteUsageStore`).
   */
  estimatedCostUsd: number;
};

export type AutocompleteSuggestRequest = {
  /** Monotonic per surface; echoed back so the renderer can drop stale replies. */
  requestId: number;
  prefix: string;
  suffix?: string;
};

export type AutocompleteSuggestReply = {
  requestId: number;
  suggestion: string | null;
};

export type AutocompleteUsageSnapshot = {
  today: AutocompleteDayRollup;
  month: AutocompleteDayRollup;
  /** Newest first, at most 62 (`RETAINED_DAYS` in `autocompleteUsageStore.ts`). */
  days: AutocompleteDayRollup[];
  /**
   * The active profile's `settingsAutocomplete.dailyCostCapUsd`, so no UI
   * hardcodes it.
   *
   * A BUDGET in dollars, and deliberately not the request backstop it replaced.
   * Compare it against `today.estimatedCostUsd` — which means the comparison
   * inherits that field's coverage rule: with `unpricedResponses > 0` the spend
   * is a LOWER BOUND, so a readout must say how much of the day it covers
   * rather than presenting the ratio as complete. `DAILY_REQUEST_BACKSTOP` in
   * `main/service.ts` is the separate runaway stop and is not on the wire: it is
   * set beyond what any human typing can reach, so surfacing it as a second
   * progress bar would only imply a budget it is not.
   */
  dailyCostCapUsd: number;
};
