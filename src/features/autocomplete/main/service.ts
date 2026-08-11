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
 * Guards come in three kinds and all three are needed. The BUDGET is
 * `settingsAutocomplete.dailyCostCapUsd` — how much a day may cost, in dollars,
 * chosen by the user. `DAILY_REQUEST_BACKSTOP` is the RUNAWAY stop, because a
 * dollar budget is blind to a local or unpriced provider that bills nothing it
 * can see. The short-window limiter below is the RATE — how fast either may be
 * spent, which is the part the renderer used to decide on its own with nothing
 * but a debounce.
 *
 * EVERY refusal states why. Seven paths here decline to call a provider and five
 * of them used to do it in silence, so "autocomplete does nothing" produced no
 * evidence of any kind — not even enough to tell a disabled feature from an
 * unconfigured model. Each now emits one line carrying a stable `reason`,
 * throttled per reason (see `autocompleteDiagnostics.ts`), and none of them
 * carries typed text: lengths and counts only, because these lines are copyable
 * and exportable from the Logs tab and the typed text is the whole payload the
 * user has not chosen to send anywhere.
 *
 * THE REPLY IS JSON, and that is a safety property rather than a formatting
 * preference. `parseReply.ts` accepts `{"suggestion":"…"}` and nothing else, so
 * a model that answers with refusal prose ("Nothing to continue here as the
 * input text …") produces NO suggestion instead of painting that sentence as
 * ghost text a Tab press away from the user's own question. Nothing that fails
 * to parse reaches the UI, ever — which is why an unparseable reply is a `warn`,
 * and which is now the ONLY thing bounding what a reply may contain: the request
 * carries no output-token ceiling, only a prompt asking for one short sentence.
 *
 * Deliberately imports NEITHER `getDefaultReasoningEffort` NOR
 * `resolveReasoningEffort`. Reasoning must be the literal `"none"`: leaving it
 * undefined omits the parameter, and a reasoning-capable model's own default is
 * reasoning ON, which is both slow and expensive for a 24-token continuation.
 * `reasoning.test.ts` pins that with a source guard.
 */
import { createHash } from "node:crypto";
import {
  createSkipThrottle,
  wastedSuggestionLogLevel,
} from "~/features/autocomplete/shared/autocompleteDiagnostics";
import { resolveAutocompleteModelRef } from "~/features/autocomplete/shared/autocompleteModel";
import { normalizeDailyCostCapUsd } from "~/features/autocomplete/shared/autocompleteSettings";
import { MIN_PREFIX_CHARS } from "~/features/autocomplete/shared/autocompleteWire";
import { autocompleteUsageStore } from "~/features/autocomplete/store/autocompleteUsageStore";
import {
  getCurrentProfileId,
  getDefaultModelId,
  getProfileSetting,
} from "~/features/providers/store/apiStore";
import { logger } from "~/main/logging/logService";
import { DEFAULT_ASK_PRESET_ID } from "~/prompts";
import { parseAutocompleteReply } from "./parseReply";
import { buildAutocompletePrompt } from "./prompt";
import { sanitizeSuggestion } from "./sanitize";
import type { AutocompleteAskContext } from "./prompt";
import type { AutocompleteWastedReason } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import type {
  AutocompleteDayRollup,
  AutocompleteSuggestReply,
  AutocompleteSuggestRequest,
} from "~/features/autocomplete/shared/autocompleteWire";
import type { LogContext, LogLevel } from "~/features/logs/shared/logging";
import type { ProviderId } from "~/features/providers/shared/providers";

/**
 * Re-exported so existing main-process importers keep their import path. The
 * definition lives on the wire module because the renderer gates on the same
 * threshold and cannot import this file — see the comment there.
 */
export { MIN_PREFIX_CHARS };
/**
 * THE RUNAWAY STOP, and why a money cap cannot be the only one.
 *
 * `settingsAutocomplete.dailyCostCapUsd` is the BUDGET, and it is the right
 * thing to show a user: dollars are what they actually care about. But it is
 * computed from `estimatedCostUsd`, which sums PRICED responses only, so there
 * are two whole classes of request it cannot see:
 *
 * - a LOCAL provider (Ollama, LM Studio) costs a genuine `$0` — the privacy
 *   hint in Settings recommends exactly these — so a stuck loop against Ollama
 *   would never move the budget by a cent and would never be stopped by it;
 * - a provider whose model `computeCost` refuses to price (direct OpenAI's bare
 *   model ids, most obviously) bills real money and records `$0`, counted in
 *   `unpricedResponses`. Money is leaving and the budget reads empty.
 *
 * It is also TRAILING even when it does work: spend is booked when a reply
 * lands, so the request that crosses the line is already paid for.
 *
 * Hence this: a hard per-day ceiling on DISPATCHES, not configurable, and set
 * far beyond what a human can reach so it is a runaway stop rather than a
 * second budget. The trailing debounce caps a correct surface at ~3.33
 * dispatches a second, so 10,000 is around fifty minutes of literally
 * uninterrupted typing into one small input window — a number no real session
 * produces and a stuck loop reaches in under half an hour.
 */
export const DAILY_REQUEST_BACKSTOP = 10_000;
/** Long enough to cover backspace-and-retype, short enough to stay current. */
export const CACHE_TTL_MS = 30_000;
/** Bounds the cache in a long session; oldest entries are evicted first. */
export const CACHE_MAX_ENTRIES = 200;
/**
 * How many surfaces' last provider round trip are remembered for the
 * late-arrival line. One Ask input window exists at a time and `sessionId` is a
 * `webContents.id` that increments per window, so this only has to outlive the
 * IPC hop between a reply and the renderer's report about it — but it is
 * bounded anyway, because an unbounded map keyed by an ever-increasing id is a
 * leak that would never show up in a test.
 */
export const RESOLUTION_MEMORY_MAX_ENTRIES = 8;

/**
 * THE SHORT-WINDOW BACKSTOP, and why main has to own one.
 *
 * Everything between one keystroke and the daily stops used to be enforced
 * in the renderer: `GHOST_TEXT_DEBOUNCE_MS` is the only short-interval limiter
 * and it lives in `useGhostText.ts`. `sessionId` is derived from
 * `event.sender.id` precisely BECAUSE the renderer is not trusted — yet the
 * RATE was entirely at its discretion. A stuck effect, a wedged IME, or a
 * future surface with a bug could call `autocomplete-suggest` in a tight loop
 * and main would dispatch every one until the daily cap tripped; at machine
 * speed 1500 dispatches is a couple of minutes, and every one is billed.
 *
 * THE ARITHMETIC, and it starts from a ceiling rather than from a guess. The
 * debounce is TRAILING and rearms on every change, so a correctly-working
 * surface cannot dispatch faster than one request per `GHOST_TEXT_DEBOUNCE_MS`
 * — 1000/300 = 3.33 per second, so at most FOUR can land in any one-second
 * window. That bound is reached by the worst LEGITIMATE case, which is not a
 * fast typist (whose keystrokes coalesce into fewer dispatches, each one
 * rearming the debounce) but a steady ~40 WPM one whose gaps sit just above
 * 300 ms, so every character dispatches. Real typing is jittery and much of it
 * hits the cache, so an ordinary question costs a handful.
 *
 * 10 per surface per second is 2.5x that ceiling. No correctly-working renderer
 * can reach it however the human types, which is the property that matters: a
 * limit a real user can trip is a bug, not a guard. A loop runs at thousands
 * per second and trips it inside the first ten requests.
 *
 * A ONE-SECOND window, not a longer one at the same rate. The window is also
 * the detection delay and the burst size: a wedged renderer gets ten requests
 * before it is refused and a warn is written, instead of sixty. Nothing legit
 * needs the smoothing a longer window would buy, because the debounce has
 * already smoothed it.
 *
 * WHY BOTH SCOPES. Per-session alone does not bound spend: one composer window
 * more (already planned) and the ceiling doubles, and the session map below is
 * evicted, so a caller that could churn `webContents` ids could drop its own
 * counter and start clean. The global window is never evicted and never keyed
 * by anything the renderer influences, which closes both. 16 is four surfaces
 * at the ceiling, and — the part that matters — it is more than one surface
 * spending its ENTIRE allowance (10) plus another typing flat out (4), so a
 * runaway in one window cannot starve a second window's real user.
 *
 * This is a RATE guard, not a budget one. `settingsAutocomplete.dailyCostCapUsd`
 * remains the money stop and `DAILY_REQUEST_BACKSTOP` the runaway one; this
 * bounds how fast either can be spent and — via the `warn` it emits — is the
 * only thing that says a loop is happening WHILE it happens rather than after.
 */
export const RATE_LIMIT_WINDOW_MS = 1_000;
/** Dispatches one typing surface may make per window. See the arithmetic above. */
export const RATE_LIMIT_PER_SESSION = 10;
/** Dispatches ALL surfaces may make per window; not evictable, so not evadable. */
export const RATE_LIMIT_GLOBAL = 16;
/**
 * How many surfaces' windows are remembered. Bounded for the same reason as
 * `RESOLUTION_MEMORY_MAX_ENTRIES`: `sessionId` is a `webContents.id` that only
 * increases, so an unbounded map keyed by it is a leak no test would reveal.
 * Eviction is least-recently-used, so the surface currently spending is the one
 * entry that can never be dropped — and the global window backstops the rest.
 */
export const RATE_LIMIT_MEMORY_MAX_ENTRIES = 8;

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

/** A fixed window and what has been spent inside it. */
type RateWindow = { startedAt: number; dispatches: number };

const sessionWindows = new Map<string, RateWindow>();
let globalWindow: RateWindow = { startedAt: 0, dispatches: 0 };

/**
 * This surface's window, kept in least-recently-used order.
 *
 * Re-inserting on every read is what makes the eviction below drop the surface
 * that has been quiet longest rather than an arbitrary one: a surface in a loop
 * is by definition the most recent, so it can never evict its own counter. That
 * is the whole reason the map is safe to bound at all.
 */
const sessionWindow = (sessionId: string): RateWindow => {
  const existing = sessionWindows.get(sessionId);
  if (existing) {
    sessionWindows.delete(sessionId);
    sessionWindows.set(sessionId, existing);
    return existing;
  }
  // `startedAt: 0` reads as "expired", so the first dispatch opens the window.
  const created: RateWindow = { startedAt: 0, dispatches: 0 };
  sessionWindows.set(sessionId, created);
  while (sessionWindows.size > RATE_LIMIT_MEMORY_MAX_ENTRIES) {
    const oldest = sessionWindows.keys().next();
    if (oldest.done) break;
    sessionWindows.delete(oldest.value);
  }
  return created;
};

const rollExpiredWindow = (state: RateWindow, nowMs: number): void => {
  // A clock that moved BACKWARD (NTP correction, the user setting the date)
  // makes the elapsed time negative, which reads as "not expired yet" — so the
  // window would stay shut until real time caught up, and an hour's jump would
  // silently disable the feature for an hour. A window that starts in the
  // future is not a window; it is restarted.
  const elapsed = nowMs - state.startedAt;
  if (elapsed >= 0 && elapsed < RATE_LIMIT_WINDOW_MS) return;
  state.startedAt = nowMs;
  state.dispatches = 0;
};

type RateLimitDecision =
  | { admitted: true }
  | {
      admitted: false;
      /** Which of the two limits refused — the session's or everyone's. */
      limitScope: "session" | "global";
      limit: number;
      dispatchesInWindow: number;
    };

/**
 * Spends one dispatch from both windows, or refuses and spends nothing.
 *
 * BOTH windows are checked before EITHER is charged. Charging the session and
 * then discovering the global window is full would bill a surface for a request
 * that never went out, so a refusal at one scope would slowly starve the other —
 * a limiter that tightens itself under load is a limiter nobody can reason about.
 *
 * Counts INTENTS to dispatch. The only thing that can follow an admission and
 * still not reach a provider is `countDispatch` failing, which means the usage
 * store is unwritable and the feature is already off; erring toward the guard
 * there is the right direction for a backstop.
 */
const admitDispatch = (sessionId: string, nowMs: number): RateLimitDecision => {
  const session = sessionWindow(sessionId);
  rollExpiredWindow(session, nowMs);
  rollExpiredWindow(globalWindow, nowMs);

  if (session.dispatches >= RATE_LIMIT_PER_SESSION) {
    return {
      admitted: false,
      limitScope: "session",
      limit: RATE_LIMIT_PER_SESSION,
      dispatchesInWindow: session.dispatches,
    };
  }
  if (globalWindow.dispatches >= RATE_LIMIT_GLOBAL) {
    return {
      admitted: false,
      limitScope: "global",
      limit: RATE_LIMIT_GLOBAL,
      dispatchesInWindow: globalWindow.dispatches,
    };
  }

  session.dispatches += 1;
  globalWindow.dispatches += 1;
  return { admitted: true };
};

/**
 * What one surface's last provider round trip actually was.
 *
 * Exists for one reason: the renderer is the only side that can tell a
 * suggestion arrived too late (main knows nothing about the caret), and main is
 * the only side that may name the model that was slow. A model id sent UP from
 * the renderer would be renderer-controlled text written into an exportable log
 * file, which `main/ipc.ts` rejects everything else for. So the renderer sends
 * back a `requestId` and nothing else, and these are main's own measurements,
 * looked up by that id.
 */
export type AutocompleteResolution = {
  requestId: number;
  /** As the provider reported it — the same value the resolved line logs. */
  model: string;
  provider: ProviderId;
  latencyMs: number;
};

const lastResolutions = new Map<string, AutocompleteResolution>();

const rememberResolution = (sessionId: string, resolution: AutocompleteResolution): void => {
  lastResolutions.set(sessionId, resolution);
  while (lastResolutions.size > RESOLUTION_MEMORY_MAX_ENTRIES) {
    const oldest = lastResolutions.keys().next();
    if (oldest.done) break;
    lastResolutions.delete(oldest.value);
  }
};

/**
 * The measurements behind one reply, consumed by the read.
 *
 * TAKE, not get. A reply can be reported late at most once, so leaving the
 * record in place would only let a renderer replay the same `requestId` to
 * re-emit the line.
 *
 * `null` when the id does not match, which is the honest answer for the two
 * cases that produce one: a cache hit or a refusal (no provider was called, so
 * there is no model or latency to blame), and a reply superseded by a newer
 * resolution before the report arrived (whose own lateness is reported in its
 * turn). The caller says nothing rather than logging a line it cannot make
 * actionable.
 */
export const takeAutocompleteResolution = (
  sessionId: string,
  requestId: number,
): AutocompleteResolution | null => {
  const resolution = lastResolutions.get(sessionId);
  if (!resolution || resolution.requestId !== requestId) return null;
  lastResolutions.delete(sessionId);
  return resolution;
};

/**
 * What one Ask window's press resolved, as the prompt needs to see it.
 *
 * Both halves are OPTIONAL and travel together because they are resolved
 * together, once, by the same press: a window with a selection attached but no
 * readable environment is as ordinary as the reverse. One entry per window
 * rather than two parallel maps keyed identically — the lifecycle is shared
 * (both are replaced on a press and dropped when the ask ends), and two maps
 * with one lifecycle is how one of them comes to be forgotten.
 */
export type AutocompleteAskSession = {
  /** The passage the input window is showing in its card. */
  context?: AutocompleteAskContext;
  /**
   * The directive block `askEnvironment.ts` rendered for this press — locale,
   * keyboard, press time, recent preset names. The SAME string the request
   * carries and the window shows, never a second rendering of it.
   */
  environment?: string;
};

const askSessions = new Map<string, AutocompleteAskSession>();

/**
 * WHY THE PRESS'S CONTEXT TRAVELS THROUGH HERE AND NOT OVER THE WIRE.
 *
 * The Ask input window shows the user a card holding their selection (or their
 * clipboard), and a continuation written without it cannot know what the question
 * is about. Main ALREADY has that text — `showAskInputWindow` is handed it — so
 * the renderer is asked for nothing. Three reasons, and the first is the same one
 * `sessionId` exists for: the renderer is untrusted, and a context field on
 * `AutocompleteSuggestRequest` would be renderer-controlled text going straight
 * into a provider prompt. The second is that `autocompleteWire.ts` deliberately
 * keeps `sessionId` off the wire for exactly that reason, and a context field
 * would reopen it. The third is cost: the whole selection would cross IPC on
 * every keystroke to be re-windowed to the same 400 characters each time.
 *
 * All three apply verbatim to the environment block beside it, which is
 * additionally a thing the renderer has no way to resolve at all.
 *
 * Keyed by the window's `webContents.id`, which is the string
 * `autocomplete-suggest` derives its `sessionId` from — so the lookup below needs
 * nothing the request does not already carry.
 *
 * Bounded, and LRU like `lastResolutions`. The Ask input window is a singleton
 * today, so at most one entry is ever live; the bound is here because the key is
 * an ever-increasing `webContents.id` and an unbounded map keyed by one is a leak
 * no test would show.
 */
export const ASK_CONTEXT_MEMORY_MAX_ENTRIES = 8;

/**
 * Records what one Ask window's press resolved, REPLACING whatever it had.
 *
 * Replaced wholesale rather than merged, because a context that outlived its
 * press is the failure the `From clipboard` label exists to make visible — and
 * here it would be invisible: the next question's ghost text would be computed
 * against the previous question's selection with nothing on screen saying so.
 * A press that attaches nothing therefore passes a session with no `context`,
 * which clears the previous one by replacement rather than by a second call.
 */
export const rememberAskSession = (
  sessionId: string,
  session: AutocompleteAskSession,
): void => {
  askSessions.delete(sessionId);
  askSessions.set(sessionId, session);
  while (askSessions.size > ASK_CONTEXT_MEMORY_MAX_ENTRIES) {
    const oldest = askSessions.keys().next();
    if (oldest.done) break;
    askSessions.delete(oldest.value);
  }
};

/**
 * Drops one window's whole press record, called when the ask ends — and when a
 * press resolved nothing at all to carry.
 */
export const forgetAskSession = (sessionId: string): void => {
  askSessions.delete(sessionId);
};

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
 * The ATTACHED ASK CONTEXT needs no field of its own precisely because it lives
 * in that prompt: the same half-typed question asked over a different selection
 * hashes differently, and a bare question hashes exactly as it did before
 * contexts existed. Splicing the passage in downstream of this call would have
 * required remembering to add it here too, and forgetting would have served one
 * selection's suggestion over another for `CACHE_TTL_MS`.
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
  lastResolutions.clear();
  askSessions.clear();
  sessionWindows.clear();
  globalWindow = { startedAt: 0, dispatches: 0 };
  capWarnedForDay = "";
  skipThrottle.reset();
  wastedThrottle.reset();
};

