/**
 * @file comboFlow.ts
 * @description The Combo execution core: a sequential fold over `fixGrammar`
 * (step N's output feeds step N+1's input), fully dependency-injected so the
 * load-bearing guards below are each provable with a mock, not "it called
 * fixGrammar N times":
 *
 * - **E2** (no mid-chain paste) needs `deliver` to be a parameter, not an
 *   import — otherwise a test cannot tell "never called mid-loop" from
 *   "never wired at all".
 * - **E5** (t0 snapshot) needs `getCorrectionSettings` to be a parameter
 *   called exactly once — a plain import to the live store could not be
 *   asserted not to have been re-read for step 2.
 * - **H1** (one history row per completed step) needs `recordStepHistory` to
 *   be a parameter — the real implementation touches SQLite + IPC, neither
 *   of which belongs in this module or its test.
 *
 * This module is deliberately Electron-free: `fixGrammar`, `getCorrectionSettings`,
 * `recordStepHistory` and `deliver` are all injected, so nothing here imports
 * `electron`, a provider, or the history store. That is what makes every
 * guard a unit test rather than an integration test.
 *
 * **R3 (recorded, do not re-litigate):** `fixGrammar` re-resolves `presetId`
 * against the LIVE profile on every call (`getCorrectionPreset` in
 * `~/main/ai.request/correction.ts`), so this module's t0 snapshot of preset
 * *objects* does NOT by itself stop a mid-run profile switch from routing a
 * later step through another profile's model/provider/key — `fixGrammar`
 * still only ever receives `step.presetId`, a plain string. The snapshot's
 * job is narrower and is exactly what E5's test below checks: fail fast on a
 * deleted/invalid preset, and read the step list once rather than per step.
 * The real guard against a mid-run profile switch is the active-profile
 * abort subscriber that wires an `AbortSignal` into `signal` (a different
 * card's job). Do NOT "fix" this by giving `fixGrammar` a resolved-preset
 * overload — that was considered and rejected.
 */
import {
  validateCombo,
  type ComboValidationCode,
  type ComboValidationError,
} from "~/features/correction/shared/comboValidation";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
// Pure string composition, no Electron reach — the one Ask-path helper this
// module may import directly. The locale directive around it is injected,
// because THAT one reads the main-process locale store.
import { composeAskMessage } from "./askMessage";
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
  CorrectionSettings,
} from "~/features/providers/store/apiStore";
import type { fixGrammar as fixGrammarType } from "~/main/ai.request/correction";
import type { TransformContext } from "~/main/ai.request/transform-context";
import type { CorrectionOutputDelivery } from "~/main/keybindings/correctionOutput";
import type { ComboProgressView } from "~/main/webViewWindows/comboProgressView";

/** Result shape of the real `fixGrammar`, without importing its (Electron-reaching) module at runtime. */
export type FixGrammarResult = Awaited<ReturnType<typeof fixGrammarType>>;

/** Per-step budget. A single slow provider must not hang the whole chain forever. */
export const COMBO_STEP_TIMEOUT_MS = 60_000;

/** Whole-run budget (E9). Wins over the per-step cap once fewer than that many ms remain. */
export const COMBO_TOTAL_BUDGET_MS = 120_000;

export type ComboStepErrorCode =
  | "empty-output"
  | "step-timeout"
  | "combo-timeout"
  /**
   * The step's `fixGrammar` call rejected for any reason this module does not
   * model itself — an API error, an auth failure, a network drop. Wrapped
   * rather than rethrown raw so the caller's notification can still name the
   * failing step and its preset; a multi-provider combo is exactly the case
   * where "something failed" is useless and "step 2 of 3 — Translate" is not.
   * The original error is preserved as `cause`.
   */
  | "step-failed";

/**
 * Raised for a single step: a whitespace-only intermediate output (E6, never
 * a silent pass-through), a timeout (E9), or a wrapped provider/request
 * failure. Carries the step and its index so the caller (a different card's
 * notification builder) can name the failing step and its position without
 * re-deriving them from a generic Error.
 */
