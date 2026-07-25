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
 * `applyProviderSetup.test.ts`'s approach for `api.ts`. Expected copy is
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
import { isLabel, resolveLabel } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
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
vi.mock("~/stores/apiKeyStore", () => ({
  clearLegacyApiKey: vi.fn().mockResolvedValue({ success: true }),
  getLegacyApiKey: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/stores/profileSecretStore", () => ({
  clearProfileSecrets: vi.fn().mockResolvedValue({ success: true }),
  hasProfileSecret: vi.fn().mockResolvedValue(false),
  setProfileSecret: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("~/stores/provisioningKeyStore", () => ({
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
}));

vi.mock("~/stores/apiStore", () => ({
  getProfiles: getProfilesMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  createProfile: createProfileMock,
  applyProfile: applyProfileMock,
  updateProfile: updateProfileMock,
  deleteProfile: deleteProfileMock,
  switchToNextProfile: switchToNextProfileMock,
  getProfileById: getProfileByIdMock,
  initializeDefaultProfile: initializeDefaultProfileMock,
  apiStore: { get: vi.fn().mockReturnValue([]), set: vi.fn() },
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

  // The two strippers are NOT interchangeable and the difference is load
  // bearing: `withoutProfileSecrets` is written back to disk during legacy
  // secret migration, so widening it wipes an upgrading user's model cache.
  // `toExportableProfile` additionally drops models/enabledProviders/refs,
  // which is only correct for a file leaving this machine. These tests pin
  // which one each path calls, via distinguishable return values — the
  // stripping behaviour itself is pinned in apiStore.test.ts (D13).
  it("export-profile serialises toExportableProfile, not the disk-writeback stripper", async () => {
    getProfileByIdMock.mockReturnValue({ id: "profile_1", name: "Work" });
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
    expect(toExportableProfileMock).toHaveBeenCalledWith({ id: "profile_1", name: "Work" });
    expect(withoutProfileSecretsMock).not.toHaveBeenCalled();
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