const askPresetModelRef = (): string => {
  const correct = getProfileSetting("settingsCorrect");
  const ask = correct?.presets?.find((preset) => preset.id === DEFAULT_ASK_PRESET_ID);
  return ask?.model ?? "";
};

const none = (requestId: number): AutocompleteResult => ({ requestId, suggestion: null });

/**
 * Why no provider call was made. Stable tokens, not prose: the message beside
 * them is for a human reading the Logs tab, `reason` is what a bug report can be
 * grepped for and what a future assertion can pin.
 *
 * Every one of these paths used to return in silence, so a user whose ghost text
 * never appeared had nothing at all to look at — not even the difference between
 * "the feature is off" and "nothing in this profile names a model".
 */
export type AutocompleteSkipReason =
  | "disabled"
  | "prefix-too-short"
  | "usage-unreadable"
  | "cap-reached"
  | "request-backstop"
  | "no-model"
  | "cache-hit"
  | "rate-limited";

/**
 * Level and wording per reason, in one table so neither can drift from the
 * token beside it.
 *
 * The level split is deliberate. A user-chosen state or an ordinary operation
 * (`disabled`, `prefix-too-short`, `cache-hit`) is routine and belongs at
 * `debug`. `no-model` and `usage-unreadable` are the two that silently kill the
 * feature with nothing on screen to say so and nothing the user could guess —
 * they are `warn`, because being told is the only way they get fixed.
 *
 * `cap-reached` is absent on purpose: it already had a line, throttled to one
 * per day rather than by the interval below, and that behaviour is kept exactly
 * as it was. It gains only the machine-readable `reason` the others now carry.
 */
