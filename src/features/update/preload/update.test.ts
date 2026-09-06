import { beforeEach, describe, expect, it, vi } from "vitest";
import { msg } from "~/features/i18n/shared/message";
import { updateFeature } from "./update";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

describe("update preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts only the successful open-release result shape", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true });

    await expect(updateFeature.openUpdateRelease()).resolves.toEqual({
      success: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith("updates:open-release");
  });

  it("accepts only the failed open-release result shape", async () => {
    const error = msg("settings.updates.openReleaseFailed");
    electronMocks.invoke.mockResolvedValueOnce({ success: false, error });

    await expect(updateFeature.openUpdateRelease()).resolves.toEqual({
      success: false,
      error,
    });
  });

  it("forwards the install request without renderer-supplied arguments", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true });

    await expect(updateFeature.installUpdate()).resolves.toEqual({
      success: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith("updates:install");
  });

  it("rejects malformed install results", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: false });

    await expect(updateFeature.installUpdate()).rejects.toThrow(
      "Received an invalid install result",
    );
  });

  it.each([
    undefined,
    null,
    { success: "yes" },
    { success: true, error: "unexpected" },
    { success: false },
    { success: false, error: 42 },
    // A pre-resolved string is no longer valid — `error` must be a
    // locale-free `Message` descriptor so the renderer can `tm()` it.
    { success: false, error: "failure" },
    { success: false, error: { key: "" } },
    {
      success: false,
      error: msg("settings.updates.openReleaseFailed"),
      path: "/private/cache",
    },
  ])("rejects malformed open-release IPC data: %j", async (result) => {
    electronMocks.invoke.mockResolvedValueOnce(result);

    await expect(updateFeature.openUpdateRelease()).rejects.toThrow(
      "Received an invalid open-release result",
    );
  });
});

describe("pre-release preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets the pre-release state on its own channel", async () => {
    const state = { phase: "idle", activeChannel: "stable" };
    electronMocks.invoke.mockResolvedValueOnce(state);

    await expect(updateFeature.getPrereleaseState()).resolves.toEqual(state);
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "updates:prerelease:get-state",
    );
  });

  it("checks for a pre-release on its own channel", async () => {
    const state = {
      phase: "available",
      activeChannel: "stable",
      offeredVersion: "0.33.0-beta.3",
    };
    electronMocks.invoke.mockResolvedValueOnce(state);

    await expect(updateFeature.checkForPrerelease()).resolves.toEqual(state);
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "updates:prerelease:check",
    );
  });

  it("rejects a malformed pre-release state", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ phase: "idle" });

    await expect(updateFeature.getPrereleaseState()).rejects.toThrow(
      "Received an invalid pre-release state",
    );
  });

  it("switches to the pre-release channel without renderer-supplied arguments", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true });

    await expect(updateFeature.switchToPrerelease()).resolves.toEqual({
      success: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "updates:prerelease:switch",
    );
  });

  it("reverts to the stable channel without renderer-supplied arguments", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true });

    await expect(updateFeature.revertToStable()).resolves.toEqual({
      success: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "updates:prerelease:revert",
    );
  });

  it("rejects a malformed switch/revert result", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: false });

    await expect(updateFeature.switchToPrerelease()).rejects.toThrow(
      "Received an invalid pre-release action result",
    );
    electronMocks.invoke.mockResolvedValueOnce({ success: false });
    await expect(updateFeature.revertToStable()).rejects.toThrow(
      "Received an invalid pre-release action result",
    );
  });

  it("subscribes and unsubscribes to pre-release state changes on its own channel", () => {
    const callback = vi.fn();
    const unsubscribe = updateFeature.onPrereleaseStateChanged(callback);

    expect(electronMocks.on).toHaveBeenCalledWith(
      "updates:prerelease-state",
      expect.any(Function),
    );

    const listener = electronMocks.on.mock.calls[0][1];
    const validState = { phase: "idle", activeChannel: "beta" };
    listener({}, validState);
    expect(callback).toHaveBeenCalledWith(validState);

    callback.mockClear();
    listener({}, { phase: "idle" });
    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      "updates:prerelease-state",
      listener,
    );
  });
});