export class ComboStepError extends Error {
  readonly step: ComboStep;
  readonly stepIndex: number;
  readonly code: ComboStepErrorCode;

  constructor(
    step: ComboStep,
    stepIndex: number,
    code: ComboStepErrorCode,
    options?: { cause?: unknown },
  ) {
    super(
      `Combo step ${stepIndex + 1} (preset "${step.presetId}") failed: ${code}`,
      options,
    );
    this.name = "ComboStepError";
    this.step = step;
    this.stepIndex = stepIndex;
    this.code = code;
  }
}

/**
 * Raised when `signal` aborts — at entry, between steps, mid-step (raced
 * inside `raceWithTimeout` so an abort wins over an in-flight `fixGrammar`
 * call without waiting for it to settle), or in the last-ditch check right
 * before `deliver`. A dedicated class rather than `signal.throwIfAborted()`'s
 * `DOMException("AbortError")`: the caller's notification builder (a
 * different card) needs a compile-checked `instanceof` to tell a cancel
 * apart from a step failure, not `error.name` string-sniffing.
 */
export class ComboCancelledError extends Error {
  constructor() {
    super("Combo run was cancelled");
    this.name = "ComboCancelledError";
  }
}

/**
 * Throws `ComboCancelledError` if `signal` has already been aborted. Never
 * `signal?.throwIfAborted()` — that throws a `DOMException` whose `name` is
 * the only way to recognize it, which is exactly the string-sniffing
 * `ComboCancelledError` exists to replace.
 */
const throwIfCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new ComboCancelledError();
  }
};

/** Executability rules only (V3 / f2) — editor-level name rules (`name-empty`,
 * `name-duplicate`) are irrelevant to whether a chain can run: an imported
 * profile can carry two combos named identically (dedupe is by id, not
 * name), and a duplicate NAME must not stop an otherwise-runnable chain from
 * executing.
 */
const EXECUTABLE_VALIDATION_CODES = new Set<ComboValidationCode>([
  "step-count",
  "unknown-preset",
  "missing-inline-input",
]);

/**
 * Raised when the t0 re-validation (`resolveComboSteps`) finds the stored
 * combo no longer legal — the sanitizer admits shapes `validateCombo` does
 * not (e.g. an empty `steps` array; see apiStore's `sanitizeCombos`), and a
 * profile edit or import can leave a combo referencing a deleted preset.
 * Zero requests run when this is thrown.
 *
 * `notificationKey` is a candidate catalog key, not yet present in
 * `notifications.json` — adding it there (en + ja) and rendering this error
 * belongs to the card that owns hotkey registration + delivery, not this
 * module. Kept as a plain `string`, not the compile-checked `TKey` union, so
 * this file never depends on a key that does not exist yet.
 */
export class ComboValidationFailedError extends Error {
  readonly combo: ComboPreset;
  readonly errors: ComboValidationError[];
  readonly notificationKey = "notifications.error.comboInvalid.body";

  constructor(combo: ComboPreset, errors: ComboValidationError[]) {
    super(
      `Combo "${combo.name}" failed validation: ${errors.map((error) => error.code).join(", ")}`,
    );
    this.name = "ComboValidationFailedError";
    this.combo = combo;
    this.errors = errors;
  }
}

export type ResolvedComboStep = {
  step: ComboStep;
  preset: CorrectionPreset;
};

/**
 * Re-validates the stored combo against the given (t0) settings and resolves
 * every step's preset, once, before any request runs.
 *
 * Re-validation is required, not optional (V3): `sanitizeCombos` deliberately
 * admits shapes `validateCombo` rejects — an empty `steps` array in
 * particular — because the sanitizer's job is shape, not legality. Trusting
 * "2-5 steps, every presetId resolves" without calling `validateCombo` here
 * would let a stored-but-invalid combo run anyway.
 */
