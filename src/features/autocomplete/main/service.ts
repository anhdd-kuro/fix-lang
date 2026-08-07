/**
 * @file service.ts
 * @description Main-process autocomplete: single-flight, de-dup, cap, spend.
 *
 * Every guard here exists to stop the same thing — a feature that fires on
 * keystrokes turning into a request per character, and a bill to match.
 *
 * The daily cap counts ATTEMPTS, not completions: `recordDispatch` runs before
 * the provider call, `recordUsage` only when a response returns. Counting on
 * completion looked equivalent and was not — a user typing continuously has
 * every request aborted, so the counter never moved while every one of those
 * prompts was billed, and the cap could not fire in the one scenario it is
 * there for.
 *
 * Both halves share ONE timestamp, taken at entry, so a request that spans
 * midnight is booked whole on the day it was dispatched.
 *
 * Nothing here throws at the caller. This runs per keystroke behind an
 * `ipcMain.handle`, so a failure has to become "no ghost text", never a
 * rejected `invoke` the renderer reports as an unhandled rejection. The usage
 * store is the one that actually fails in the field (a synchronous disk write),
 * and it fails CLOSED on the cap path: a request that cannot be counted is not
 * sent, because an uncountable request is an uncappable one.
 *
 * Deliberately imports NEITHER `getDefaultReasoningEffort` NOR
 * `resolveReasoningEffort`. Reasoning must be the literal `"none"`: leaving it
 * undefined omits the parameter, and a reasoning-capable model's own default is
 * reasoning ON, which is both slow and expensive for a 24-token continuation.
 * `reasoning.test.ts` pins that with a source guard.
 */
import { createHash } from "node:crypto";
import { resolveAutocompleteModelRef } from "~/features/autocomplete/shared/autocompleteModel";
import { MIN_PREFIX_CHARS } from "~/features/autocomplete/shared/autocompleteWire";
import { autocompleteUsageStore } from "~/features/autocomplete/store/autocompleteUsageStore";
import {
  getCurrentProfileId,
  getDefaultModelId,
  getProfileSetting,
} from "~/features/providers/store/apiStore";
import { logger } from "~/main/logging/logService";
import { DEFAULT_ASK_PRESET_ID } from "~/prompts";
import { buildAutocompletePrompt } from "./prompt";
import { sanitizeSuggestion } from "./sanitize";
import type {
  AutocompleteSuggestReply,
  AutocompleteSuggestRequest,
} from "~/features/autocomplete/shared/autocompleteWire";
import type { ProviderId } from "~/features/providers/shared/providers";

/**
 * Re-exported so existing main-process importers keep their import path. The
 * definition lives on the wire module because the renderer gates on the same
 * threshold and cannot import this file — see the comment there.
 */
export { MIN_PREFIX_CHARS };
/** A continuation, not an essay. Latency scales with what the model emits. */
export const MAX_OUTPUT_TOKENS = 24;
/**
 * Hard stop, not configurable. The only real protection against a stuck loop
 * billing an account overnight; a user cannot raise it by accident.
 */
export const DAILY_REQUEST_CAP = 1500;
/** Long enough to cover backspace-and-retype, short enough to stay current. */
export const CACHE_TTL_MS = 30_000;
/** Bounds the cache in a long session; oldest entries are evicted first. */
export const CACHE_MAX_ENTRIES = 200;

/**
 * The wire request plus the one field main adds. Defined as an intersection
 * rather than restated field by field on purpose: a field added to
 * `AutocompleteSuggestRequest` that `main/ipc.ts` forgets to forward is then a
 * compile error there, instead of two structurally-compatible declarations
 * silently drifting apart.
 */
export type AutocompleteRequest = AutocompleteSuggestRequest & {
  /** Identifies the typing surface, so one surface aborts only its own request. */
  sessionId: string;
};

