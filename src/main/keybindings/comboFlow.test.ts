/**
 * @file comboFlow.test.ts
 * @description Covers `runCombo` / `resolveComboSteps` / `ComboStepError` /
 * `ComboValidationFailedError` against fully mocked dependencies. No Electron,
 * no IPC, no SQLite — every side effect (`fixGrammar`, `getCorrectionSettings`,
 * `recordStepHistory`, `deliver`) is injected, per the file header of
 * `comboFlow.ts`. This is what makes E2 (no mid-chain paste) and E5 (t0
 * snapshot) assertable rather than merely "it called fixGrammar N times".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMBO_STEP_TIMEOUT_MS,
  COMBO_TOTAL_BUDGET_MS,
  ComboCancelledError,
  ComboStepError,
  ComboValidationFailedError,
  resolveComboSteps,
  runCombo,
  type ComboDeliver,
  type FixGrammarResult,
  type RecordComboStepHistory,
  type RunComboDependencies,
} from "~/main/keybindings/comboFlow";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
  CorrectionSettings,
} from "~/features/providers/store/apiStore";
import type { ComboProgressView } from "~/main/webViewWindows/comboProgressView";

const makePreset = (
  id: string,
  overrides: Partial<CorrectionPreset> = {},
): CorrectionPreset => ({
  id,
  name: `Preset ${id}`,
  hotkey: "",
  systemPrompt: "Do the thing.",
  model: "",
  isBuiltIn: false,
  ...overrides,
});

const makeStep = (
  presetId: string,
  overrides: Partial<ComboStep> = {},
): ComboStep => ({
  id: `step-${presetId}`,
  presetId,
  ...overrides,
});

const makeCombo = (overrides: Partial<ComboPreset> = {}): ComboPreset => ({
  id: "combo-1",
  name: "Polish and Translate",
  hotkey: "",
  steps: [makeStep("correction"), makeStep("translate")],
  schemaVersion: 1,
  ...overrides,
});

const makeSettings = (
  overrides: Partial<CorrectionSettings> = {},
): CorrectionSettings => ({
  presets: [
    makePreset("correction", { name: "Correction" }),
    makePreset("translate", { name: "Translate" }),
    makePreset("summarize", { name: "Summarize" }),
  ],
  selectedPresetId: "correction",
  combos: [],
  ...overrides,
});

const makeResult = (
  overrides: Partial<FixGrammarResult> = {},
): FixGrammarResult => ({
  correctedText: "output",
  promptTokens: 10,
  completionTokens: 5,
  model: "gpt-5",
  provider: "openai",
  resolvedModel: "gpt-5-2026",
  presetId: "correction",
  presetName: "Correction",
  ...overrides,
});

type MakeDepsOverrides = Partial<RunComboDependencies> & {
  settings?: CorrectionSettings;
};

const makeDeps = (
  overrides: MakeDepsOverrides = {},
): RunComboDependencies => {
  const { settings, ...rest } = overrides;
  const resolvedSettings = settings ?? makeSettings();

  return {
    getCorrectionSettings: vi.fn(() => resolvedSettings),
    fixGrammar: vi.fn(async (text: string) => makeResult({ correctedText: `${text}-fixed` })),
    recordStepHistory: vi.fn() as unknown as RecordComboStepHistory,
    deliver: vi.fn(async () => "pasted") as unknown as ComboDeliver,
    defaultOutputMode: "paste",
    ...rest,
  };
};

describe("runCombo — E2: nothing pasted mid-chain", () => {
  it("never delivers until the loop is done, even when step 0's preset would paste on its own", async () => {
    const callOrder: string[] = [];
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate")],
      outputMode: "paste",
    });
    // A preset that (outside a combo) would paste immediately after its own
    // request — combo-level outputMode must be the only thing consulted.
    const settings = makeSettings({
      presets: [
        makePreset("correction", { name: "Correction", outputMode: "paste" }),
        makePreset("translate", { name: "Translate", outputMode: "popup" }),
      ],
    });

    const deps = makeDeps({
      settings,
      fixGrammar: vi.fn(async (text: string, presetId?: string) => {
        callOrder.push(`fixGrammar:${presetId}`);
        return makeResult({ correctedText: `${text}-${presetId}` });
      }),
      deliver: vi.fn(async () => {
        callOrder.push("deliver");
        return "pasted";
      }) as unknown as ComboDeliver,
    });

    const result = await runCombo({ combo, input: "hello" }, deps);

    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      "fixGrammar:correction",
      "fixGrammar:translate",
      "deliver",
    ]);
    expect(result.text).toBe("hello-correction-translate");
  });

  it("resolves the delivered mode from the combo, not from any step preset", async () => {
    const combo = makeCombo({ outputMode: "popup" });
    const deps = makeDeps();

    await runCombo({ combo, input: "hello" }, deps);

    expect(deps.deliver).toHaveBeenCalledWith(
      "popup",
      expect.objectContaining({ text: expect.any(String) }),
    );
  });
});

describe("runCombo — E5: presets snapshotted at t0", () => {
  it("reads the profile exactly once, before step 1 — a second read throws loudly instead of silently changing step 2", async () => {
    const settingsAtT0 = makeSettings();
    const getCorrectionSettings = vi
      .fn()
      .mockReturnValueOnce(settingsAtT0)
      .mockImplementation(() => {
        throw new Error(
          "getCorrectionSettings was called again — presets must be snapshotted once, at t0",
        );
      });

    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate")],
    });
    const deps = makeDeps({ getCorrectionSettings });

    const result = await runCombo({ combo, input: "hello" }, deps);

    expect(getCorrectionSettings).toHaveBeenCalledTimes(1);
    expect(result.completed).toHaveLength(2);
  });

  it("throws before any request when a step's presetId is unresolvable", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("deleted-preset")],
    });
    const deps = makeDeps();

    await expect(runCombo({ combo, input: "hello" }, deps)).rejects.toThrow(
      ComboValidationFailedError,
    );
    expect(deps.fixGrammar).not.toHaveBeenCalled();
    expect(deps.recordStepHistory).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});

describe("runCombo — happy path: N steps in order, output chained", () => {
  it("2 steps: step 2 receives step 1's output", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate")],
    });
    const deps = makeDeps({
      fixGrammar: vi.fn(async (text: string, presetId?: string) =>
        makeResult({ correctedText: `${text}>${presetId}` }),
      ),
    });

    const result = await runCombo({ combo, input: "start" }, deps);

    expect(deps.fixGrammar).toHaveBeenNthCalledWith(
      1,
      "start",
      "correction",
      expect.anything(),
    );
    expect(deps.fixGrammar).toHaveBeenNthCalledWith(
      2,
      "start>correction",
      "translate",
      undefined,
    );
    expect(result.text).toBe("start>correction>translate");
    expect(result.completed).toHaveLength(2);
  });

  it("3 steps: each receives the previous step's output, in order", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const deps = makeDeps({
      fixGrammar: vi.fn(async (text: string, presetId?: string) =>
        makeResult({ correctedText: `${text}>${presetId}` }),
      ),
    });

    const result = await runCombo({ combo, input: "start" }, deps);

    expect(deps.fixGrammar).toHaveBeenCalledTimes(3);
    expect(result.text).toBe("start>correction>translate>summarize");
    expect(result.completed.map((outcome) => outcome.step.presetId)).toEqual([
      "correction",
      "translate",
      "summarize",
    ]);
  });
});

describe("runCombo — E6: an empty intermediate output is an error", () => {
  it("raises ComboStepError(empty-output) on a whitespace-only intermediate and never runs later steps", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const fixGrammar = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ correctedText: "   \n  " }))
      .mockResolvedValue(makeResult({ correctedText: "should never run" }));
    const deps = makeDeps({ fixGrammar });

    await expect(runCombo({ combo, input: "start" }, deps)).rejects.toMatchObject({
      code: "empty-output",
      stepIndex: 0,
    });

    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(deps.recordStepHistory).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("is thrown as a ComboStepError instance carrying the failing step", async () => {
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const fixGrammar = vi.fn().mockResolvedValue(makeResult({ correctedText: "" }));
    const deps = makeDeps({ fixGrammar });

    await expect(runCombo({ combo, input: "start" }, deps)).rejects.toBeInstanceOf(
      ComboStepError,
    );
  });
});

describe("runCombo — E4: source-app context reaches step 1 only", () => {
  it("passes { activeAppName } to call 0 and undefined to calls 1..N", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const fixGrammar = vi.fn(async (text: string) => makeResult({ correctedText: text }));
    const deps = makeDeps({ fixGrammar });

    await runCombo({ combo, input: "start", activeAppName: "Slack" }, deps);

    expect(fixGrammar).toHaveBeenNthCalledWith(1, "start", "correction", {
      activeAppName: "Slack",
    });
    expect(fixGrammar).toHaveBeenNthCalledWith(2, "start", "translate", undefined);
    expect(fixGrammar).toHaveBeenNthCalledWith(3, "start", "summarize", undefined);
  });

  it("still passes an explicit { activeAppName: undefined } object to call 0 when nothing was read", async () => {
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const fixGrammar = vi.fn(async (text: string) => makeResult({ correctedText: text }));
    const deps = makeDeps({ fixGrammar });

    await runCombo({ combo, input: "start" }, deps);

    expect(fixGrammar).toHaveBeenNthCalledWith(1, "start", "correction", {
      activeAppName: undefined,
    });
  });
});

describe("runCombo — E7: fail fast, completed steps stay in history", () => {
  it("a rejection at step 2 of 3 stops the chain, delivers nothing, records exactly one history row", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const failure = new Error("provider exploded");
    const fixGrammar = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ correctedText: "step1 output" }))
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(makeResult({ correctedText: "should never run" }));
    const deps = makeDeps({ fixGrammar });

    await expect(runCombo({ combo, input: "start" }, deps)).rejects.toBe(failure);

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(deps.recordStepHistory).toHaveBeenCalledTimes(1);
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});

describe("runCombo — H1: one history row per completed step", () => {
  it("calls recordStepHistory once per completed step with that step's own result fields", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate")],
    });
    const results = [
      makeResult({
        correctedText: "step1",
        presetName: "Correction",
        model: "gpt-5",
        provider: "openai",
        resolvedModel: "gpt-5-2026",
        sessionJson: "{\"step\":1}",
      }),
      makeResult({
        correctedText: "step2",
        presetName: "Translate",
        model: "claude",
        provider: "bedrock",
        resolvedModel: "claude-x",
        sessionJson: "{\"step\":2}",
      }),
    ];
    const fixGrammar = vi
      .fn()
      .mockResolvedValueOnce(results[0])
      .mockResolvedValueOnce(results[1]);
    const recordStepHistory = vi.fn() as unknown as RecordComboStepHistory;
    const deps = makeDeps({ fixGrammar, recordStepHistory });

    await runCombo({ combo, input: "start" }, deps);

    expect(recordStepHistory).toHaveBeenCalledTimes(2);
    expect(recordStepHistory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stepIndex: 0,
        totalSteps: 2,
        result: results[0],
      }),
    );
    expect(recordStepHistory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepIndex: 1,
        totalSteps: 2,
        result: results[1],
      }),
    );

    const [firstCallArgs, secondCallArgs] = (recordStepHistory as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls as [{ runId: string }][];
    expect(firstCallArgs[0].runId).toBe(secondCallArgs[0].runId);
  });
});

describe("runCombo — D4: a requiresInput step never opens the Ask window", () => {
  it("prepends the stored inlineInput to the carried text instead", async () => {
    const combo = makeCombo({
      steps: [
        makeStep("ask", { inlineInput: "What should I reply?" }),
        makeStep("correction"),
      ],
    });
    const settings = makeSettings({
      presets: [
        makePreset("ask", { name: "Ask AI", requiresInput: true }),
        makePreset("correction", { name: "Correction" }),
      ],
    });
    const fixGrammar = vi.fn(async (text: string) => makeResult({ correctedText: text }));
    const deps = makeDeps({ settings, fixGrammar });

    await runCombo({ combo, input: "the selection" }, deps);

    expect(fixGrammar).toHaveBeenNthCalledWith(
      1,
      "What should I reply?\n\nthe selection",
      "ask",
      expect.anything(),
    );
  });

  it("never imports or calls an Ask input window — comboFlow.ts has no such import", () => {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(thisDir, "comboFlow.ts"), "utf8");
    expect(source).not.toMatch(/askInputWindow/i);
    expect(source).not.toMatch(/showAskInputWindow/);
  });
});

describe("runCombo — stored combo that validateCombo rejects", () => {
  it("fails with a ComboValidationFailedError and runs zero requests", async () => {
    // Admitted by the sanitizer (V3) but illegal per validateCombo: an empty
    // steps array.
    const combo = makeCombo({ steps: [] });
    const deps = makeDeps();

    const failure = runCombo({ combo, input: "start" }, deps);
    await expect(failure).rejects.toBeInstanceOf(ComboValidationFailedError);
    await expect(failure).rejects.toMatchObject({
      notificationKey: "notifications.error.comboInvalid.body",
    });

    expect(deps.fixGrammar).not.toHaveBeenCalled();
    expect(deps.recordStepHistory).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("names every broken step's error code on the thrown error", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("ghost-preset")],
    });
    const deps = makeDeps();

    expect(() =>
      resolveComboSteps(combo, deps.getCorrectionSettings()),
    ).toThrow(ComboValidationFailedError);

    try {
      resolveComboSteps(combo, deps.getCorrectionSettings());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ComboValidationFailedError);
      expect((error as ComboValidationFailedError).errors.map((e) => e.code)).toContain(
        "unknown-preset",
      );
    }
  });

  it("f2 — a duplicate combo NAME does not block an otherwise-runnable chain", () => {
    // validateCombo's name-duplicate rule is an editor-level rule (checked at
    // save time); sanitizeCombos dedupes by id, not name, so an imported
    // profile can legitimately carry two combos sharing a name. That must
    // not stop either one from running.
    const combo = makeCombo({ id: "combo-1", name: "Polish" });
    const settings = makeSettings({
      combos: [combo, makeCombo({ id: "combo-2", name: "Polish" })],
    });

    expect(() => resolveComboSteps(combo, settings)).not.toThrow();
  });
});

describe("runCombo — E9: per-step timeout and whole-combo budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts and delivers nothing when a single step exceeds the per-step timeout", async () => {
    vi.useFakeTimers();
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    // Never settles within the test — the timeout is what must reject it.
    const fixGrammar = vi.fn(() => new Promise<FixGrammarResult>(() => undefined));
    const deps = makeDeps({ fixGrammar });

    const pending = runCombo({ combo, input: "start" }, deps);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "step-timeout",
      stepIndex: 0,
    });
    await vi.advanceTimersByTimeAsync(COMBO_STEP_TIMEOUT_MS);
    await assertion;

    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(deps.recordStepHistory).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("aborts once the whole-combo budget is exhausted even though each step is under the per-step cap", async () => {
    vi.useFakeTimers();
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    // Each step "takes" 50s — under the 60s per-step cap, but three of them
    // exceed the 120s whole-combo budget.
    const stepDurationMs = 50_000;
    const fixGrammar = vi.fn(
      (text: string) =>
        new Promise<FixGrammarResult>((resolve) => {
          setTimeout(() => resolve(makeResult({ correctedText: text })), stepDurationMs);
        }),
    );
    const deps = makeDeps({ fixGrammar });

    const pending = runCombo({ combo, input: "start" }, deps);
    const assertion = expect(pending).rejects.toMatchObject({ code: "combo-timeout" });
    await vi.advanceTimersByTimeAsync(COMBO_TOTAL_BUDGET_MS + stepDurationMs);
    await assertion;

    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.recordStepHistory).toHaveBeenCalledTimes(2);
  });
});

describe("runCombo — f1: cancel mid-run never delivers", () => {
  it("throws ComboCancelledError and runs zero requests when the signal is already aborted before step 1", async () => {
    const combo = makeCombo();
    const deps = makeDeps();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runCombo({ combo, input: "start", signal: controller.signal }, deps),
    ).rejects.toBeInstanceOf(ComboCancelledError);

    expect(deps.fixGrammar).not.toHaveBeenCalled();
    expect(deps.recordStepHistory).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("stops before step 2 when the signal aborts between steps, delivering nothing", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const controller = new AbortController();
    // Abort fires once step 1 has fully completed and its history row is
    // written — i.e. strictly BETWEEN steps, not mid-request — so this pins
    // the top-of-loop check on the NEXT iteration, distinct from the
    // in-flight race covered by the other tests in this block.
    const recordStepHistory = vi.fn((payload) => {
      if (payload.stepIndex === 0) {
        controller.abort();
      }
    }) as unknown as RecordComboStepHistory;
    const deps = makeDeps({ recordStepHistory });

    await expect(
      runCombo({ combo, input: "start", signal: controller.signal }, deps),
    ).rejects.toBeInstanceOf(ComboCancelledError);

    expect(deps.fixGrammar).toHaveBeenCalledTimes(1);
    expect(recordStepHistory).toHaveBeenCalledTimes(1);
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("regression for f1 — never delivers when the signal aborts mid-flight on the LAST step, without waiting for the abandoned request", async () => {
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const controller = new AbortController();
    let resolveLastStep: ((value: FixGrammarResult) => void) | undefined;
    const lastStepPromise = new Promise<FixGrammarResult>((resolve) => {
      resolveLastStep = resolve;
    });
    const fixGrammar = vi.fn(async (text: string, presetId?: string) => {
      if (presetId === "translate") {
        // Simulates Control+Escape landing exactly while the final (slow,
        // uncancellable) provider request is in flight — before this module
        // ever gets a chance to loop again, since there is no next step.
        controller.abort();
        return lastStepPromise;
      }
      return makeResult({ correctedText: `${text}-${presetId}` });
    });
    const deps = makeDeps({ fixGrammar });

    await expect(
      runCombo({ combo, input: "start", signal: controller.signal }, deps),
    ).rejects.toBeInstanceOf(ComboCancelledError);

    expect(deps.deliver).not.toHaveBeenCalled();

    // The abandoned request finally resolving afterwards must not deliver
    // late, write a late history row, or surface as an unhandled rejection.
    resolveLastStep?.(makeResult({ correctedText: "too-late" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.recordStepHistory).toHaveBeenCalledTimes(1);
  });

  it("checks the signal immediately before deliver, even after the last step's history row was already recorded", async () => {
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const controller = new AbortController();
    // Cancel lands right after the last step's history row is written — the
    // loop is already done (no next iteration to catch it), so only the
    // dedicated pre-deliver check can still stop delivery here.
    const recordStepHistory = vi.fn((payload) => {
      if (payload.stepIndex === 1) {
        controller.abort();
      }
    }) as unknown as RecordComboStepHistory;
    const deps = makeDeps({ recordStepHistory });

    await expect(
      runCombo({ combo, input: "start", signal: controller.signal }, deps),
    ).rejects.toBeInstanceOf(ComboCancelledError);

    expect(deps.deliver).not.toHaveBeenCalled();
    expect(recordStepHistory).toHaveBeenCalledTimes(2);
  });
});

describe("runCombo — markdownOutput applies to the final step only", () => {
  it("delivers with the combo's own markdownOutput when set, ignoring every step preset's value", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate")],
      markdownOutput: true,
    });
    const settings = makeSettings({
      presets: [
        makePreset("correction", { name: "Correction", markdownOutput: false }),
        makePreset("translate", { name: "Translate", markdownOutput: false }),
      ],
    });
    const deliver = vi.fn(async () => "popup") as unknown as ComboDeliver;
    const deps = makeDeps({ settings, deliver });

    await runCombo({ combo, input: "start" }, deps);

    expect(deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ markdownOutput: true }),
    );
  });

  it("falls back to the final step's own preset value when the combo sets none", async () => {
    // First and last steps deliberately disagree (f3): if the implementation
    // ever regressed to reading resolvedSteps[0].preset instead of the final
    // step, this would deliver `false` and the assertion below would catch it.
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const settings = makeSettings({
      presets: [
        makePreset("correction", { name: "Correction", markdownOutput: false }),
        makePreset("translate", { name: "Translate", markdownOutput: true }),
      ],
    });
    const deliver = vi.fn(async () => "popup") as unknown as ComboDeliver;
    const deps = makeDeps({ settings, deliver });

    await runCombo({ combo, input: "start" }, deps);

    expect(deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ markdownOutput: true }),
    );
  });
});

/**
 * F1 (board finding) — `updateComboProgress` (card 04's overlay ring) had no
 * production caller because `RunComboDependencies` exposed no step-boundary
 * seam. `onProgress` is that seam: these tests pin its exact firing points
 * and payloads, independent of whatever `correction.ts` does with them.
 */