export const resolveComboSteps = (
  combo: ComboPreset,
  settings: CorrectionSettings,
): ResolvedComboStep[] => {
  const errors = validateCombo(combo, settings.presets, settings.combos ?? []).filter(
    (error) => EXECUTABLE_VALIDATION_CODES.has(error.code),
  );
  if (errors.length > 0) {
    throw new ComboValidationFailedError(combo, errors);
  }

  const presetById = new Map(settings.presets.map((preset) => [preset.id, preset]));

  return combo.steps.map((step) => {
    const preset = presetById.get(step.presetId);
    if (!preset) {
      // Unreachable once `validateCombo` above has passed — it already
      // confirms every `presetId` resolves against `settings.presets`. Kept
      // as a thrown error (not a non-null assertion) so this lookup stays
      // total instead of trusting an invariant enforced two lines up.
      throw new ComboValidationFailedError(combo, [
        {
          code: "unknown-preset",
          message: `Step references a preset that no longer exists: "${step.presetId}".`,
          stepId: step.id,
        },
      ]);
    }
    return { step, preset };
  });
};

export type ComboStepOutcome = {
  step: ComboStep;
  preset: CorrectionPreset;
  result: FixGrammarResult;
};

export type ComboStepHistoryPayload = {
  runId: string;
  step: ComboStep;
  stepIndex: number;
  totalSteps: number;
  /** Text this step actually sent (post `inlineInput` composition), matching the single-preset history row's "original" field. */
  originalText: string;
  result: FixGrammarResult;
};

/**
 * Writes one history row for a completed step. Never a plain import to
 * `syncHistory`: the real implementation touches SQLite and broadcasts IPC,
 * neither of which belongs in a module this pure, and E7 (fail-fast leaves
 * completed steps in history, nothing more) is only provable against a mock.
 */
export type RecordComboStepHistory = (payload: ComboStepHistoryPayload) => void;

export type ComboDeliverPayload = {
  presetName?: string;
  text: string;
  /** Resolved combo-level value (E3) — never a step preset's own `markdownOutput`. */
  markdownOutput: boolean;
};

/**
 * Delivers the final text exactly once, after the last step. Never a plain
 * import to `deliverCorrectionOutput`/`pasteText`: E2's guarantee (nothing
 * pasted mid-chain) is only a guarantee if this function is a parameter a
 * test can assert was called zero times until the loop finished.
 */
export type ComboDeliver = (
  mode: CorrectionOutputMode,
  payload: ComboDeliverPayload,
) => Promise<CorrectionOutputDelivery>;

export type RunComboDependencies = {
  /** Injected so the t0 snapshot (E5) is provable: called exactly once, before step 1. */
  getCorrectionSettings: () => CorrectionSettings;
  fixGrammar: (
    text: string,
    presetId?: string,
    context?: TransformContext,
  ) => Promise<FixGrammarResult>;
  recordStepHistory: RecordComboStepHistory;
  deliver: ComboDeliver;
  /** Global correction output mode `combo.outputMode` resolves against when "inherit" or unset. */
  defaultOutputMode: CorrectionOutputMode;
  /** Defaults to `crypto.randomUUID`. Overridable for deterministic tests and for H2's future `combo_run_id` column. */
  generateRunId?: () => string;
  /**
   * Step-boundary seam for the overlay's progress ring (card 04's
   * `updateComboProgress`, wired by `correction.ts` — never called from
   * here). Fired "running" right before that step's `fixGrammar` call, and
   * "failed" right before this function throws the `ComboStepError` for
   * that step, so a caller with no other way to observe progress mid-loop
   * can paint both states. Never fired with "cancelling": the abort that
   * produces it happens outside this loop, in `withComboCancel`'s
   * `onCancelling` (a different module, no visibility into `runCombo`'s
   * loop state) — the caller is expected to remember the last view this
   * delivered and replay it with `state: "cancelling"` from there. Optional
   * so every existing caller of this type (this module's own tests in
   * particular) never has to supply one.
   */
  onProgress?: (view: ComboProgressView) => void;
  /**
   * Returns the `App locale: <code>` directive `askFlow.ts` appends to every
   * Ask request. Injected rather than imported for the same reason as
   * everything else here — `getLocale()` reaches the main-process i18n store
   * — and optional so a test that does not exercise a `requiresInput` step
   * need not supply one. Wired by `correction.ts` from the SAME builder
   * `askFlow.ts` uses, so the two paths cannot drift.
   */
  buildAskLocaleDirective?: () => string;
};