/** Same shape the renderer receives; aliased so the two cannot drift. */
export type AutocompleteResult = AutocompleteSuggestReply;

type CacheEntry = { suggestion: string | null; storedAt: number };

const inFlight = new Map<string, AbortController>();
const cache = new Map<string, CacheEntry>();
let capWarnedForDay = "";

/**
 * Which BACKEND a suggestion came from, so a cached one is never replayed
 * against a different one: the active profile id plus every configured provider
 * endpoint.
 *
 * A model ref does not identify a backend. Two profiles both set to
 * `ollama::llama3.2` can point `providerEndpoints.ollama.host` at different
 * machines — different weights, different quantization, a different system
 * entirely — and for Bedrock the endpoint IS the AWS region. None of that
 * reached the key, so within `CACHE_TTL_MS` of a profile switch the new profile
 * was served text its own backend never generated.
 *
 * Two vectors, one key. A PROFILE SWITCH changes the profile id; EDITING the
 * active provider's endpoint changes the fingerprint with no switch involved.
 * Clearing the cache at profile activation would close only the first —
 * `profileChange.ts` never runs for a settings edit — and would leave the
 * closure depending on a future activation site remembering the funnel.
 *
 * The WHOLE endpoint map, not just the ref's own provider: a bare (unprefixed)
 * ref names no provider to look up. Over-invalidating costs a few extra requests
 * right after a settings edit; under-invalidating hands the user a suggestion
 * from a backend they have already left.
 */
const backendIdentity = (): string => {
  const endpoints = getProfileSetting("providerEndpoints") ?? {};
  const fingerprint = Object.entries(endpoints)
    // Sorted: persisted key order is whatever the last writer left, and a
    // reordered map is still the same backend.
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([provider, endpoint]) => `${provider}=${endpoint?.host ?? ""}:${endpoint?.port ?? ""}`)
    .join(",");
  return `${getCurrentProfileId()}|${fingerprint}`;
};

/**
 * Keyed on the WINDOWED prompt, never on the raw prefix.
 *
 * `buildAutocompletePrompt` keeps only `PREFIX_WINDOW_CHARS` before the caret,
 * so two documents differing solely further back produce a byte-identical
 * request. Hashing the raw prefix made every such edit a guaranteed miss — a
 * fresh billed call on each keystroke in a long document — and ran sha256 over
 * the whole document on the main process to reach that wrong answer.
 *
 * `backend` is `backendIdentity()`, passed in rather than read here so this stays
 * a pure function of its arguments.
 *
 * The `\0` field delimiter is written as an ESCAPE, never as a raw 0x00 byte in
 * the source. One raw NUL makes this module binary to git: `git diff` renders
 * the whole file as `Bin`, so no reviewer, PR or release diff can read a change
 * to the feature's cost-control logic, and string-matching edit tools stop
 * matching around the line. The hashed string is identical either way.
 */
const cacheKey = (userPrompt: string, modelRef: string, backend: string): string =>
  createHash("sha256").update(`${backend}\0${modelRef}\0${userPrompt}`).digest("hex");

const readCache = (key: string, now: number): CacheEntry | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry;
};

const writeCache = (key: string, suggestion: string | null, now: number): void => {
  cache.set(key, { suggestion, storedAt: now });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};

/**
 * Cancels the in-flight request for one surface, or all of them.
 *
 * Called on profile switch: a request resolved after the switch would deliver
 * profile A's suggestion into a window now scoped to B, and the next request
 * would resolve its ref against B's providers.
 */
export const abortAutocomplete = (sessionId?: string): void => {
  if (sessionId === undefined) {
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    return;
  }
  inFlight.get(sessionId)?.abort();
  inFlight.delete(sessionId);
};

/** Test seam — the module-level caches would otherwise leak between tests. */
export const resetAutocompleteState = (): void => {
  abortAutocomplete();
  cache.clear();
  capWarnedForDay = "";
};