describe("runCombo — onProgress: step-boundary seam for the overlay progress ring (F1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires 'running' immediately before each step's fixGrammar call, with total/completed/current advancing", async () => {
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const callOrder: string[] = [];
    const onProgress = vi.fn((view: ComboProgressView) =>
      callOrder.push(`progress:${view.state}:${view.current}`),
    );
    const fixGrammar = vi.fn(async (text: string, presetId?: string) => {
      callOrder.push(`fixGrammar:${presetId}`);
      return makeResult({ correctedText: text });
    });
    const deps = makeDeps({ fixGrammar, onProgress });

    await runCombo({ combo, input: "start" }, deps);

    expect(callOrder).toEqual([
      "progress:running:1",
      "fixGrammar:correction",
      "progress:running:2",
      "fixGrammar:translate",
      "progress:running:3",
      "fixGrammar:summarize",
    ]);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      total: 3,
      completed: 0,
      current: 1,
      state: "running",
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      total: 3,
      completed: 1,
      current: 2,
      state: "running",
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      total: 3,
      completed: 2,
      current: 3,
      state: "running",
    });
  });

  it("fires 'failed' for the failing step right before throwing ComboStepError(empty-output)", async () => {
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const onProgress = vi.fn();
    const fixGrammar = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ correctedText: "ok" }))
      .mockResolvedValueOnce(makeResult({ correctedText: "   " }));
    const deps = makeDeps({ fixGrammar, onProgress });

    await expect(runCombo({ combo, input: "start" }, deps)).rejects.toBeInstanceOf(
      ComboStepError,
    );

    expect(onProgress).toHaveBeenLastCalledWith({
      total: 2,
      completed: 1,
      current: 2,
      state: "failed",
    });
  });

  it("fires 'failed' on a step-timeout before rejecting", async () => {
    vi.useFakeTimers();
    const combo = makeCombo({ steps: [makeStep("correction"), makeStep("translate")] });
    const onProgress = vi.fn();
    const fixGrammar = vi.fn(() => new Promise<FixGrammarResult>(() => undefined));
    const deps = makeDeps({ fixGrammar, onProgress });

    const pending = runCombo({ combo, input: "start" }, deps);
    const assertion = expect(pending).rejects.toMatchObject({ code: "step-timeout" });
    await vi.advanceTimersByTimeAsync(COMBO_STEP_TIMEOUT_MS);
    await assertion;

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed", current: 1 }),
    );
  });

  it("fires 'failed' once the whole-combo budget is exhausted, before rejecting with combo-timeout", async () => {
    vi.useFakeTimers();
    const combo = makeCombo({
      steps: [makeStep("correction"), makeStep("translate"), makeStep("summarize")],
    });
    const onProgress = vi.fn();
    const stepDurationMs = 50_000;
    const fixGrammar = vi.fn(
      (text: string) =>
        new Promise<FixGrammarResult>((resolve) => {
          setTimeout(() => resolve(makeResult({ correctedText: text })), stepDurationMs);
        }),
    );
    const deps = makeDeps({ fixGrammar, onProgress });

    const pending = runCombo({ combo, input: "start" }, deps);
    const assertion = expect(pending).rejects.toMatchObject({ code: "combo-timeout" });
    await vi.advanceTimersByTimeAsync(COMBO_TOTAL_BUDGET_MS + stepDurationMs);
    await assertion;

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed" }),
    );
  });

  it("never throws when onProgress is omitted — existing callers of this type stay unaffected", async () => {
    const combo = makeCombo();
    const deps = makeDeps(); // no onProgress supplied

    await expect(runCombo({ combo, input: "start" }, deps)).resolves.toBeDefined();
  });
});