export type RunComboParams = {
  combo: ComboPreset;
  input: string;
  /** Best-effort source app the ORIGINAL selection came from; reaches step 1 only (E4). */
  activeAppName?: string;
  /** Cooperative cancellation, checked before each step starts. Wiring an `AbortController` into this is a different card's job (E10/D1-D4). */
  signal?: AbortSignal;
};

export type RunComboResult = {
  text: string;
  completed: ComboStepOutcome[];
  delivery: CorrectionOutputDelivery;
};

/**
 * Races `promise` against a `ms`-long timer and, if given, `signal` —
 * whichever settles first wins. Rejects with `buildTimeoutError()` if the
 * timer wins, or `ComboCancelledError` if the signal wins (f1: this is what
 * lets an abort mid-step, including the LAST step where there is no next
 * loop iteration to catch it, be observed without waiting for the underlying
 * provider call to return — `fixGrammar` takes no `AbortSignal`, so the call
 * itself cannot actually be cancelled).
 *
 * Always attaches a rejection handler to `promise` itself (via `.then`), so
 * a slow provider call that eventually settles after the timeout or the
 * signal already won never surfaces as an unhandled rejection, a late
 * history write, or a late delivery — the settled outer `Promise` simply
 * ignores it, per `Promise` semantics.
 */
const raceWithTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  buildTimeoutError: () => Error,
  signal?: AbortSignal,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(buildTimeoutError()), ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new ComboCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });

/**
 * Builds the message for a `requiresInput` step exactly as the Ask hotkey
 * path builds one: the frozen `inlineInput` is the question, the text carried
 * in from the previous step (or the original selection, at step 1) is the
 * optional context block, and the app-locale directive trails both.
 *
 * `composeAskMessage` returns `null` only for an empty question, which
 * `validateCombo` already refuses — falling back to the carried text keeps
 * this defensive branch from sending an empty prompt.
 */
const composeAskStepMessage = (
  question: string,
  carriedText: string,
  buildLocaleDirective?: () => string,
): string => {
  const composed = composeAskMessage({ question, context: carriedText });
  if (composed === null) return carriedText;

  const directive = buildLocaleDirective?.();
  return directive ? `${composed}\n\n${directive}` : composed;
};

/**
 * Runs a Combo's steps in order, feeding each step's `correctedText` into the
 * next, and delivers the final text exactly once. See the file header for why
 * every side effect below is a parameter rather than an import.
 */