const askPresetModelRef = (): string => {
  const correct = getProfileSetting("settingsCorrect");
  const ask = correct?.presets?.find((preset) => preset.id === DEFAULT_ASK_PRESET_ID);
  return ask?.model ?? "";
};

const none = (requestId: number): AutocompleteResult => ({ requestId, suggestion: null });

/**
 * Describes a failure for the log WITHOUT quoting the provider.
 *
 * This path runs once per failing keystroke, and its lines are copyable and
 * exportable from the Logs tab. A Bedrock `AccessDeniedException` states the
 * AWS account id and the full IAM principal ARN in its message, and neither
 * `SENSITIVE_KEY` nor `redactLogMessage` touches either — so logging
 * `error.message` here wrote account identifiers to
 * `userData/logs/<date>/fixlang.jsonl` hundreds of times over one bad session.
 * The error's CLASS is the diagnostic ("AccessDeniedException",
 * "RateLimitError", "AuthenticationError"); its prose is the leak.
 */
const describeFailure = (error: unknown): { errorName: string; status?: number } => {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const status = (error as { status?: unknown }).status;
  return {
    errorName: error.name,
    ...(typeof status === "number" ? { status } : {}),
  };
};

/**
 * The rollup is bookkeeping; a broken rollup must not become a broken feature
 * NOR a rejected `invoke`. `electron-store` writes to disk synchronously, so a
 * full disk or a locked config file throws right here, and an unguarded throw
 * escapes into `ipcMain.handle` and reaches the renderer as an unhandled
 * rejection — once per keystroke.
 *
 * `stage` carries which step failed rather than the message doing it: the
 * pricing step reads a store too and can fail without any write having been
 * attempted, and a line claiming a failed write would misdescribe it.
 */
const usageBookkeepingFailed = (stage: string, error: unknown): void => {
  logger.warn("autocomplete", "Usage rollup step failed", {
    stage,
    ...describeFailure(error),
  });
};

/** Today's counters, or null when the store cannot be read at all. */
const readToday = (now: Date) => {
  try {
    return autocompleteUsageStore.getDay(now);
  } catch (error) {
    usageBookkeepingFailed("read", error);
    return null;
  }
};

/**
 * Counts one dispatch, reporting whether it landed.
 *
 * A request that cannot be counted must not be sent: an uncountable request is
 * an uncappable one, which is the exact hole `DAILY_REQUEST_CAP` exists to
 * close. Refusing here keeps "every dispatched request is counted" true by
 * never dispatching the one that would break it.
 */
const countDispatch = (now: Date): boolean => {
  try {
    autocompleteUsageStore.recordDispatch(now);
    return true;
  } catch (error) {
    usageBookkeepingFailed("dispatch", error);
    return false;
  }
};