const SKIP_LINES: Record<
  Exclude<AutocompleteSkipReason, "cap-reached">,
  { level: Extract<LogLevel, "debug" | "warn">; message: string }
> = {
  disabled: {
    level: "debug",
    message: "Suggestion skipped: autocomplete is off for this profile",
  },
  "prefix-too-short": {
    level: "debug",
    message: "Suggestion skipped: not enough text before the caret yet",
  },
  "usage-unreadable": {
    level: "warn",
    message:
      "Suggestion skipped: the daily usage counter could not be read, so the request cap cannot be enforced",
  },
  "no-model": {
    level: "warn",
    message:
      "Suggestion skipped: no model is configured for autocomplete, for the Ask AI preset, or as the profile default",
  },
  "cache-hit": {
    level: "debug",
    message: "Suggestion served from cache; no request made",
  },
  /**
   * `warn`, alongside the two that kill the feature silently, and for a
   * stronger reason than either: this one is UNREACHABLE by a correctly-working
   * renderer. The trailing debounce caps a real surface at ~34 dispatches per
   * window and the limit is 60, so a line here is our own bug or something
   * pathological — never a state a user can type their way into. Logged at
   * `debug` it would sit in a level most readers filter out, which is the one
   * place a runaway must not hide.
   */
  "rate-limited": {
    level: "warn",
    message:
      "Suggestion skipped: too many requests in a short window, which no normal typing can produce",
  },
  /**
   * `warn`, and for the same reason as `rate-limited`: a human cannot type their
   * way to `DAILY_REQUEST_BACKSTOP`, so a line here is a runaway — and one the
   * money cap could not see, since it is only ever reached when the day's spend
   * stayed under budget the whole way (a local or unpriced provider). That is
   * precisely the case with nothing else to report it.
   */
  "request-backstop": {
    level: "warn",
    message:
      "Suggestion skipped: the daily request backstop was reached, which no normal typing can produce",
  },
};

