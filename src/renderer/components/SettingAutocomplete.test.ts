/**
 * @file SettingAutocomplete.test.ts
 * @description Behaviour of the Settings > General autocomplete card.
 *
 * No `@testing-library/react` is installed and this repo's tests are
 * `.test.ts` only (no JSX), so the component is driven with
 * `react-dom/client` + `act`, matching `SettingCorrection.test.ts` /
 * `ModelSelect.test.ts`. `window.electronAPI` is mocked in full — the real
 * IPC surface for reading/writing `settingsAutocomplete` does not exist in
 * this tree yet (tracked separately), so these tests pin the contract this
 * component calls (`getAutocompleteSettings`/`setAutocompleteSettings`)
 * without depending on the main-process implementation landing first.
 *
 * Expected copy is derived through the real translator kernel — never
 * hand-restated — so a catalog reword can't silently pass this file. The one
 * deliberate exception is the cost hints: those are hand-computed literals,
 * because running the expectation through the same `formatOverviewCostHint`
 * the component calls would survive any error inside that formatter.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { SettingAutocomplete } from "./SettingAutocomplete";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";

const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const settleUi = async (ticks = 4) => {
  for (let index = 0; index < ticks; index += 1) {
    await waitForUi();
  }
};

const MODEL = {
  id: "gpt-5-mini",
  name: "gpt-5-mini",
  created: 1_700_000_000,
  provider: "openai" as const,
  pricing: {
    prompt: "0.0000012",
    completion: "0",
    image: "0",
    request: "0",
    input_cache_read: "0",
    input_cache_write: "0",
    web_search: "0",
    internal_reasoning: "0",
  },
};

const CONNECTED_OPENAI = {
  openai: {
    connected: true,
    configured: true,
    apiKeySet: true,
    provisioningKeySet: false,
    modelCount: 1,
  },
};

const emptyRollup = (): AutocompleteUsageSnapshot["today"] => ({
  date: "",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

const usageSnapshot = (
  overrides: Partial<AutocompleteUsageSnapshot> = {},
): AutocompleteUsageSnapshot => ({
  today: emptyRollup(),
  month: emptyRollup(),
  days: [],
  dailyCostCapUsd: 1500,
  ...overrides,
});

const baseElectronAPI = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
  setAutocompleteSettings: vi.fn().mockResolvedValue({ success: true }),
  getAutocompleteUsage: vi.fn().mockResolvedValue(usageSnapshot()),
  onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
  onActiveProfileChanged: vi.fn().mockReturnValue(vi.fn()),
  fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [MODEL] }),
  getProviderStates: vi.fn().mockResolvedValue(CONNECTED_OPENAI),
  getSelectedModel: vi.fn().mockResolvedValue(""),
  getFeatureModel: vi.fn().mockResolvedValue(""),
  setSelectedModel: vi.fn().mockResolvedValue({ success: true }),
  setFeatureModel: vi.fn().mockResolvedValue(undefined),
  getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
  setLocale: vi.fn().mockResolvedValue({ success: true }),
  onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
  ...overrides,
});

describe("SettingAutocomplete", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async (api: Record<string, unknown>) => {
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingAutocomplete)),
      );
    });
    await settleUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  const checkbox = (): HTMLInputElement | null =>
    container.querySelector('input[type="checkbox"]');

  /** A native `.click()` toggles `checked` and fires `change` the way jsdom
   * actually models a checkbox, unlike the setter-bypass trick `<select>`
   * needs — using that trick here left the synthetic `onChange` unfired. */
  const clickCheckbox = async (input: HTMLInputElement) => {
    await act(async () => {
      input.click();
    });
  };

  const openModelMenu = async () => {
    const input = container.querySelector("input#model-input");
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settleUi(2);
  };

  const menuRow = (title: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`p[title="${title}"]`);

  it("round-trips the enabled checkbox", async () => {
    const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        setAutocompleteSettings,
      }),
    );

    const input = checkbox();
    if (!input) throw new Error("autocomplete checkbox not rendered");
    expect(input.checked).toBe(true);

    await clickCheckbox(input);
    await settleUi();

    expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
      enabled: false,
      model: "",
      dailyCostCapUsd: 5,
    });
    expect(checkbox()?.checked).toBe(false);
  });

  const capField = (): HTMLInputElement | null =>
    container.querySelector("input#autocomplete-daily-cap");

  /** Types into the cap field and blurs, which is what commits it. */
  const typeCap = async (value: string, { blur = true } = {}) => {
    const input = capField();
    if (!input) throw new Error("daily cap field not rendered");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (blur) {
      await act(async () => {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    }
    await settleUi();
  };

  describe("daily spend cap", () => {
    it("shows the stored cap and persists a new one on blur", async () => {
      const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
          setAutocompleteSettings,
        }),
      );

      expect(capField()?.value).toBe("5");

      await typeCap("2.5");

      expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
        enabled: true,
        model: "",
        dailyCostCapUsd: 2.5,
      });
    });

    /**
     * The footgun this draft exists for. A user selecting the field and typing
     * passes through `""`, and a committed `""` is `0` — which means "spend
     * nothing" and turns the feature off with nothing on screen to say why.
     */
    it("writes nothing while the field is mid-edit", async () => {
      const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
          setAutocompleteSettings,
        }),
      );

      await typeCap("", { blur: false });

      expect(setAutocompleteSettings).not.toHaveBeenCalled();
      expect(capField()?.value).toBe("");
    });

    it("reverts to the stored cap when the field is left empty", async () => {
      const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
          setAutocompleteSettings,
        }),
      );

      await typeCap("");

      expect(setAutocompleteSettings).not.toHaveBeenCalled();
      expect(capField()?.value).toBe("5");
    });

    // Clamped rather than refused, matching the store: `clearInvalidConfig`
    // makes a rejecting schema a config-wipe, so the range is enforced here.
    it("clamps a cap beyond the maximum instead of storing it", async () => {
      const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
          setAutocompleteSettings,
        }),
      );

      await typeCap("5000");

      expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
        enabled: true,
        model: "",
        dailyCostCapUsd: 100,
      });
    });

    // A zero cap refuses every request, and nothing else on screen says so.
    it("warns that a zero cap blocks every suggestion", async () => {
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 0 }),
        }),
      );

      expect(container.textContent).toContain(
        tEn("settings.autocomplete.dailyCap.zero"),
      );
    });

    it("says nothing about a zero cap when one is set", async () => {
      await mount(
        baseElectronAPI({
          getAutocompleteSettings: vi
            .fn()
            .mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        }),
      );

      expect(container.textContent).not.toContain(
        tEn("settings.autocomplete.dailyCap.zero"),
      );
    });

    /**
     * The tab that recommends a local provider for privacy is the tab that has
     * to say the cap cannot see what a local provider spends — otherwise the
     * number reads as a guarantee it does not carry.
     */
    it("states that unpriced and local spend never reaches the cap", async () => {
      await mount(baseElectronAPI({}));

      expect(container.textContent).toContain(
        tEn("settings.autocomplete.dailyCap.unpricedHint"),
      );
    });
  });

  it("round-trips the model picker", async () => {
    const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: true });
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        setAutocompleteSettings,
      }),
    );

    await openModelMenu();
    const row = menuRow("gpt-5-mini");
    if (!row) throw new Error("gpt-5-mini option not rendered");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleUi();

    expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      model: "openai::gpt-5-mini",
      dailyCostCapUsd: 5,
    });
  });

  // A profile switch broadcasts `active-profile-changed`, not
  // `settings-updated` (`notifyActiveProfileChanged` in
  // `~/main/profileChange.ts`), and `settingsAutocomplete` is a per-profile
  // setting. Left unhandled, a Settings window open across a profile switch
  // keeps showing the OLD profile's enabled/model values, and the next
  // toggle or model pick would write that stale state into the newly active
  // profile.
  it("reloads settings on an active-profile-changed broadcast, not just settings-updated", async () => {
    let profileListener: (() => void) | undefined;
    const getAutocompleteSettings = vi
      .fn()
      .mockResolvedValueOnce({ enabled: true, model: "" });
    await mount(
      baseElectronAPI({
        getAutocompleteSettings,
        onActiveProfileChanged: vi.fn((callback: () => void) => {
          profileListener = callback;
          return vi.fn();
        }),
      }),
    );

    expect(checkbox()?.checked).toBe(true);
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.model.sameAsAskAI"),
    );

    if (!profileListener) {
      throw new Error("onActiveProfileChanged was not subscribed");
    }
    // The newly active profile has autocomplete off and a real model chosen.
    getAutocompleteSettings.mockResolvedValueOnce({
      enabled: false,
      model: "openai::gpt-5-mini",
      dailyCostCapUsd: 5,
    });
    await act(async () => {
      profileListener?.();
    });
    await settleUi();

    expect(getAutocompleteSettings).toHaveBeenCalledTimes(2);
    expect(checkbox()?.checked).toBe(false);
    expect(container.textContent).not.toContain(
      tEn("settings.autocomplete.model.sameAsAskAI"),
    );
  });

  it('shows "Same as Ask AI" for the empty inherit sentinel instead of a blank picker', async () => {
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
      }),
    );

    expect(container.textContent).toContain(
      tEn("settings.autocomplete.model.sameAsAskAI"),
    );
  });

  it("does not show the inherit caption once a real model is stored", async () => {
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi
          .fn()
          .mockResolvedValue({ enabled: true, model: "openai::gpt-5-mini" }),
      }),
    );

    expect(container.textContent).not.toContain(
      tEn("settings.autocomplete.model.sameAsAskAI"),
    );
  });

  it("states the privacy position honestly, recommending a local provider", async () => {
    await mount(baseElectronAPI());

    const privacyHint = tEn("settings.autocomplete.privacy.hint");
    expect(container.textContent).toContain(privacyHint);
    expect(privacyHint).toContain("Ollama");
    expect(privacyHint).toContain("LM Studio");
    expect(privacyHint).toContain("nothing leaves this machine");
  });

  /**
   * The warning half, pinned separately and in both locales.
   *
   * Autocomplete is the only feature that ships text the user has *not* sent
   * anywhere — every other path starts from an explicit selection or an
   * explicit submit. This sentence is their sole notice of that, and it is
   * the half a reword is most tempted to soften, so the reassuring clauses
   * above ("Ollama", "nothing leaves this machine") must not be able to carry
   * the test on their own.
   */
  it("warns that in-progress, unsent text is what gets transmitted, in both locales", async () => {
    await mount(baseElectronAPI());

    const privacyHintEn = tEn("settings.autocomplete.privacy.hint");
    expect(container.textContent).toContain(privacyHintEn);
    expect(privacyHintEn).toContain("the text you're typing");
    expect(privacyHintEn).toContain("before you send it anywhere");
    expect(privacyHintEn).toContain(
      "to whichever provider the selected model belongs to",
    );

    // Japanese is a real translation here, not an English fallback, so the
    // warning has to be pinned there too or JA users can quietly lose it.
    const privacyHintJa = tJa("settings.autocomplete.privacy.hint");
    expect(privacyHintJa).not.toBe(privacyHintEn);
    expect(privacyHintJa).toContain("まだどこにも送信していない");
    expect(privacyHintJa).toContain("入力中のテキスト");
    expect(privacyHintJa).toContain("選択したモデルが属するプロバイダー");
  });

  it("shows today and month-to-date usage, labelling requests as attempts rather than completions", async () => {
    const today = {
      date: "2026-07-31",
      requests: 5,
      responses: 5,
      tokenlessResponses: 0,
      unpricedResponses: 0,
      promptTokens: 100,
      completionTokens: 40,
      estimatedCostUsd: 0.02,
    };
    const month = {
      date: "2026-07",
      requests: 42,
      responses: 40,
      tokenlessResponses: 0,
      unpricedResponses: 0,
      promptTokens: 900,
      completionTokens: 300,
      estimatedCostUsd: 0.18,
    };
    await mount(
      baseElectronAPI({
        getAutocompleteUsage: vi
          .fn()
          .mockResolvedValue(usageSnapshot({ today, month })),
      }),
    );

    expect(container.textContent).toContain(tEn("settings.autocomplete.usage.today"));
    expect(container.textContent).toContain(tEn("settings.autocomplete.usage.month"));
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.usage.requests_other", { count: 5 }),
    );
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.usage.requests_other", { count: 42 }),
    );
    // "requests" counts every attempt dispatched to a provider, not just the
    // suggestions the user actually saw — the card must say so.
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.usage.requestsHint"),
    );

    // Hand-computed, NOT run through `formatOverviewCostHint` — deriving the
    // expectation from the very helper the component calls would keep this
    // file green through a 1000x error in that formatter.
    // 5 of 5 responses priced, $0.02 → full coverage, no "of" qualifier.
    expect(container.textContent).toContain("Est. $0.02");
    expect(container.textContent).toContain("Est. $0.18");
    expect(container.textContent).not.toContain("priced");
  });

  // Partial pricing is the branch a user is most likely to misread: the
  // amount shown covers only *some* of the day's responses, so the
  // "{priced} of {total}" qualifier is the whole point. Without a fixture
  // that has both priced and unpriced responses AND requests ≠ responses,
  // `hasNa` and `total` can both be mis-wired in silence.
  it("qualifies a partially priced day as an incomplete amount, counting responses not requests", async () => {
    const partiallyPriced = {
      date: "2026-07-31",
      // requests deliberately differs from responses: a `total: requests`
      // mis-wiring would otherwise read identically.
      requests: 4,
      responses: 3,
      tokenlessResponses: 0,
      unpricedResponses: 1,
      promptTokens: 300,
      completionTokens: 120,
      estimatedCostUsd: 0.05,
    };
    await mount(
      baseElectronAPI({
        getAutocompleteUsage: vi
          .fn()
          .mockResolvedValue(usageSnapshot({ today: partiallyPriced })),
      }),
    );

    // Hand-computed from `en/dashboard.json`'s
    // "overview.value.estimatedCostPartial" ("Est. {cost} · {priced} of
    // {total} priced"): 3 responses, 1 unpriced → 2 priced of 3, $0.05.
    expect(container.textContent).toContain("Est. $0.05 · 2 of 3 priced");
    // The requests headline still counts every attempt, so the two numbers
    // are visibly different in the same card.
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.usage.requests_other", { count: 4 }),
    );
    // A bare "Est. $0.05" would read as the day's complete spend.
    expect(container.textContent).not.toContain(
      tEn("overview.value.estimatedCostNa"),
    );
  });

  it("renders N/A rather than a fabricated $0 when nothing in the day is priced", async () => {
    const unpriced = {
      date: "2026-07-31",
      requests: 8,
      responses: 8,
      tokenlessResponses: 0,
      unpricedResponses: 8,
      promptTokens: 500,
      completionTokens: 200,
      estimatedCostUsd: 0,
    };
    await mount(
      baseElectronAPI({
        getAutocompleteUsage: vi
          .fn()
          .mockResolvedValue(usageSnapshot({ today: unpriced })),
      }),
    );

    expect(container.textContent).toContain(tEn("overview.value.estimatedCostNa"));
    expect(container.textContent).not.toContain("$0.00");
  });

  it("reverts the checkbox and shows an error when the write is guard-rejected", async () => {
    const setAutocompleteSettings = vi.fn().mockResolvedValue({ success: false });
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        setAutocompleteSettings,
      }),
    );

    const input = checkbox();
    if (!input) throw new Error("autocomplete checkbox not rendered");
    await clickCheckbox(input);
    await settleUi();

    expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
      enabled: false,
      model: "",
      dailyCostCapUsd: 5,
    });
    // The store was never written, so the checkbox must not keep showing the
    // rejected value — a silent stale-success UI is worse than the reload the
    // user would otherwise reach for.
    expect(checkbox()?.checked).toBe(true);
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.saveError"),
    );
  });

  // The other half of the same revert: `{ success: false }` is a *returned*
  // rejection, but a dead IPC channel or a main-process throw rejects the
  // promise instead. Both leave the store unwritten, so both must revert —
  // pinning only the returned half lets the whole `catch` body be deleted.
  it("reverts the checkbox and shows an error when the write throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setAutocompleteSettings = vi
      .fn()
      .mockRejectedValue(new Error("ipc channel closed"));
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        setAutocompleteSettings,
      }),
    );

    const input = checkbox();
    if (!input) throw new Error("autocomplete checkbox not rendered");
    await clickCheckbox(input);
    await settleUi();

    expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
      enabled: false,
      model: "",
      dailyCostCapUsd: 5,
    });
    expect(checkbox()?.checked).toBe(true);
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.saveError"),
    );
    // Never swallowed: the thrown cause has to reach the console too.
    expect(consoleError).toHaveBeenCalled();
  });

  // Same revert, driven through the model picker rather than the checkbox:
  // `persist` is shared, so a throw must not leave the picker advertising a
  // model the store never took.
  it("reverts the model picker when the write throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setAutocompleteSettings = vi
      .fn()
      .mockRejectedValue(new Error("ipc channel closed"));
    await mount(
      baseElectronAPI({
        getAutocompleteSettings: vi.fn().mockResolvedValue({ enabled: true, model: "", dailyCostCapUsd: 5 }),
        setAutocompleteSettings,
      }),
    );

    await openModelMenu();
    const row = menuRow("gpt-5-mini");
    if (!row) throw new Error("gpt-5-mini option not rendered");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleUi();

    expect(setAutocompleteSettings).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      model: "openai::gpt-5-mini",
      dailyCostCapUsd: 5,
    });
    // Back to the inherit sentinel, whose caption is the visible proof.
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.model.sameAsAskAI"),
    );
    expect(container.textContent).toContain(
      tEn("settings.autocomplete.saveError"),
    );
  });
});
