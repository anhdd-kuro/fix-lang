import { beforeEach, describe, expect, it, vi } from "vitest";
import { autocompleteSettingsFeature } from "./autocompleteSettings";

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
      });

      const result = await autocompleteSettingsFeature.getAutocompleteSettings();

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "get-autocomplete-settings",
      );
      expect(result).toEqual({ enabled: false, model: "openai::gpt-5" });
    });

    it.each([
      undefined,
      null,
      "a string",
      42,
      { model: "openai::gpt-5" }, // missing enabled
      { enabled: "yes", model: "" }, // non-boolean enabled
      { enabled: true }, // missing model
      { enabled: true, model: 42 }, // non-string model
      [], // array: typeof is "object" but has neither field
    ])(
      // `%j` stringifies `[]` the same as `undefined`, so the index (`%#`)
      // keeps the array case from sharing a name with the `undefined` case.
      "falls back to normalized defaults for a malformed main-process reply (case %#): %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await autocompleteSettingsFeature.getAutocompleteSettings();

        expect(result).toEqual({ enabled: true, model: "" });
      },
    );
  });

  describe("setAutocompleteSettings", () => {
    it("invokes set-autocomplete-settings with a valid payload and returns the result", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true });

      const result = await autocompleteSettingsFeature.setAutocompleteSettings({
        enabled: true,
        model: "ollama::llama3",
      });

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "set-autocomplete-settings",
        { enabled: true, model: "ollama::llama3" },
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
      });

      expect(result).toEqual({ success: false, error: "write failed" });
    });

    it.each([
      undefined,
      null,
      "a string",
      42,
      { model: "openai::gpt-5" }, // missing enabled
      { enabled: "yes", model: "" }, // non-boolean enabled
      { enabled: true }, // missing model
      { enabled: true, model: 42 }, // non-string model
      [], // array: typeof is "object" but has neither field
    ])(
      // `%j` stringifies `[]` the same as `undefined`, so the index (`%#`)
      // keeps the array case from sharing a name with the `undefined` case.
      "rejects a malformed payload without invoking the main process (case %#): %j",
      async (payload) => {
        const result = await autocompleteSettingsFeature.setAutocompleteSettings(
          payload as unknown as { enabled: boolean; model: string },
        );

        expect(electronMocks.invoke).not.toHaveBeenCalled();
        expect(result).toEqual({ success: false });
      },
    );
  });
});