const skipThrottle = createSkipThrottle();

/**
 * States a refusal at most once per reason per interval.
 *
 * Unthrottled this would write a line per request on the typing path — the
 * `capWarnedForDay` gate below is the same idea, and the reason it exists.
 * `suppressedSincePrevious` rides the next line so a swallowed run is still
 * countable rather than invisible.
 */
const logSkip = (
  reason: Exclude<AutocompleteSkipReason, "cap-reached">,
  nowMs: number,
  context: LogContext = {},
): void => {
  const decision = skipThrottle.admit(reason, nowMs);
  if (!decision.emit) return;
  const { level, message } = SKIP_LINES[reason];
  logger[level]("autocomplete", message, {
    reason,
    suppressedSincePrevious: decision.suppressedSincePrevious,
    ...context,
  });
};

/**
 * Separate from `skipThrottle` because it counts a different thing: those
 * reasons mean no request was made, these mean one was made and paid for and
 * reached nobody. Sharing a bucket map would still work, but the level rule
 * below applies only to these, and a reader tracing a `warn` should not have to
 * work out which half of a mixed table produced it.
 */
const wastedThrottle = createSkipThrottle();

/**
 * States that a dispatched suggestion reached nobody, at most once per reason
 * per interval.
 *
 * `debug` for a one-off, `warn` once it recurs — see `wastedSuggestionLogLevel`.
 * The model is the whole point of the line: "which model is slow" is the only
 * question a user can act on, and it is the one thing a missing ghost cannot
 * tell them.
 */
