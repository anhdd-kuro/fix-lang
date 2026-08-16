import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXCLUDED_BUNDLE_IDS } from "~/features/autocomplete/shared/autocompleteScope";
import { autocompleteSettingsFeature } from "./autocompleteSettings";
import type { AutocompleteSettings } from "~/features/autocomplete/shared/autocompleteSettings";

const NORMALIZED_SCOPE_DEFAULTS = {
  scopeMode: "allowlist" as const,
  allowedApps: [],  excludedApps: [...DEFAULT_EXCLUDED_BUNDLE_IDS],
  cloudScopeConsent: "",
};

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

describe("autocompleteSettings preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAutocompleteSettings", () => {
    it("invokes get-autocomplete-settings and returns a valid result", async () => {
      electronMocks.invoke.mockResolvedValue({
        enabled: false,
        model: "openai::gpt-5",
        dailyCostCapUsd: 5,
        scopeMode: "denylist",
        allowedApps: [],        excludedApps: ["com.apple.mail"],
        cloudScopeConsent: "openai",
      });

      const result = await autocompleteSettingsFeature.getAutocompleteSettings();

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "get-autocomplete-settings",
      );
      expect(result).toEqual({
        enabled: false,
        model: "openai::gpt-5",
        dailyCostCapUsd: 5,
        scopeMode: "denylist",
        allowedApps: [],        excludedApps: ["com.apple.mail"],
        cloudScopeConsent: "openai",
      });
    });

    it.each([
      undefined,
      null,
      "a string",
      42,
      { model: "openai::gpt-5", dailyCostCapUsd: 5 }, // missing enabled
      { enabled: "yes", model: "", dailyCostCapUsd: 5 }, // non-boolean enabled
      { enabled: true, dailyCostCapUsd: 5 }, // missing model
      { enabled: true, model: 42, dailyCostCapUsd: 5 }, // non-string model
      { enabled: true, model: "" }, // missing cap
      { enabled: true, model: "", dailyCostCapUsd: "5" }, // non-number cap
      // A cap that is `number` and unusable. `estimatedCostUsd >= NaN` is
      // always false, so this shape reaches the service as "no cap at all".
      { enabled: true, model: "", dailyCostCapUsd: Number.NaN },
      { enabled: true, model: "", dailyCostCapUsd: Number.POSITIVE_INFINITY },
      [], // array: typeof is "object" but has neither field
    ])(
      // `%j` stringifies `[]` the same as `undefined`, so the index (`%#`)
      // keeps the array case from sharing a name with the `undefined` case.
      "falls back to normalized defaults for a malformed main-process reply (case %#): %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await autocompleteSettingsFeature.getAutocompleteSettings();

        expect(result).toEqual({
          enabled: false,
          model: "",
          dailyCostCapUsd: 5,
          ...NORMALIZED_SCOPE_DEFAULTS,
        });
      },
    );
  });

  describe("setAutocompleteSettings", () => {
    it("invokes set-autocomplete-settings with a valid payload and returns the result", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true });

      const result = await autocompleteSettingsFeature.setAutocompleteSettings({
        enabled: true,
        model: "ollama::llama3",
        dailyCostCapUsd: 5,
        scopeMode: "denylist",
        allowedApps: [],        excludedApps: ["com.apple.mail"],
        cloudScopeConsent: "",
      });

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "set-autocomplete-settings",
        {
          enabled: true,
          model: "ollama::llama3",
          dailyCostCapUsd: 5,
          scopeMode: "denylist",
          allowedApps: [],          excludedApps: ["com.apple.mail"],
          cloudScopeConsent: "",
        },
      );
      expect(result).toEqual({ success: true });
    });

    it("propagates a failure result from the main process", async () => {
      electronMocks.invoke.mockResolvedValue({
        success: false,
        error: "write failed",
      });

      const result = await autocompleteSettingsFeature.setAutocompleteSettings({
        enabled: true,
        model: "",
        dailyCostCapUsd: 5,
        scopeMode: "allowlist",
        allowedApps: [],        excludedApps: [],
        cloudScopeConsent: "",
      });

      expect(result).toEqual({ success: false, error: "write failed" });
    });

    it.each([
      undefined,
      null,
      "a string",
      42,
      { model: "openai::gpt-5", dailyCostCapUsd: 5 }, // missing enabled
      { enabled: "yes", model: "", dailyCostCapUsd: 5 }, // non-boolean enabled
      { enabled: true, dailyCostCapUsd: 5 }, // missing model
      { enabled: true, model: 42, dailyCostCapUsd: 5 }, // non-string model
      { enabled: true, model: "" }, // missing cap
      { enabled: true, model: "", dailyCostCapUsd: "5" }, // non-number cap
      { enabled: true, model: "", dailyCostCapUsd: Number.NaN }, // unusable cap
      [], // array: typeof is "object" but has neither field
    ])(
      // `%j` stringifies `[]` the same as `undefined`, so the index (`%#`)
      // keeps the array case from sharing a name with the `undefined` case.
      "rejects a malformed payload without invoking the main process (case %#): %j",
      async (payload) => {
        const result = await autocompleteSettingsFeature.setAutocompleteSettings(
          payload as unknown as AutocompleteSettings,
        );

        expect(electronMocks.invoke).not.toHaveBeenCalled();
        expect(result).toEqual({ success: false });
      },
    );

    // Every fixture above omits all three scope fields, so each is rejected for
    // two reasons at once and none of them would notice a weakened scope check.
    // These vary ONE scope field against an otherwise-valid payload.
    it.each([
      ["an unknown scopeMode", { scopeMode: "everywhere", allowedApps: [], excludedApps: [], cloudScopeConsent: "" }],
      ["a non-array excludedApps", { scopeMode: "allowlist", allowedApps: [], excludedApps: "com.apple.mail", cloudScopeConsent: "" }],
      ["a non-string cloudScopeConsent", { scopeMode: "allowlist", allowedApps: [], excludedApps: [], cloudScopeConsent: true }],
    ])("rejects %s in an otherwise-valid payload", async (_description, scope) => {
      const result = await autocompleteSettingsFeature.setAutocompleteSettings({
        enabled: true,
        model: "ollama::llama3",
        dailyCostCapUsd: 5,
        ...scope,
      } as unknown as AutocompleteSettings);

      expect(electronMocks.invoke).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false });
    });
  });
});
