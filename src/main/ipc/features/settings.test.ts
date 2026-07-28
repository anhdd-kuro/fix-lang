/**
 * @file settings.test.ts
 * @description Regression test for the PR #87 review finding: `settings.ts`
 * IPC handlers' app-authored validation errors ("Invalid correction output
 * mode", "Invalid key") and a store-passthrough/exception path used to be raw
 * English strings the renderer displayed verbatim via `textLabel()`, so they
 * never translated to Japanese. They are now `Message` descriptors (wrapped
 * as a `Label` via `messageLabel()`), or boundary-wrapped opaque `Label`s via
 * `exceptionLabel()`/`wrapStoreResult()`, resolved at render time.
 *
 * This captures the real handlers registered by `registerSettingsHandlers`
 * (via a stub `ipcMain.handle`) and invokes them directly, mirroring
 * `apiMessages.test.ts`/`profiles.test.ts`'s approach for `api.ts`/
 * `profiles.ts`. Expected copy is derived through the real translator kernel
 * (`createTranslator`) — never hand-restated — so a catalog reword can't
 * silently break this file, and an English-fallback regression still fails a
 * test that asserts the JA text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabel, resolveLabel } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
// `registerSettingsHandlers` (registers the real handlers into `handlers`)
// and the `vi.mock(...)` calls below are both hoisted by Vitest's transform
// to the top of the module regardless of source position, so this import
// safely resolves against the mocked modules despite appearing before them
// here — matching import/order's required group placement.
import { registerSettingsHandlers } from "./settings";
import type { Label } from "~/shared/i18n/message";

const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const resolveBoth = (label: unknown): { en: string; ja: string } => {
  expect(isLabel(label)).toBe(true);
  return {
    en: resolveLabel(label as Label, tEn),
    ja: resolveLabel(label as Label, tJa),
  };
};

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const onHandlers = new Map<string, (...args: unknown[]) => unknown>();
const notificationShow = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      onHandlers.set(channel, listener);
    },
  },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  Notification: vi.fn().mockImplementation(() => ({ show: notificationShow })),
}));

const {
  getKeyBindingsMock,
  setKeyBindingsMock,
  resetKeyBindingsMock,
  getCorrectionOutputModeMock,
  setCorrectionOutputModeMock,
  setProvisioningKeyMock,
  clearProvisioningKeyMock,
  hasProvisioningKeyMock,
} = vi.hoisted(() => ({
  getKeyBindingsMock: vi.fn(),
  setKeyBindingsMock: vi.fn(),
  resetKeyBindingsMock: vi.fn(),
  getCorrectionOutputModeMock: vi.fn(),
  setCorrectionOutputModeMock: vi.fn(),
  setProvisioningKeyMock: vi.fn(),
  clearProvisioningKeyMock: vi.fn(),
  hasProvisioningKeyMock: vi.fn(),
}));

vi.mock("~/main/keybindings", () => ({
  reloadHotkeys: vi.fn(),
  unregisterHotkeys: vi.fn(),
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: {
    getKeyBindings: getKeyBindingsMock,
    setKeyBindings: setKeyBindingsMock,
    resetKeyBindings: resetKeyBindingsMock,
  },
}));
vi.mock("~/stores/outputModeStore", () => ({
  outputModeStore: {
    getCorrectionOutputMode: getCorrectionOutputModeMock,
    setCorrectionOutputMode: setCorrectionOutputModeMock,
  },
}));
vi.mock("~/stores/provisioningKeyStore", () => ({
  setProvisioningKey: setProvisioningKeyMock,
  clearProvisioningKey: clearProvisioningKeyMock,
  hasProvisioningKey: hasProvisioningKeyMock,
}));
// Sidesteps `mainT()` (~/main/i18n, its own locale-store/electron-store
// dependency chain) — this file tests settings.ts's own error descriptors,
// not the separate main-process notification copy.
vi.mock("./settingsNotifications", () => ({
  buildSettingsSavedNotification: vi.fn().mockReturnValue({ title: "t", body: "b" }),
}));

describe("settings.ts IPC handlers — app-authored validation errors are translatable Messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    onHandlers.clear();
    registerSettingsHandlers();
  });

  it("set-correction-output-mode: an invalid mode is a translatable 'Invalid correction output mode' Message", async () => {
    const handler = handlers.get("set-correction-output-mode");
    const result = (await handler?.(undefined, "bogus")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("settings.general.outputMode.invalid"));
    expect(ja).toBe(tJa("settings.general.outputMode.invalid"));
    expect(ja).not.toBe(en);
  });

  it("set-correction-output-mode: a valid mode still commits and returns no error", async () => {
    const handler = handlers.get("set-correction-output-mode");
    const result = (await handler?.(undefined, "popup")) as {
      success: boolean;
      mode?: string;
      error?: unknown;
    };

    expect(result).toEqual({ success: true, mode: "popup" });
    expect(setCorrectionOutputModeMock).toHaveBeenCalledWith("popup");
  });

  it("set-key-bindings: a real Error thrown by the store crosses as opaque raw text, not translated", async () => {
    setKeyBindingsMock.mockImplementation(() => {
      throw new Error("disk full");
    });
    const handler = handlers.get("set-key-bindings");
    const result = (await handler?.(undefined, { promptGen: "A", profileSwitch: "B" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "disk full" });
    const { en, ja } = resolveBoth(result.error);
    // Opaque text is identical in both locales by construction.
    expect(en).toBe("disk full");
    expect(ja).toBe("disk full");
  });

  it("set-key-bindings: an unexpected non-Error throw still crosses as opaque raw (stringified) text", async () => {
    setKeyBindingsMock.mockImplementation(() => {

      throw "boom";
    });
    const handler = handlers.get("set-key-bindings");
    const result = (await handler?.(undefined, { promptGen: "A", profileSwitch: "B" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "boom" });
  });

  it("set-provisioning-key: a non-string key is a translatable 'Invalid key' Message", async () => {
    const handler = handlers.get("set-provisioning-key");
    const result = (await handler?.(undefined, "openrouter", 42)) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("settings.general.provisioningKey.invalid"));
    expect(ja).toBe(tJa("settings.general.provisioningKey.invalid"));
    expect(ja).not.toBe(en);
  });

  it.each<string | undefined>([
    "ollama", // a provider with no admin-key slot
    undefined, // a missing provider argument
    "constructor", // a prototype key that must not read truthy off the lookup map
  ])(
    "set-provisioning-key: rejects %s as a provider without touching the store",
    async (provider) => {
      const handler = handlers.get("set-provisioning-key");
      const result = (await handler?.(undefined, provider, "sk-abc")) as {
        success: boolean;
      };

      expect(result.success).toBe(false);
      expect(setProvisioningKeyMock).not.toHaveBeenCalled();
    },
  );

  it("has-provisioning-key: an unsupported provider reads as 'no key', never as the OpenRouter slot", async () => {
    hasProvisioningKeyMock.mockResolvedValue(true);
    const handler = handlers.get("has-provisioning-key");

    await expect(handler?.(undefined, "ollama")).resolves.toBe(false);
    expect(hasProvisioningKeyMock).not.toHaveBeenCalled();

    await expect(handler?.(undefined, "openai")).resolves.toBe(true);
    expect(hasProvisioningKeyMock).toHaveBeenCalledWith("openai");
  });

  it("set-provisioning-key: a store-authored error (provisioningKeyStore.ts, outside this migration's scope) is boundary-wrapped as opaque and stays identical across locales", async () => {
    setProvisioningKeyMock.mockResolvedValue({ success: false, error: "No active profile" });
    const handler = handlers.get("set-provisioning-key");
    const result = (await handler?.(undefined, "openrouter", "sk-or-abc")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "No active profile" });
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe("No active profile");
    expect(ja).toBe("No active profile");
  });

  it("clear-provisioning-key: a store-authored error is boundary-wrapped as opaque", async () => {
    clearProvisioningKeyMock.mockResolvedValue({ success: false, error: "Failed to clear key" });
    const handler = handlers.get("clear-provisioning-key");
    const result = (await handler?.(undefined, "openrouter")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "Failed to clear key" });
  });
});