const logWastedSuggestion = (
  reason: AutocompleteWastedReason,
  message: string,
  nowMs: number,
  context: LogContext,
): void => {
  const decision = wastedThrottle.admit(reason, nowMs);
  if (!decision.emit) return;
  logger[wastedSuggestionLogLevel(decision.suppressedSincePrevious)]("autocomplete", message, {
    reason,
    suppressedSincePrevious: decision.suppressedSincePrevious,
    ...context,
  });
};

/**
 * States that a reply came back and was not the JSON contract.
 *
 * `warn` ON THE FIRST OCCURRENCE, which is why this does not go through
 * `wastedSuggestionLogLevel` like the two timing reasons do. That rule starts at
 * `debug` because ONE superseded or late suggestion is ordinary fast typing and
 * costs the user nothing they would notice. There is no ordinary version of
 * this: a model either answers in the contract or it does not, and one that does
 * not will fail on every request for as long as it stays selected. It is also
 * invisible from the UI, which shows the same empty space it shows for a model
 * with genuinely nothing to suggest — so `debug`, a level most readers filter
 * out, is the one place "the model is emitting garbage" must not hide.
 *
 * Throttled on the same `wastedThrottle` as the other two: a broken model
 * produces this on EVERY keystroke, and an unthrottled warn per keypress is the
 * flood the throttle exists for.
 */
