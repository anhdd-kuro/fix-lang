import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_APP_BUNDLE_PATHS } from "~/features/guards/shared/appBundleIds";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  MAX_BUNDLE_ID_LENGTH,
  MAX_DENIED_BUNDLE_IDS,
} from "~/features/guards/shared/guardSettings";
import { selectionGuardsFeature } from "./guards";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

/** Anything structured clone can carry that a test feeds across the bridge. */
type IpcJson =
  | string
  | number
  | boolean
  | null
  | IpcJson[]
  | { [key: string]: IpcJson | undefined };

/**
 * Hands junk to the typed bridge method the way an untyped renderer could —
 * the preload validates at runtime precisely because this compiles away.
 */
const asSettingsArgument = (payload: IpcJson | undefined) =>
  payload as SelectionGuardSettings;

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getPathForFile: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: { invoke: electronMocks.invoke },
  webUtils: { getPathForFile: electronMocks.getPathForFile },
}));

const validSettings = {
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
};

const normalizedDefaults = {
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

const malformedSettingsPayloads = [
  undefined,
  null,
  "a string",
  42,
  [],
  { ...validSettings, clipboardMaxAgeSeconds: "5" },
  { ...validSettings, maxSelectionChars: "20000" },
  { ...validSettings, deniedBundleIds: "com.1password.1password" },
  { ...validSettings, deniedBundleIds: [1, 2] },
  { maxSelectionChars: 20_000, deniedBundleIds: [] },
  { clipboardMaxAgeSeconds: 5, deniedBundleIds: [] },
  { clipboardMaxAgeSeconds: 5, maxSelectionChars: 20_000 },
];

describe("selectionGuardsFeature preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSelectionGuards", () => {
    it("invokes get-selection-guards and returns a valid result", async () => {
      electronMocks.invoke.mockResolvedValue(validSettings);

      const result = await selectionGuardsFeature.getSelectionGuards();

      expect(electronMocks.invoke).toHaveBeenCalledWith("get-selection-guards");
      expect(result).toEqual(validSettings);
    });

    it.each(malformedSettingsPayloads)(
      "falls back to normalized defaults for a malformed main-process reply: %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await selectionGuardsFeature.getSelectionGuards();

        expect(result).toEqual(normalizedDefaults);
      },
    );
  });

  describe("setSelectionGuards", () => {
    it("invokes set-selection-guards with a valid payload and returns the result", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true });

      const result =
        await selectionGuardsFeature.setSelectionGuards(validSettings);

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "set-selection-guards",
        validSettings,
      );
      expect(result).toEqual({ success: true, error: undefined });
    });

    it("wraps a well-formed Label error from main via asLabel", async () => {
      electronMocks.invoke.mockResolvedValue({
        success: false,
        error: { kind: "text", text: "nope" },
      });

      const result =
        await selectionGuardsFeature.setSelectionGuards(validSettings);

      expect(result).toEqual({
        success: false,
        error: { kind: "text", text: "nope" },
      });
    });

    it("drops a malformed error field from main rather than passing it through", async () => {
      electronMocks.invoke.mockResolvedValue({
        success: false,
        error: "not a label",
      });

      const result =
        await selectionGuardsFeature.setSelectionGuards(validSettings);

      expect(result).toEqual({ success: false, error: undefined });
    });

    it.each(malformedSettingsPayloads)(
      "rejects a malformed payload without ever invoking the main process: %j",
      async (payload) => {
        const result = await selectionGuardsFeature.setSelectionGuards(
          asSettingsArgument(payload),
        );

        expect(electronMocks.invoke).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error?.kind).toBe("text");
      },
    );

    // f1: mirrors the main-process fix — a value the normalizer would
    // silently coerce to 0 (negative, or a sub-1 fraction) must be refused
    // here too, since preload is the boundary a buggy renderer actually hits
    // first.
    it.each([
      { ...validSettings, clipboardMaxAgeSeconds: -1 },
      { ...validSettings, clipboardMaxAgeSeconds: 0.5 },
      { ...validSettings, maxSelectionChars: -20_000 },
      { ...validSettings, maxSelectionChars: 0.9 },
    ])(
      "rejects a value the normalizer would coerce to 0 (case %#): %j",
      async (payload) => {
        const result = await selectionGuardsFeature.setSelectionGuards(payload);

        expect(electronMocks.invoke).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
      },
    );

    // The other half of f1: an explicit 0 is a deliberate disable and must
    // still be accepted through to the main process.
    it.each([
      { ...validSettings, clipboardMaxAgeSeconds: 0 },
      { ...validSettings, maxSelectionChars: 0 },
    ])(
      "still accepts an explicit 0 as a deliberate disable (case %#): %j",
      async (payload) => {
        electronMocks.invoke.mockResolvedValue({ success: true });

        const result = await selectionGuardsFeature.setSelectionGuards(payload);

        expect(electronMocks.invoke).toHaveBeenCalledWith(
          "set-selection-guards",
          payload,
        );
        expect(result).toEqual({ success: true, error: undefined });
      },
    );

    // f2/f4: an entry the normalizer would silently drop, or a list longer
    // than the store will ever persist, must be refused here too.
    it.each([
      {
        ...validSettings,
        deniedBundleIds: ["z".repeat(MAX_BUNDLE_ID_LENGTH + 1)],
      },
      { ...validSettings, deniedBundleIds: ["com.exampleapp"] },
      { ...validSettings, deniedBundleIds: ["   "] },
      {
        ...validSettings,
        deniedBundleIds: Array.from(
          { length: MAX_DENIED_BUNDLE_IDS + 1 },
          (_, index) => `com.example.app${index}`,
        ),
      },
    ])(
      "rejects a deniedBundleIds payload the normalizer would change (case %#)",
      async (payload) => {
        const result = await selectionGuardsFeature.setSelectionGuards(payload);

        expect(electronMocks.invoke).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
      },
    );
  });

  describe("getRecentActiveApps", () => {
    it("invokes get-recent-active-apps and returns a valid result", async () => {
      const apps = [{ name: "Slack", bundleId: "com.tinyspeck.slackmacgap" }];
      electronMocks.invoke.mockResolvedValue(apps);

      const result = await selectionGuardsFeature.getRecentActiveApps();

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "get-recent-active-apps",
      );
      expect(result).toEqual(apps);
    });

    it("accepts a null bundleId entry", async () => {
      const apps = [{ name: "Untitled Helper", bundleId: null }];
      electronMocks.invoke.mockResolvedValue(apps);

      const result = await selectionGuardsFeature.getRecentActiveApps();

      expect(result).toEqual(apps);
    });

    it.each([
      undefined,
      null,
      "a string",
      [{ name: "Slack" }], // missing bundleId
      [{ name: 1, bundleId: null }], // non-string name
      [{ name: "Slack", bundleId: 1 }], // non-string, non-null bundleId
      "not-an-array",
    ])(
      "falls back to an empty list for a malformed main-process reply: %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await selectionGuardsFeature.getRecentActiveApps();

        expect(result).toEqual([]);
      },
    );
  });

  describe("getAppBundlePathForFile", () => {
    const droppedFile = new File([], "Slack.app");

    /**
     * `File.path` is gone in Electron 43, and `webUtils` only exists on this
     * side of the bridge — so the renderer must never learn the path any other
     * way than through this function.
     */
    it("returns the path webUtils reports for an .app bundle", () => {
      electronMocks.getPathForFile.mockReturnValue("/Applications/Slack.app");

      expect(selectionGuardsFeature.getAppBundlePathForFile(droppedFile)).toBe(
        "/Applications/Slack.app",
      );
    });

    it("returns null for a dropped file that is not an .app bundle", () => {
      electronMocks.getPathForFile.mockReturnValue("/Users/me/notes.txt");

      expect(
        selectionGuardsFeature.getAppBundlePathForFile(droppedFile),
      ).toBeNull();
    });

    // `instanceof File` cannot be the guard (the object crosses contexts), so
    // a non-File argument surfaces as a throw out of `webUtils` — which must
    // read as "not an app", never as an unhandled renderer exception.
    it("returns null instead of throwing when webUtils rejects the argument", () => {
      electronMocks.getPathForFile.mockImplementation(() => {
        throw new TypeError("not a File");
      });

      // A non-File, arriving through a JSON boundary the way it could from an
      // untyped renderer.
      const notAFile: File = JSON.parse('"nonsense"');
      expect(
        selectionGuardsFeature.getAppBundlePathForFile(notAFile),
      ).toBeNull();
    });
  });

  describe("resolveAppBundleIds", () => {
    it("invokes resolve-app-bundle-ids and returns a valid reply", async () => {
      const reply = { success: true, bundleIds: ["com.tinyspeck.slackmacgap"] };
      electronMocks.invoke.mockResolvedValue(reply);

      const result = await selectionGuardsFeature.resolveAppBundleIds([
        "/Applications/Slack.app",
      ]);

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "resolve-app-bundle-ids",
        ["/Applications/Slack.app"],
      );
      expect(result).toEqual(reply);
    });

    it.each([
      ["a relative path", ["Applications/Slack.app"]],
      ["a non-.app path", ["/Users/me/notes.txt"]],
      // Junk the parameter type cannot express, arriving through a JSON
      // boundary the way it would from an untyped renderer.
      ["a non-string entry", JSON.parse("[42]")],
      ["a non-array payload", JSON.parse('"/Applications/Slack.app"')],
      [
        "more paths than the deny-list can hold",
        Array.from(
          { length: MAX_APP_BUNDLE_PATHS + 1 },
          () => "/Applications/Slack.app",
        ),
      ],
    ])("rejects %s without invoking main", async (_label, payload) => {
      const result = await selectionGuardsFeature.resolveAppBundleIds(payload);

      expect(electronMocks.invoke).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("rejects a malformed main-process reply rather than returning half of it", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true, bundleIds: [1] });

      const result = await selectionGuardsFeature.resolveAppBundleIds([
        "/Applications/Slack.app",
      ]);

      expect(result.success).toBe(false);
    });
  });

  describe("chooseDeniedApps", () => {
    it("invokes choose-denied-apps and returns a valid reply", async () => {
      const reply = { success: true, bundleIds: ["com.tinyspeck.slackmacgap"] };
      electronMocks.invoke.mockResolvedValue(reply);

      const result = await selectionGuardsFeature.chooseDeniedApps();

      expect(electronMocks.invoke).toHaveBeenCalledWith("choose-denied-apps");
      expect(result).toEqual(reply);
    });

    it("rejects a malformed main-process reply", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true });

      const result = await selectionGuardsFeature.chooseDeniedApps();

      expect(result.success).toBe(false);
    });
  });
});
