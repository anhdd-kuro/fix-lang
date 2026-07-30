/**
 * @file profileBroadcast.test.ts
 * @description Regression test for the PR #114 review finding: switching the
 * ACTIVE profile emitted nothing to the renderer, so any window holding
 * profile-scoped data (the Usage tab's account spend, its admin-key empty
 * state) kept showing the PREVIOUS profile's account until it happened to
 * remount. `settings-updated` does not cover this — it is never sent on the
 * apply/switch paths.
 *
 * The failure mode is silent by construction: no error, no empty state, just
 * another account's numbers. So the broadcast is asserted here rather than left
 * to a manual click-through — including that it reaches EVERY window (Tray and
 * PromptGen render profile-scoped state too) and skips destroyed ones.
 *
 * The global-hotkey path (`keybindings/profileSwitch.ts`) raises the same
 * channel and never crosses preload; it is covered by `broadcastToAllWindows`'s
 * own assertions below, since it shares this exact helper.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_PROFILE_CHANGED } from "~/features/core/shared/ipcChannels";
import { dismissAskInputWindow } from "~/main/webViewWindows/askInputWindow";
import { registerProfileHandlers } from "./profiles";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

const { getAllWindowsMock } = vi.hoisted(() => ({
  getAllWindowsMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ) => {
      handlers.set(channel, listener);
    },
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
}));
vi.mock("~/main/keybindings", () => ({ reloadHotkeys: vi.fn() }));
// The leaf only — `~/main/profileChange` and `broadcastToAllWindows` stay real
// so the assertions below still exercise the actual broadcast path. Mocking
// this window module is what keeps its `attachThemeSync` -> theme-store ->
// electron-store import chain (which needs a `projectName`) out of the suite.
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
// Sidesteps `mainT()`'s locale-store/electron-store chain; notification copy is
// covered by profileNotifications.test.ts.
vi.mock("./profileNotifications", () => ({
  buildProfileNotification: vi.fn().mockReturnValue({ title: "t", body: "b" }),
  buildProfilesUpdatedNotification: vi
    .fn()
    .mockReturnValue({ title: "t", body: "b" }),
}));

const { applyProfileMock, switchToNextProfileMock } = vi.hoisted(() => ({
  applyProfileMock: vi.fn(),
  switchToNextProfileMock: vi.fn(),
}));

vi.mock("~/features/providers/store/apiStore", () => ({
  getProfiles: vi.fn().mockReturnValue([]),
  getCurrentProfileId: vi.fn().mockReturnValue("profile_1"),
  createProfile: vi.fn(),
  applyProfile: applyProfileMock,
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  switchToNextProfile: switchToNextProfileMock,
  // `settings` must be present: `apply-profile` also kicks off the legacy
  // plaintext-key migration, which reads `profile.settings.apiKey`.
  getProfileById: vi
    .fn()
    .mockReturnValue({ id: "profile_2", name: "Work", settings: {} }),
  initializeDefaultProfile: vi.fn(),
  apiStore: { get: vi.fn().mockReturnValue([]), set: vi.fn(), delete: vi.fn() },
  withoutProfileSecrets: vi.fn((profile: unknown) => profile),
  toExportableProfile: vi.fn((profile: unknown) => profile),
  sanitizeImportedProfile: vi.fn((profile: unknown) => profile),
}));

const fakeWindow = (isDestroyed: boolean) => ({
  isDestroyed: () => isDestroyed,
  webContents: { send: vi.fn() },
});

describe("an active-profile switch is broadcast to every window", () => {
  let live: ReturnType<typeof fakeWindow>;
  let alsoLive: ReturnType<typeof fakeWindow>;
  let destroyed: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    live = fakeWindow(false);
    alsoLive = fakeWindow(false);
    destroyed = fakeWindow(true);
    getAllWindowsMock.mockReturnValue([live, destroyed, alsoLive]);
    applyProfileMock.mockReturnValue({ success: true });
    switchToNextProfileMock.mockReturnValue({ id: "profile_2", name: "Work" });
    registerProfileHandlers();
  });

  it("apply-profile notifies every live window, and skips destroyed ones", async () => {
    await handlers.get("apply-profile")?.({}, { profileId: "profile_2" });

    expect(live.webContents.send).toHaveBeenCalledWith(ACTIVE_PROFILE_CHANGED);
    expect(alsoLive.webContents.send).toHaveBeenCalledWith(
      ACTIVE_PROFILE_CHANGED,
    );
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it("switch-to-next-profile notifies every live window", async () => {
    await handlers.get("switch-to-next-profile")?.({});

    expect(live.webContents.send).toHaveBeenCalledWith(ACTIVE_PROFILE_CHANGED);
    expect(alsoLive.webContents.send).toHaveBeenCalledWith(
      ACTIVE_PROFILE_CHANGED,
    );
  });

  it("apply-profile also dismisses a pending Ask input, so its question cannot be sent through the new profile's key", async () => {
    await handlers.get("apply-profile")?.({}, { profileId: "profile_2" });

    expect(dismissAskInputWindow).toHaveBeenCalledTimes(1);
  });

  it("switch-to-next-profile also dismisses a pending Ask input", async () => {
    await handlers.get("switch-to-next-profile")?.({});

    expect(dismissAskInputWindow).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the switch did not happen", async () => {
    applyProfileMock.mockReturnValue({ success: false, error: "Not found" });
    switchToNextProfileMock.mockReturnValue(null);

    await handlers.get("apply-profile")?.({}, { profileId: "nope" });
    await handlers.get("switch-to-next-profile")?.({});

    // A spurious broadcast would drop good cached data and refetch every
    // window's account usage for nothing.
    expect(live.webContents.send).not.toHaveBeenCalled();
  });
});