export const runCombo = async (
  { combo, input, activeAppName, signal }: RunComboParams,
  deps: RunComboDependencies,
): Promise<RunComboResult> => {
  throwIfCancelled(signal);

  const resolvedSteps = resolveComboSteps(combo, deps.getCorrectionSettings());

  const runId = (deps.generateRunId ?? (() => crypto.randomUUID()))();
  const runDeadline = Date.now() + COMBO_TOTAL_BUDGET_MS;

  let text = input;
  const completed: ComboStepOutcome[] = [];

  for (const [index, resolved] of resolvedSteps.entries()) {
    throwIfCancelled(signal);

    const remainingBudgetMs = runDeadline - Date.now();
    if (remainingBudgetMs <= 0) {
      deps.onProgress?.({
        total: resolvedSteps.length,
        completed: index,
        current: index + 1,
        state: "failed",
      });
      throw new ComboStepError(resolved.step, index, "combo-timeout");
    }

    deps.onProgress?.({
      total: resolvedSteps.length,
      completed: index,
      current: index + 1,
      state: "running",
    });

    // D4 — a `requiresInput` step (e.g. Ask AI) never opens the Ask input
    // window; `validateCombo` (inside `resolveComboSteps`) already refused
    // any such step lacking a non-empty `inlineInput`, so the `inlineInput`
    // check is a defensive re-check, not the primary guard.
    //
    // The message is composed through `composeAskMessage` — the same function
    // the real Ask hotkey path uses — rather than a bare
    // `${question}\n\n${text}` concatenation. Two things depend on it: the
    // carried text has to sit inside the `----- context -----` delimiters or
    // the model reads it as part of the question, and the trailing
    // `App locale: <code>` directive is what the bundled Ask system prompt
    // consults to pick its response language. Concatenating by hand silently
    // changed both.
    const composedText =
      resolved.preset.requiresInput && resolved.step.inlineInput
        ? composeAskStepMessage(
            resolved.step.inlineInput,
            text,
            deps.buildAskLocaleDirective,
          )
        : text;

    // E4 — source-app context describes where the ORIGINAL selection came
    // from. Steps 2+ receive text produced by FixLang, not by the source app.
    // A `requiresInput` step never gets it at all, at any position: the real
    // Ask path passes no `TransformContext`, and a first-step Ask that did
    // would be answering under a source-app hint the same preset never sees
    // when run by its own hotkey.
    const context: TransformContext | undefined =
      index === 0 && !resolved.preset.requiresInput
        ? { activeAppName }
        : undefined;

    const stepTimeoutMs = Math.min(COMBO_STEP_TIMEOUT_MS, remainingBudgetMs);
    let result: FixGrammarResult;
    try {
      result = await raceWithTimeout(
        deps.fixGrammar(composedText, resolved.step.presetId, context),
        stepTimeoutMs,
        () =>
          new ComboStepError(
            resolved.step,
            index,
            stepTimeoutMs < COMBO_STEP_TIMEOUT_MS ? "combo-timeout" : "step-timeout",
          ),
        signal,
      );
    } catch (error) {
      // A cancel is not a step failure: it must keep its own class so the
      // caller shows "cancelled", not "step 2 of 3 failed", and must NOT
      // repaint the ring as failed — `withComboCancel`'s `onCancelling`
      // already owns that state.
      if (error instanceof ComboCancelledError) throw error;

      deps.onProgress?.({
        total: resolvedSteps.length,
        completed: index,
        current: index + 1,
        state: "failed",
      });

      // Anything the provider threw arrives here untyped. Wrapping it (rather
      // than rethrowing, which drops the caller into its generic "something
      // failed" notification) is what lets the user be told WHICH step and
      // which preset died — the only useful thing to say about a combo whose
      // steps may each sit behind a different provider and key.
      throw error instanceof ComboStepError
        ? error
        : new ComboStepError(resolved.step, index, "step-failed", {
            cause: error,
          });
    }

    // E6 — fixGrammar returns its input unchanged, with no error, on
    // empty/whitespace text. An empty intermediate would silently no-op
    // every later step and report success.
    if (!result.correctedText.trim()) {
      deps.onProgress?.({
        total: resolvedSteps.length,
        completed: index,
        current: index + 1,
        state: "failed",
      });
      throw new ComboStepError(resolved.step, index, "empty-output");
    }

    deps.recordStepHistory({
      runId,
      step: resolved.step,
      stepIndex: index,
      totalSteps: resolvedSteps.length,
      originalText: composedText,
      result,
    });

    completed.push({ step: resolved.step, preset: resolved.preset, result });
    text = result.correctedText;
  }

  const lastPreset = resolvedSteps[resolvedSteps.length - 1].preset;
  // Combo-level explicit value wins; absent falls back to the final step's
  // own preset value — design (E3) states markdownOutput "applies to the
  // final step only" without saying where the value comes from when the
  // combo itself does not set one.
  const markdownOutput = combo.markdownOutput ?? lastPreset.markdownOutput ?? false;

  // f1 — the loop's own checks only ever run BEFORE a step starts, so a
  // cancel that lands after the last step's `fixGrammar` call already
  // settled (but before this function resumes) would otherwise fall through
  // straight into `deliver`, pasting a run the user just cancelled.
  throwIfCancelled(signal);

  const delivery = await deps.deliver(
    resolvePresetOutputMode(combo.outputMode, deps.defaultOutputMode),
    {
      presetName: lastPreset.name,
      text,
      markdownOutput,
    },
  );

  return { text, completed, delivery };
};