export const requestAutocompleteSuggestion = async (
  request: AutocompleteRequest,
): Promise<AutocompleteResult> => {
  const { requestId, sessionId, prefix, suffix = "" } = request;
  /**
   * ONE instant for everything this request records. Reading the clock again
   * when the response came back booked a request dispatched at 23:59:59.9 and
   * answered at 00:00:00.1 across two days: yesterday held a request with no
   * spend, today held spend with no request, and `getMonth` counted one without
   * the other across a month boundary.
   */
  const now = new Date();

  const settings = getProfileSetting("settingsAutocomplete");
  if (!settings.enabled) return none(requestId);
  if (prefix.length < MIN_PREFIX_CHARS) return none(requestId);

  const today = readToday(now);
  // An unreadable counter is an unenforceable cap, so this fails CLOSED. The
  // cap is the only hard stop between a stuck loop and an overnight bill;
  // carrying on without it trades a missing suggestion for an unbounded one.
  if (!today) return none(requestId);
  if (today.requests >= DAILY_REQUEST_CAP) {
    // One line per day, not per keystroke — this path is hit on every press
    // once tripped.
    if (capWarnedForDay !== today.date) {
      capWarnedForDay = today.date;
      logger.warn("autocomplete", "Daily request cap reached; suggestions are off until tomorrow", {
        cap: DAILY_REQUEST_CAP,
        date: today.date,
      });
    }
    return none(requestId);
  }

  const modelRef = resolveAutocompleteModelRef(
    settings.model,
    askPresetModelRef(),
    getDefaultModelId(),
  );
  if (!modelRef) return none(requestId);

  const startedAt = now.getTime();
  const { systemPrompt, userPrompt } = buildAutocompletePrompt({ prefix, suffix });
  const key = cacheKey(userPrompt, modelRef, backendIdentity());
  const cached = readCache(key, startedAt);
  if (cached) {
    // Aborts BEFORE returning, unlike the `countDispatch` refusal below.
    //
    // A cache hit means the user has a suggestion in hand right now, so anything
    // still in flight for this surface is answering text they have already moved
    // past — and the provider keeps billing that request until it is cancelled.
    // Editing back to a recently cached prefix (backspace-and-retype is the
    // whole reason the cache exists) therefore used to leave an obsolete request
    // running to completion, paid for, and its reply discarded as stale.
    //
    // The refusal below returns WITHOUT aborting for the opposite reason: it has
    // no suggestion to offer, so killing the in-flight request would make room
    // for one that is never sent.
    abortAutocomplete(sessionId);
    return { requestId, suggestion: cached.suggestion };
  }

  // Counted HERE, before the call and not after it: from the dispatch on, the
  // provider has been asked, and it bills whether the answer ever reaches the
  // user. Recording on success only kept the counter at zero for a user typing
  // continuously — every request superseded, every request paid for — which is
  // the one runaway `DAILY_REQUEST_CAP` exists to stop.
  //
  // Ahead of the single-flight swap on purpose: a refused count returns without
  // having aborted the request already in flight, which would otherwise be
  // killed to make room for one that is never sent.
  if (!countDispatch(now)) return none(requestId);

  // Single-flight per surface: the previous request is now known to be stale.
  abortAutocomplete(sessionId);
  const controller = new AbortController();
  inFlight.set(sessionId, controller);

  try {
    // `makeAIRequest` is imported lazily so this module can be unit-tested
    // without pulling in the whole provider dispatch chain and its Electron
    // dependencies.
    const { makeAIRequest } = await import("~/main/ai.request/shared");
    const response = await makeAIRequest({
      systemPrompt,
      userPrompt,
      model: modelRef,
      reasoning: "none",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stop: ["\n\n"],
      abortSignal: controller.signal,
      quiet: true,
    });

    const suggestion = sanitizeSuggestion(response.content?.[0]);
    writeCache(key, suggestion, Date.now());
    await recordResponseUsage(response, now);

    // Prefix LENGTH only. `redactLogMessage` cannot help here — the typed text
    // IS the payload, and it would land in userData/logs/*.jsonl.
    logger.debug("autocomplete", "Suggestion resolved", {
      prefixLength: prefix.length,
      suffixLength: suffix.length,
      model: response.model,
      provider: response.provider,
      latencyMs: Date.now() - startedAt,
      hasSuggestion: suggestion !== null,
    });

    return { requestId, suggestion };
  } catch (error) {
    // A superseded request is the normal case, not a failure worth reporting.
    if (controller.signal.aborted) return none(requestId);
    logger.debug("autocomplete", "Suggestion failed", {
      prefixLength: prefix.length,
      latencyMs: Date.now() - startedAt,
      ...describeFailure(error),
    });
    return none(requestId);
  } finally {
    if (inFlight.get(sessionId) === controller) inFlight.delete(sessionId);
  }
};

