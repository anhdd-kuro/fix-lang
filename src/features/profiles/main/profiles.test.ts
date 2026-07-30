/**
 * @file profiles.test.ts
 * @description Regression test for the PR #87 review finding: `profiles.ts`
 * IPC handlers' app-authored validation errors ("Profile not found", "No
 * profiles available", "Invalid profile format", …) used to be raw English
 * strings the renderer displayed verbatim via `textLabel()`, so they never
 * translated to Japanese. They are now `Message` descriptors (wrapped as a
 * `Label` via `messageLabel()`), resolved at render time.
 *
 * This captures the real handlers registered by `registerProfileHandlers`
 * (via a stub `ipcMain.handle`) and invokes them directly, mirroring
 * `connectProvider.test.ts`'s approach for `api.ts`. Expected copy is
 * derived through the real translator kernel (`createTranslator`) — never
 * hand-restated — so a catalog reword can't silently break this file, and an
 * English-fallback regression still fails a test that asserts the JA text.
 *
 * Also covers the boundary decision for handlers whose primary result passes
 * through a store module (`apiStore.ts`) outside this migration's scope
 * (`api.ts`/`profiles.ts` only, per the review) — `apply-profile` wraps that
 * pass-through error as an opaque `textLabel` rather than guessing at
 * translatability, so it is asserted to render identically in both locales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabel, resolveLabel } from "~/features/i18n/shared/message";
import { createTranslator } from "~/features/i18n/shared/translate";
// Hoisted by Vitest's transform to the top of the module regardless of
// source position (same as every `vi.mock(...)` below), so this safely
// resolves against the mocked modules despite appearing before them here —
// matching import/order's required relative-import group placement.
import { registerProfileHandlers } from "./profiles";

const tEn = createTranslator("en");
const tJa = createTranslator("ja");

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
  Notification: vi.fn().mockImplementation(() => ({ show: notificationShow })),
}));
vi.mock("~/main/keybindings", () => ({
  reloadHotkeys: vi.fn(),
}));
// Reached through `~/main/profileChange` (the profile-activation chokepoint).
// Stubbed for its import chain only — `attachThemeSync` -> theme store ->
// electron-store, which needs a `projectName` this suite never provides.
vi.mock("~/main/webViewWindows/askInputWindow", () => ({
  dismissAskInputWindow: vi.fn(),
}));
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  clearLegacyApiKey: vi.fn().mockResolvedValue({ success: true }),
  getLegacyApiKey: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  clearProfileSecrets: vi.fn().mockResolvedValue({ success: true }),
  hasProfileSecret: vi.fn().mockResolvedValue(false),
  setProfileSecret: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("~/features/providers/store/provisioningKeyStore", () => ({
  clearLegacyProvisioningKey: vi.fn().mockResolvedValue({ success: true }),
  getLegacyProvisioningKey: vi.fn().mockResolvedValue(null),
}));
// Sidesteps `mainT()` (~/main/i18n, its own locale-store/electron-store
// dependency chain) — this file tests profiles.ts's own error descriptors,
// not the separate main-process notification copy.
vi.mock("./profileNotifications", () => ({
  buildProfileNotification: vi.fn().mockReturnValue({ title: "t", body: "b" }),
  buildProfilesUpdatedNotification: vi.fn().mockReturnValue({ title: "t", body: "b" }),
}));

const {
  getProfilesMock,
  getCurrentProfileIdMock,
  createProfileMock,
  applyProfileMock,
  updateProfileMock,
  deleteProfileMock,
  switchToNextProfileMock,
  getProfileByIdMock,
  initializeDefaultProfileMock,
  withoutProfileSecretsMock,
  toExportableProfileMock,
  sanitizeImportedProfileMock,
  apiStoreSetMock,
  apiStoreGetMock,
} = vi.hoisted(() => ({
  getProfilesMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn(),
  createProfileMock: vi.fn(),
  applyProfileMock: vi.fn(),
  updateProfileMock: vi.fn(),
  deleteProfileMock: vi.fn(),
  switchToNextProfileMock: vi.fn(),
  getProfileByIdMock: vi.fn(),
  initializeDefaultProfileMock: vi.fn(),
  withoutProfileSecretsMock: vi.fn((profile: unknown) => profile),
  toExportableProfileMock: vi.fn((profile: unknown) => profile),
  sanitizeImportedProfileMock: vi.fn((profile: unknown) => profile),
  apiStoreSetMock: vi.fn(),
  apiStoreGetMock: vi.fn().mockReturnValue([]),
}));

vi.mock("~/features/providers/store/apiStore", () => ({
  getProfiles: getProfilesMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  createProfile: createProfileMock,
  applyProfile: applyProfileMock,
  updateProfile: updateProfileMock,
  deleteProfile: deleteProfileMock,
  switchToNextProfile: switchToNextProfileMock,
  getProfileById: getProfileByIdMock,
  initializeDefaultProfile: initializeDefaultProfileMock,
  apiStore: { get: apiStoreGetMock, set: apiStoreSetMock, delete: vi.fn() },
  withoutProfileSecrets: withoutProfileSecretsMock,
  toExportableProfile: toExportableProfileMock,
  sanitizeImportedProfile: sanitizeImportedProfileMock,
}));

describe("profiles.ts IPC handlers — app-authored validation errors are translatable Messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    onHandlers.clear();
    getProfilesMock.mockReturnValue([]);
    getCurrentProfileIdMock.mockReturnValue("profile_1");
    // vi.clearAllMocks() clears calls but NOT return values or
    // implementations, so leaked ones would decide later tests — and a leaked
    // profile makes the fire-and-forget legacy migration reject unhandled.
    getProfileByIdMock.mockReturnValue(undefined);
    withoutProfileSecretsMock.mockImplementation((profile: unknown) => profile);
    toExportableProfileMock.mockImplementation((profile: unknown) => profile);
    sanitizeImportedProfileMock.mockImplementation((profile: unknown) => profile);
    registerProfileHandlers();
  });

  it("update-profile: 'Profile not found' resolves to different EN/JA text via the catalog", async () => {
    updateProfileMock.mockReturnValue(null);
    const handler = handlers.get("update-profile");
    const result = (await handler?.(undefined, { profileId: "missing" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(isLabel(result.error)).toBe(true);
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    expect(en).toBe(tEn("common.error.profileNotFound"));
    expect(ja).toBe(tJa("common.error.profileNotFound"));
    expect(ja).not.toBe(en);
  });

  it("export-profile: 'Profile not found' resolves to different EN/JA text via the catalog", async () => {
    getProfileByIdMock.mockReturnValue(undefined);
    const handler = handlers.get("export-profile");
    const result = (await handler?.(undefined, { profileId: "missing" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    expect(en).toBe(tEn("common.error.profileNotFound"));
    expect(ja).toBe(tJa("common.error.profileNotFound"));
    expect(ja).not.toBe(en);
  });

  // The two strippers are not interchangeable: `withoutProfileSecrets` is
  // written back to disk by the legacy migration, so widening it to also drop
  // model state would wipe an upgrading user's cache on first launch.
  it("export-profile serialises toExportableProfile, not the disk-writeback stripper", async () => {
    // `settings` is required: the fire-and-forget legacy migration
    // dereferences `profile.settings.apiKey` and would reject unhandled.
    const storedProfile = { id: "profile_1", name: "Work", settings: { apiKey: "" } };
    getProfileByIdMock.mockReturnValue(storedProfile);
    toExportableProfileMock.mockReturnValue({ id: "profile_1", strippedBy: "toExportableProfile" });
    withoutProfileSecretsMock.mockReturnValue({
      id: "profile_1",
      strippedBy: "withoutProfileSecrets",
    });

    const handler = handlers.get("export-profile");
    const result = (await handler?.(undefined, { profileId: "profile_1" })) as {
      success: boolean;
      profileJson?: string;
    };

    expect(result.success).toBe(true);
    expect(JSON.parse(result.profileJson ?? "{}")).toEqual({
      id: "profile_1",
      strippedBy: "toExportableProfile",
    });
    expect(toExportableProfileMock).toHaveBeenCalledWith(storedProfile);
    expect(withoutProfileSecretsMock).not.toHaveBeenCalled();
  });

  it("legacy-secret migration writes back withoutProfileSecrets, preserving the model cache", async () => {
    const storedProfile = {
      id: "profile_1",
      name: "Work",
      settings: {
        apiKey: "legacy-plaintext-key",
        models: [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }],
        selectedModel: "openai::gpt-4o",
        enabledProviders: ["openai", "openrouter"],
        settingsCorrect: { presets: [{ id: "correct", model: "openai::gpt-4o" }] },
      },
    };
    getProfileByIdMock.mockReturnValue(storedProfile);
    getProfilesMock.mockReturnValue([storedProfile]);
    // Mirrors the real narrow helper: secrets out, everything else untouched.
    withoutProfileSecretsMock.mockImplementation((profile: unknown) => {
      const { settings, ...rest } = profile as { settings: Record<string, unknown> };
      const { apiKey: _apiKey, ...restSettings } = settings;
      return { ...rest, settings: restSettings };
    });

    // registerProfileHandlers fires `void migrateLegacySecretsToActiveProfile()`.
    registerProfileHandlers();
    await vi.waitFor(() => {
      expect(apiStoreSetMock).toHaveBeenCalled();
    });

    expect(withoutProfileSecretsMock).toHaveBeenCalledWith(storedProfile);
    // The wide stripper must never appear on the disk-writeback path.
    expect(toExportableProfileMock).not.toHaveBeenCalled();

    const [key, written] = apiStoreSetMock.mock.calls.at(-1) as [string, unknown[]];
    expect(key).toBe("profiles");
    const writtenProfile = written[0] as { settings: Record<string, unknown> };
    expect(writtenProfile.settings.apiKey).toBeUndefined();
    expect(writtenProfile.settings.models).toEqual(storedProfile.settings.models);
    expect(writtenProfile.settings.selectedModel).toBe("openai::gpt-4o");
    expect(writtenProfile.settings.enabledProviders).toEqual(["openai", "openrouter"]);
    expect(writtenProfile.settings.settingsCorrect).toEqual(
      storedProfile.settings.settingsCorrect,
    );
  });

  it("switch-to-next-profile: 'No profiles available' resolves to different EN/JA text via the catalog", async () => {
    switchToNextProfileMock.mockReturnValue(null);
    const handler = handlers.get("switch-to-next-profile");
    const result = (await handler?.(undefined)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    expect(en).toBe(tEn("common.error.noProfilesAvailable"));
    expect(ja).toBe(tJa("common.error.noProfilesAvailable"));
    expect(ja).not.toBe(en);
  });

  it("import-profile: 'Invalid profile format' resolves to different EN/JA text via the catalog", async () => {
    sanitizeImportedProfileMock.mockReturnValue({});
    const handler = handlers.get("import-profile");
    const result = (await handler?.(undefined, { profileJson: "{}" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    expect(en).toBe(tEn("common.error.invalidProfileFormat"));
    expect(ja).toBe(tJa("common.error.invalidProfileFormat"));
    expect(ja).not.toBe(en);
  });

  it("create-profile: an unexpected non-Error throw falls back to a translatable 'Unknown error' Message", async () => {
    createProfileMock.mockImplementation(() => {
       
      throw "boom";
    });
    const handler = handlers.get("create-profile");
    const result = (await handler?.(undefined, { name: "x" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    expect(en).toBe(tEn("models.select.error.unknown"));
    expect(ja).toBe(tJa("models.select.error.unknown"));
    expect(ja).not.toBe(en);
  });

  it("create-profile: a real Error's message crosses as opaque raw text, not translated", async () => {
    createProfileMock.mockImplementation(() => {
      throw new Error("disk full");
    });
    const handler = handlers.get("create-profile");
    const result = (await handler?.(undefined, { name: "x" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "disk full" });
  });

  it("apply-profile: a store-authored error (apiStore.ts, outside this migration's scope) is boundary-wrapped as opaque and stays identical across locales", async () => {
    // `applyProfile` (apiStore.ts) is out of scope for this migration — its
    // error text is neither guessed at as translatable nor left untyped; it
    // is boundary-wrapped as an opaque `textLabel` by `wrapStoreResult`.
    applyProfileMock.mockReturnValue({ success: false, error: "Profile not found" });
    const handler = handlers.get("apply-profile");
    const result = (await handler?.(undefined, { profileId: "x" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "Profile not found" });
    const en = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tEn);
    const ja = resolveLabel(result.error as Parameters<typeof resolveLabel>[0], tJa);
    // Opaque text is identical in both locales by construction — this is the
    // one case in this file where EN and JA must NOT differ.
    expect(en).toBe("Profile not found");
    expect(ja).toBe("Profile not found");
  });
});
