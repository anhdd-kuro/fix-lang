import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BUNDLE_ID_LENGTH,
  MAX_DENIED_BUNDLE_IDS,
} from "~/features/guards/shared/guardSettings";
import { registerSelectionGuardHandlers } from "./guards";

const { electronMocks, guardStoreMocks, recentActiveAppsMocks, appBundleIdMocks } =
  vi.hoisted(() => ({
    electronMocks: { handle: vi.fn(), showOpenDialog: vi.fn() },
    guardStoreMocks: {
      getSelectionGuardSettings: vi.fn(),
      setSelectionGuardSettings: vi.fn(),
    },
    recentActiveAppsMocks: { getRecentActiveApps: vi.fn() },
    appBundleIdMocks: { resolveAppBundleIds: vi.fn() },
  }));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
}));
vi.mock("~/features/guards/store/guardStore", () => ({ guardStore: guardStoreMocks }));
vi.mock("~/main/accessibility/recentActiveApps", () => recentActiveAppsMocks);
vi.mock("~/features/guards/main/appBundleIds", () => appBundleIdMocks);

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no handler registered for channel "${channel}"`);
  return call[1] as Handler;
};

const validSettings = {
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
};

describe("registerSelectionGuardHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerSelectionGuardHandlers();
  });

  describe("get-selection-guards", () => {
    it("returns whatever guardStore reports, unmodified", async () => {
      guardStoreMocks.getSelectionGuardSettings.mockReturnValue(validSettings);

      const result = await getHandler("get-selection-guards")(undefined);

      expect(guardStoreMocks.getSelectionGuardSettings).toHaveBeenCalledWith();
      expect(result).toEqual(validSettings);
    });
  });

  describe("set-selection-guards", () => {
    it("persists a valid payload through guardStore", async () => {
      const result = await getHandler("set-selection-guards")(undefined, validSettings);

      expect(guardStoreMocks.setSelectionGuardSettings).toHaveBeenCalledWith(validSettings);
      expect(result).toEqual({ success: true });
    });

    it.each([
      undefined,
      null,
      "a string",
      42,
      [],
      { ...validSettings, clipboardMaxAgeSeconds: "5" }, // string, not number
      { ...validSettings, clipboardMaxAgeSeconds: Number.NaN },
      { ...validSettings, maxSelectionChars: "20000" }, // string, not number
      { ...validSettings, deniedBundleIds: "com.1password.1password" }, // not an array
      { ...validSettings, deniedBundleIds: [1, 2] }, // array of numbers, not strings
      { maxSelectionChars: 20_000, deniedBundleIds: [] }, // missing clipboardMaxAgeSeconds
      { clipboardMaxAgeSeconds: 5, deniedBundleIds: [] }, // missing maxSelectionChars
      { clipboardMaxAgeSeconds: 5, maxSelectionChars: 20_000 }, // missing deniedBundleIds
    ])(
      "rejects a malformed payload without ever calling guardStore (case %#): %j",
      async (payload) => {
        const result = await getHandler("set-selection-guards")(undefined, payload);

        expect(guardStoreMocks.setSelectionGuardSettings).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false });
        expect((result as { error?: { kind?: string } }).error?.kind).toBe("text");
      },
    );

    // f1: a value the normalizer would silently coerce to 0 (negative, or a
    // sub-1 fraction) must be REFUSED, not accepted-and-defused. Before the
    // fix, `Number.isFinite` alone let these through, `guardStore` persisted
    // `0`, the age/size rail went silently off, and the handler still
    // reported `{ success: true }`.
    it.each([
      { ...validSettings, clipboardMaxAgeSeconds: -1 },
      { ...validSettings, clipboardMaxAgeSeconds: 0.5 },
      { ...validSettings, maxSelectionChars: -20_000 },
      { ...validSettings, maxSelectionChars: 0.9 },
    ])(
      "rejects a value the normalizer would coerce to 0 (case %#): %j",
      async (payload) => {
        const result = await getHandler("set-selection-guards")(undefined, payload);

        expect(guardStoreMocks.setSelectionGuardSettings).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false });
      },
    );

    // The other half of f1: an explicit `0` is the documented way to
    // deliberately disable a guard and must still be accepted.
    it.each([
      { ...validSettings, clipboardMaxAgeSeconds: 0 },
      { ...validSettings, maxSelectionChars: 0 },
    ])("still accepts an explicit 0 as a deliberate disable (case %#): %j", async (payload) => {
      const result = await getHandler("set-selection-guards")(undefined, payload);

      expect(guardStoreMocks.setSelectionGuardSettings).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ success: true });
    });

    // f2/f4: an entry the normalizer would silently drop (over-length,
    // control character) must be refused rather than accepted-and-truncated.
    it.each([
      { ...validSettings, deniedBundleIds: ["z".repeat(MAX_BUNDLE_ID_LENGTH + 1)] },
      { ...validSettings, deniedBundleIds: ["com.example\u0001app"] },
      { ...validSettings, deniedBundleIds: ["   "] }, // empty after trim
    ])("rejects a deniedBundleIds entry the normalizer would drop (case %#): %j", async (payload) => {
      const result = await getHandler("set-selection-guards")(undefined, payload);

      expect(guardStoreMocks.setSelectionGuardSettings).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false });
    });

    // f4: a list longer than the store will ever persist is refused outright
    // rather than accepted and silently truncated to MAX_DENIED_BUNDLE_IDS.
    it("rejects a deniedBundleIds array longer than MAX_DENIED_BUNDLE_IDS", async () => {
      const tooMany = Array.from(
        { length: MAX_DENIED_BUNDLE_IDS + 1 },
        (_, index) => `com.example.app${index}`,
      );

      const result = await getHandler("set-selection-guards")(undefined, {
        ...validSettings,
        deniedBundleIds: tooMany,
      });

      expect(guardStoreMocks.setSelectionGuardSettings).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false });
    });

    // A list right at the cap, with entries that all survive normalization
    // unchanged, must still be accepted.
    it("accepts a deniedBundleIds array exactly at MAX_DENIED_BUNDLE_IDS", async () => {
      const exactlyAtCap = Array.from(
        { length: MAX_DENIED_BUNDLE_IDS },
        (_, index) => `com.example.app${index}`,
      );
      const payload = { ...validSettings, deniedBundleIds: exactlyAtCap };

      const result = await getHandler("set-selection-guards")(undefined, payload);

      expect(guardStoreMocks.setSelectionGuardSettings).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ success: true });
    });

    // f3: a persistence failure (disk full, permissions) must surface as a
    // resolved `{ success: false, error }`, not a rejected invoke out of a
    // handler typed to never throw.
    it("returns a failure result instead of throwing when guardStore.setSelectionGuardSettings throws", async () => {
      guardStoreMocks.setSelectionGuardSettings.mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = await getHandler("set-selection-guards")(undefined, validSettings);

      expect(result).toMatchObject({ success: false });
      expect((result as { error?: { kind?: string; text?: string } }).error?.text).toBe(
        "EACCES: permission denied",
      );
    });
  });

  describe("get-recent-active-apps", () => {
    it("returns whatever the in-memory MRU reports, unmodified", async () => {
      const apps = [{ name: "Slack", bundleId: "com.tinyspeck.slackmacgap" }];
      recentActiveAppsMocks.getRecentActiveApps.mockReturnValue(apps);

      const result = await getHandler("get-recent-active-apps")(undefined);

      expect(result).toEqual(apps);
    });
  });

  describe("resolve-app-bundle-ids", () => {
    /**
     * The handler must NOT pre-filter, sanitize or repair the payload before
     * handing it over: `resolveAppBundleIds` is where "reject, never coerce"
     * lives, and a second, laxer copy of that rule here is exactly how a
     * validated path stops being validated.
     */
    it("hands the raw renderer payload straight to the resolver", async () => {
      const failure = { success: false, error: { kind: "text", text: "nope" } };
      appBundleIdMocks.resolveAppBundleIds.mockResolvedValue(failure);

      const result = await getHandler("resolve-app-bundle-ids")(undefined, ["../evil"]);

      expect(appBundleIdMocks.resolveAppBundleIds).toHaveBeenCalledWith(["../evil"]);
      expect(result).toEqual(failure);
    });
  });

  describe("choose-denied-apps", () => {
    it("opens a multi-select .app picker rooted at /Applications", async () => {
      electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      await getHandler("choose-denied-apps")(undefined);

      expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Applications", extensions: ["app"] }],
        defaultPath: "/Applications",
      });
    });

    // Cancelling is the user changing their mind, not a failure to report.
    it("reports a cancelled dialog as a success with no ids, without resolving anything", async () => {
      electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      const result = await getHandler("choose-denied-apps")(undefined);

      expect(result).toEqual({ success: true, bundleIds: [] });
      expect(appBundleIdMocks.resolveAppBundleIds).not.toHaveBeenCalled();
    });

    // Main picked these paths itself, and they STILL go through the one
    // resolver — the "existing .app with a readable identifier" rule has a
    // single implementation, not one per entry point.
    it("resolves the picked paths through the same resolver a drop uses", async () => {
      electronMocks.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ["/Applications/Slack.app"],
      });
      appBundleIdMocks.resolveAppBundleIds.mockResolvedValue({
        success: true,
        bundleIds: ["com.tinyspeck.slackmacgap"],
      });

      const result = await getHandler("choose-denied-apps")(undefined);

      expect(appBundleIdMocks.resolveAppBundleIds).toHaveBeenCalledWith([
        "/Applications/Slack.app",
      ]);
      expect(result).toEqual({ success: true, bundleIds: ["com.tinyspeck.slackmacgap"] });
    });
  });
});
