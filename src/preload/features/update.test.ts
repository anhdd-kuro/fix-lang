import { beforeEach, describe, expect, it, vi } from "vitest";
import { msg } from "~/shared/i18n/message";
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