type SpendSource = {
  model: string;
  provider: ProviderId;
  resolvedModel?: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

/**
 * What one response cost, in dollars, or `null` for "no knowable price".
 *
 * `computeCost`'s `status` is the ONLY thing separating the two zeroes it can
 * return, and they mean opposite things:
 *
 * - `"zero"` — a LOCAL provider. It reports no tokens, and its `$0` is the
 *   truth rather than a calculation, so no token gap can make it unknown.
 * - `"ok"` at zero — a PRICEABLE provider (OpenRouter, Bedrock, …) that omitted
 *   its usage block. The amount is `tokens × price` over tokens the provider
 *   never sent, so the zero is FABRICATED, not measured.
 *
 * Booking that second case as priced is how the false `$0.00` came back after
 * the coverage counters were added: the day reported `unpricedResponses: 0`
 * beside `estimatedCostUsd: 0` and the card printed "Est. $0.00" as FULL
 * coverage over spend the provider really billed. A price DERIVED from tokens
 * is only ever as knowable as those tokens, so a tokenless `"ok"` is reported
 * as `null` — the store then counts it in `unpricedResponses`, where the read
 * rules turn it into N/A or a coverage fraction instead of a number.
 *
 * The gate is on the STATUS, not on the arguments below: `computeCost`
 * coalesces missing token counts to `0` internally, so passing them through
 * uncoalesced cannot on its own stop it returning a confident zero.
 */
const resolveResponseCostUsd = async (response: SpendSource): Promise<number | null> => {
  const { buildPriceMap, computeCost } = await import("~/main/ai.request/cost");
  const { getCachedModels } = await import("~/main/ai.request/shared");
  const snapshot = computeCost(
    {
      provider: response.provider,
      model: response.model,
      resolvedModel: response.resolvedModel,
      promptTokens: response.promptTokens ?? undefined,
      completionTokens: response.completionTokens ?? undefined,
    },
    buildPriceMap(getCachedModels()),
  );
  const tokensMissing = response.promptTokens === null || response.completionTokens === null;
  return snapshot.status === "ok" && tokensMissing ? null : snapshot.estimatedCostUsd;
};

/**
 * Only ever called with a response in hand. The dispatch was already counted;
 * this adds what came back, so an aborted or failed request contributes no
 * zero-token, zero-dollar row that would read as a real measurement.
 *
 * The token nulls are passed through UNCOALESCED, and the cost null with them.
 * A local provider returns null token counts while still having a genuinely
 * known `$0`, and `computeCost` returns a null cost for anything it will not
 * price — direct OpenAI always, and any model missing from the price map. The
 * store counts each kind of gap; a `?? 0` here would erase both and print a
 * fabricated `$0.00` over a real bill.
 *
 * Pricing sits in its OWN try, and its failure books the response as unpriced
 * rather than losing it. Everything it touches can throw — two dynamic
 * `import()`s and `getCachedModels()`, which reads a store — and while that
 * throw sat outside the guard it escaped into the caller's catch, so a
 * suggestion already in hand was discarded AND the response that arrived was
 * booked as `responses: 0`, invisible to the rollup that exists to count it.
 *
 * `now` is the dispatching instant, not the arrival one, so a response that
 * lands after midnight is booked on the day whose counter already holds its
 * request.
 */
const recordResponseUsage = async (response: SpendSource, now: Date): Promise<void> => {
  let estimatedCostUsd: number | null = null;
  try {
    estimatedCostUsd = await resolveResponseCostUsd(response);
  } catch (error) {
    // An unpriceable response, not an unrecorded one: `null` is the honest
    // reading of "we could not work out what this cost".
    usageBookkeepingFailed("cost", error);
  }
  try {
    autocompleteUsageStore.recordUsage(
      {
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        estimatedCostUsd,
      },
      now,
    );
  } catch (error) {
    // Guarded separately from the dispatch write: the suggestion is already in
    // hand here, and throwing it away because a bookkeeping write failed would
    // turn a full disk into no ghost text at all.
    usageBookkeepingFailed("usage", error);
  }
};
