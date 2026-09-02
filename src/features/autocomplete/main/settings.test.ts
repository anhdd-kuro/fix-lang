import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DAILY_COST_CAP_USD } from "~/features/autocomplete/shared/autocompleteSettings";
import { registerAutocompleteSettingsHandlers } from "./settings";

const { electronMocks, apiStoreMocks } = vi.hoisted(() => ({
  electronMocks: { handle: vi.fn() },
  apiStoreMocks: {
    getProfileSetting: vi.fn(),
    updateProfileSetting: vi.fn(),
  },
}));

vi.mock("electron", () => ({ ipcMain: { handle: electronMocks.handle } }));
vi.mock("~/features/providers/store/apiStore", () => apiStoreMocks);

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no handler registered for channel "${channel}"`);
  return call[1] as Handler;
};

describe("registerAutocompleteSettingsHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAutocompleteSettingsHandlers();
  });

  describe("get-autocomplete-settings", () => {
    it("returns the normalized settings from the active profile", async () => {
      apiStoreMocks.getProfileSetting.mockReturnValue({
        enabled: false,
        model: "openai::gpt-5",
      });

      const result = await getHandler("get-autocomplete-settings")(undefined);

      expect(apiStoreMocks.getProfileSetting).toHaveBeenCalledWith(
        "settingsAutocomplete",
      );
      expect(result).toEqual({
        enabled: false,
        model: "openai::gpt-5",
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });

    it("falls back to normalized defaults instead of throwing when the store errors", async () => {
      apiStoreMocks.getProfileSetting.mockImplementation(() => {
        throw new Error("store unavailable");
      });

      const result = await getHandler("get-autocomplete-settings")(undefined);

      expect(result).toEqual({
        enabled: false,
        model: "",
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });

    it("normalizes a raw stored value missing enabled, rather than trusting the store to have normalized it", async () => {
      // Mirrors a profile created before this feature existed: the stored
      // node has a model but never got an `enabled` field written.
      apiStoreMocks.getProfileSetting.mockReturnValue({
        model: "openai::gpt-5",
      });

      const result = await getHandler("get-autocomplete-settings")(undefined);

      expect(result).toEqual({
        enabled: false,
        model: "openai::gpt-5",
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });

    it("normalizes a raw stored value with junk field types", async () => {
      apiStoreMocks.getProfileSetting.mockReturnValue({
        enabled: "nope",
        model: 42,
      });

      const result = await getHandler("get-autocomplete-settings")(undefined);

      expect(result).toEqual({
        enabled: false,
        model: "",
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });

    it("normalizes a null stored value", async () => {
      apiStoreMocks.getProfileSetting.mockReturnValue(null);

      const result = await getHandler("get-autocomplete-settings")(undefined);

      expect(result).toEqual({
        enabled: false,
        model: "",
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });
  });

  describe("set-autocomplete-settings", () => {
    it("persists a valid payload through updateProfileSetting", async () => {
      apiStoreMocks.updateProfileSetting.mockReturnValue({ success: true });

      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: true,
        model: "ollama::llama3",
        dailyCostCapUsd: 2.5,
      });

      expect(apiStoreMocks.updateProfileSetting).toHaveBeenCalledWith(
        "settingsAutocomplete",
        { enabled: true, model: "ollama::llama3", dailyCostCapUsd: 2.5 },
      );
      expect(result).toEqual({ success: true });
    });

    it("propagates a failure result from updateProfileSetting", async () => {
      apiStoreMocks.updateProfileSetting.mockReturnValue({
        success: false,
        error: "write failed",
      });

      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: true,
        model: "",
        dailyCostCapUsd: 5,
      });

      expect(result).toEqual({ success: false, error: "write failed" });
    });

    it("rejects a payload missing enabled without calling updateProfileSetting", async () => {
      const result = await getHandler("set-autocomplete-settings")(undefined, {
        model: "openai::gpt-5",
        dailyCostCapUsd: 5,
      });

      expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Malformed autocomplete settings",
      });
    });

    it("rejects a payload whose enabled is not a boolean", async () => {
      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: "yes",
        model: "openai::gpt-5",
        dailyCostCapUsd: 5,
      });

      expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Malformed autocomplete settings",
      });
    });

    it("rejects a payload missing model without calling updateProfileSetting", async () => {
      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: true,
        dailyCostCapUsd: 5,
      });

      expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Malformed autocomplete settings",
      });
    });

    it("rejects a payload whose model is not a string", async () => {
      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: true,
        model: 42,
        dailyCostCapUsd: 5,
      });

      expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Malformed autocomplete settings",
      });
    });

    it.each([
      { enabled: true, model: "" }, // missing cap
      { enabled: true, model: "", dailyCostCapUsd: "5" }, // non-number cap
      // Both are `typeof "number"` and both make `estimatedCostUsd >= cap`
      // permanently false, so a payload carrying one is a budget that never
      // fires — rejected here rather than clamped, because there is no honest
      // number to clamp them TO.
      { enabled: true, model: "", dailyCostCapUsd: Number.NaN },
      { enabled: true, model: "", dailyCostCapUsd: Number.POSITIVE_INFINITY },
    ])(
      "rejects an unusable daily cap without calling updateProfileSetting: %j",
      async (payload) => {
        const result = await getHandler("set-autocomplete-settings")(
          undefined,
          payload,
        );

        expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
        expect(result).toEqual({
          success: false,
          error: "Malformed autocomplete settings",
        });
      },
    );

    it.each([undefined, null, "a string", 42, []])(
      // `%j` stringifies an array fixture the same as `undefined`, so the
      // index (`%#`) keeps this and the `undefined` case from sharing a name.
      "rejects a non-object payload (case %#): %j",
      async (payload) => {
        const result = await getHandler("set-autocomplete-settings")(
          undefined,
          payload,
        );

        expect(apiStoreMocks.updateProfileSetting).not.toHaveBeenCalled();
        expect(result).toEqual({
          success: false,
          error: "Malformed autocomplete settings",
        });
      },
    );

    it("catches an updateProfileSetting throw and reports it instead of rejecting the promise", async () => {
      apiStoreMocks.updateProfileSetting.mockImplementation(() => {
        throw new Error("disk full");
      });

      const result = await getHandler("set-autocomplete-settings")(undefined, {
        enabled: true,
        model: "",
        dailyCostCapUsd: 5,
      });

      expect(result).toEqual({ success: false, error: "disk full" });
    });
  });
});