const logUnparseableReply = (nowMs: number, context: LogContext): void => {
  const decision = wastedThrottle.admit("unparseable-reply", nowMs);
  if (!decision.emit) return;
  logger.warn(
    "autocomplete",
    "Suggestion discarded: the model's reply was not the expected JSON, so nothing could be shown",
    {
      reason: "unparseable-reply" satisfies AutocompleteWastedReason,
      suppressedSincePrevious: decision.suppressedSincePrevious,
      ...context,
    },
  );
};

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

/**
 * Today's counters, or the failure that stopped them being read.
 *
 * The failure is HANDED BACK rather than logged here, unlike the other
 * bookkeeping stages. This one runs on every request, so a persistently
 * unreadable store logged from inside this function wrote an unthrottled warn
 * per request — and a second line beside the throttled `usage-unreadable` skip
 * the caller emits, saying the same thing twice. The caller owns the line.
 */
const readToday = (
  now: Date,
): { day: AutocompleteDayRollup | null; failure?: ReturnType<typeof describeFailure> } => {
  try {
    return { day: autocompleteUsageStore.getDay(now) };
  } catch (error) {
    return { day: null, failure: describeFailure(error) };
  }
};

/**
 * Counts one dispatch, reporting whether it landed.
 *
 * A request that cannot be counted must not be sent: an uncountable request is
 * an uncappable one, which is the exact hole the daily stops exist to
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
  const startedAt = now.getTime();

  const settings = getProfileSetting("settingsAutocomplete");
  if (!settings.enabled) {
    logSkip("disabled", startedAt);
    return none(requestId);
  }
  if (prefix.length < MIN_PREFIX_CHARS) {
    // The LENGTH, never the text — see the resolved-suggestion line below.
    logSkip("prefix-too-short", startedAt, {
      prefixLength: prefix.length,
      minPrefixChars: MIN_PREFIX_CHARS,
    });
    return none(requestId);
  }

  const { day: today, failure: todayFailure } = readToday(now);
  // An unreadable counter is an unenforceable cap, so this fails CLOSED. The
  // cap is the only hard stop between a stuck loop and an overnight bill;
  // carrying on without it trades a missing suggestion for an unbounded one.
  //
  // Which means a store the user cannot see turns the whole feature off, with
  // nothing on screen to say so. Hence `warn`, and hence the error's class
  // alongside it — that is the difference between "the disk is full" and "the
  // config file is corrupt", and neither is guessable from a missing ghost.
  if (!today) {
    logSkip("usage-unreadable", startedAt, { stage: "read", ...todayFailure });
    return none(requestId);
  }
  // THE BUDGET. Compared against the day's PRICED spend, so it fires only where
  // a price is knowable — see `DAILY_REQUEST_BACKSTOP` above for what it cannot
  // see, and why that is a separate guard rather than a bigger number here.
  //
  // `>=`, so a cap of `0` refuses from the first request: a user who set zero
  // meant "spend nothing", and that reading has to hold before any spend exists.
  const dailyCostCapUsd = normalizeDailyCostCapUsd(settings.dailyCostCapUsd);
  if (today.estimatedCostUsd >= dailyCostCapUsd) {
    // One line per day, not per keystroke — this path is hit on every press
    // once tripped.
    if (capWarnedForDay !== today.date) {
      capWarnedForDay = today.date;
      logger.warn("autocomplete", "Daily spend cap reached; suggestions are off until tomorrow", {
        reason: "cap-reached" satisfies AutocompleteSkipReason,
        capUsd: dailyCostCapUsd,
        spentUsd: today.estimatedCostUsd,
        // What the amount above does NOT cover. A day whose responses are all
        // unpriced trips this only at a cap of zero, and a reader deserves to
        // see that rather than infer it.
        pricedResponses: today.responses - today.unpricedResponses,
        responses: today.responses,
        date: today.date,
      });
    }
    return none(requestId);
  }
  if (today.requests >= DAILY_REQUEST_BACKSTOP) {
    logSkip("request-backstop", startedAt, {
      backstop: DAILY_REQUEST_BACKSTOP,
      requests: today.requests,
      date: today.date,
    });
    return none(requestId);
  }

  const modelRef = resolveAutocompleteModelRef(
    settings.model,
    askPresetModelRef(),
    getDefaultModelId(),
  );
  // Reaching here means all THREE sources resolved empty, so there is no
  // "which one" to report — the actionable fact is the list of places that were
  // looked at, which is exactly the list of settings that would fix it.
  if (!modelRef) {
    logSkip("no-model", startedAt, {
      checkedSources: ["settingsAutocomplete.model", "askPreset.model", "profileDefaultModel"],
    });
    return none(requestId);
  }

  // The attached context and the press's environment block are part of the
  // PROMPT, never of the system prompt: the system prompt is the short, stable,
  // cacheable prefix, and a per-press passage in it would change on every ask.
  // Carrying them in the user prompt also means `cacheKey` picks them up for
  // free — the key is hashed from that exact string, so two identical questions
  // asked over different selections (or in different keyboard layouts, or hours
  // apart) cannot be served each other's suggestion.
  //
  // Read ONCE, into a local. Dismissing the window forgets the session while a
  // request may still be in flight, so a second read at logging time could
  // report a length with no source beside it.
  const askSession = askSessions.get(sessionId);
  const askContext = askSession?.context;
  const { systemPrompt, userPrompt, contextLength, environmentLength } =
    buildAutocompletePrompt({
      prefix,
      suffix,
      context: askContext,
      environment: askSession?.environment,
    });
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
    logSkip("cache-hit", startedAt, {
      prefixLength: prefix.length,
      suffixLength: suffix.length,
      hasSuggestion: cached.suggestion !== null,
    });
    return { requestId, suggestion: cached.suggestion };
  }

  // BELOW the cache, ABOVE everything that spends.
  //
  // Below, because a cache hit costs nothing — it calls no provider and returns
  // text already paid for — so rate-limiting it would refuse the one path that
  // is free, and would do it exactly when a user is backspacing over a phrase
  // (the motion `CACHE_TTL_MS` exists to serve). It also has to sit below model
  // resolution, since the cache key is built from the resolved ref.
  //
  // Above, because everything after this line costs something: `countDispatch`
  // writes a request into the day the cap is read from, so refusing after it
  // would book a request that never happened and walk the daily counter up
  // under a loop this guard just stopped.
  //
  // Returns WITHOUT aborting the in-flight request, for the same reason the
  // `countDispatch` refusal below does: it has no suggestion to offer, so
  // killing the request already running would make room for one that is never
  // sent.
  const rateLimit = admitDispatch(sessionId, startedAt);
  if (!rateLimit.admitted) {
    // Counts and limits only — the surface is identified to nobody and the
    // typed text appears nowhere, as on every other line in this file.
    logSkip("rate-limited", startedAt, {
      limitScope: rateLimit.limitScope,
      limit: rateLimit.limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      dispatchesInWindow: rateLimit.dispatchesInWindow,
    });
    return none(requestId);
  }

  // Counted HERE, before the call and not after it: from the dispatch on, the
  // provider has been asked, and it bills whether the answer ever reaches the
  // user. Recording on success only kept the counter at zero for a user typing
  // continuously — every request superseded, every request paid for — which is
  // the one runaway `DAILY_REQUEST_BACKSTOP` exists to stop.
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
      // NO OUTPUT CEILING, where `maxOutputTokens: 40` used to be. Deliberate,
      // and the honest description of it is that length is now a SOFT
      // constraint: the system prompt asks for one sentence of at most fifteen
      // words, and a weak model can simply not comply. This file already has the
      // evidence — the prompt that said `output nothing at all` was CONTINUED as
      // prose by a 9B local model instead of obeyed, which is the whole reason
      // the JSON contract exists. An instruction is not an enforcement point.
      //
      // The enforcement point is the envelope plus `parseReply.ts`: a rambling
      // reply is not `{"suggestion":"…"}`, so it yields NO suggestion, and a
      // reply that does parse is still cut to `MAX_SUGGESTION_CHARS` by
      // `sanitizeSuggestion` before it can be painted. Nothing unbounded reaches
      // the UI; what is now unbounded is what the provider BILLS and how long the
      // user waits for it.
      //
      // Stated plainly, since this is the last hard per-request spend bound
      // leaving a path that dispatches from `MIN_PREFIX_CHARS` characters of
      // typing: the remaining guards — the renderer's debounce, `CACHE_TTL_MS`,
      // the short-window rate limit, the daily stops — all bound HOW MANY
      // requests happen. Not one of them bounds how large a single reply is.
      //
      // NO STOP SEQUENCE either, where there used to be `["\n\n"]`.
      //
      // Against a JSON reply that sequence can only do harm. It cannot fire
      // INSIDE the envelope — a newline in the suggestion is the two characters
      // backslash-n, not a line break — so it saves nothing on a rambling model,
      // which is what it was for. It CAN fire on a model that pretty-prints with
      // a blank line, or that preambles before the object, and firing there cuts
      // the reply before its closing brace: a reply that would have parsed
      // becomes a parse failure, i.e. no suggestion. The closing brace is the
      // reply's own terminator, and it is the only terminator now that no token
      // ceiling exists — a stop sequence that can fire early would cost valid
      // answers without capping the invalid ones.
      abortSignal: controller.signal,
      quiet: true,
    });

    const rawReply = response.content?.[0];
    // Parse THEN sanitize, never the other way round: sanitizing first would
    // strip the control characters out of the JSON source text rather than out
    // of the decoded suggestion, and would happily hand the parser a string it
    // had already rewritten.
    const parsedReply = parseAutocompleteReply(rawReply);
    // The RAW prefix, not the windowed one the prompt carries. They agree over
    // the only region the overlap guard reads (`OVERLAP_LOOKBACK_CHARS` is far
    // inside `PREFIX_WINDOW_CHARS`), and the raw one is what the suggestion is
    // actually appended to in the renderer.
    const suggestion = parsedReply.ok ? sanitizeSuggestion(parsedReply.suggestion, prefix) : null;
    writeCache(key, suggestion, Date.now());
    await recordResponseUsage(response, now);

    const latencyMs = Date.now() - startedAt;
    if (!parsedReply.ok) {
      // The instant the reply LANDED, not the shared `startedAt` this request
      // books its spend against — same rule as the superseded line below.
      logUnparseableReply(startedAt + latencyMs, {
        model: response.model,
        provider: response.provider,
        // The LENGTH of the reply, never the reply. It is model output, but it
        // is model output about the user's unsent text, and these lines are
        // copyable and exportable from the Logs tab.
        replyLength: rawReply?.length ?? 0,
        latencyMs,
      });
    }
    // Kept so that IF the renderer reports this reply as having arrived too
    // late, the line can name the model that was slow — main's own numbers, not
    // the renderer's word for them. Nothing here is typed text.
    rememberResolution(sessionId, {
      requestId,
      model: response.model,
      provider: response.provider,
      latencyMs,
    });

    // Prefix LENGTH only. `redactLogMessage` cannot help here — the typed text
    // IS the payload, and it would land in userData/logs/*.jsonl.
    //
    // The attached context is stated the same way: how much of it went out and
    // where it came from, never a character of it. `contextLength` and
    // `contextSource` are also the two names that SURVIVE `redactLogContext`,
    // which blanks any key merely containing `clipboard`, `token`, `secret` or
    // `selected_text` — so `clipboardContext` or `selectedText` would persist as
    // `"[REDACTED]"` with no error at all (the `selectionPoll` trap). The source
    // is omitted rather than reported as a null when nothing was attached, so a
    // reader never has to decide what a source with no context means.
    logger.debug("autocomplete", "Suggestion resolved", {
      prefixLength: prefix.length,
      suffixLength: suffix.length,
      contextLength,
      ...(contextLength > 0 && askContext ? { contextSource: askContext.source } : {}),
      // The environment block's SIZE only. Its lines name the user's presets
      // and state the minute they pressed the hotkey, and these lines are
      // copyable and exportable from the Logs tab. `environmentLength` also
      // survives `redactLogContext`, which blanks any key merely containing
      // `clipboard`, `token`, `secret` or `selected_text`.
      environmentLength,
      model: response.model,
      provider: response.provider,
      latencyMs,
      hasSuggestion: suggestion !== null,
    });

    return { requestId, suggestion };
  } catch (error) {
    // A superseded request is the normal case, not a failure — but it is not
    // nothing either, and it used to return in total silence.
    //
    // This is the shape a too-slow model takes when the user keeps typing:
    // every request is killed by the next keystroke, so NOTHING resolves,
    // nothing is painted, and not one line is written — the feature looks dead
    // while every one of those prompts is billed. The renderer cannot report
    // it usefully (it sees a rejection it cannot attribute to any model),
    // whereas the ref and the elapsed time are both right here.
    //
    // `modelRef` is the configured composite ref rather than the provider's
    // resolved id, because no response came back to read one from — which is
    // the point of the line.
    //
    // Throttled on the instant the request DIED, not the shared `startedAt`
    // this request books its spend against: two 24-second requests started a
    // keystroke apart die a keystroke apart, and throttling them by their
    // starts would measure the wrong interval entirely.
    if (controller.signal.aborted) {
      const abortedAt = Date.now();
      logWastedSuggestion(
        "superseded",
        "Suggestion superseded before it answered; the model is slower than the typing",
        abortedAt,
        { model: modelRef, latencyMs: abortedAt - startedAt },
      );
      return none(requestId);
    }
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
