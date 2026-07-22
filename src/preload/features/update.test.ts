import { beforeEach, describe, expect, it, vi } from "vitest";
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
    electronMocks.invoke.mockResolvedValueOnce({
      success: false,
      error: "Could not open the releases page",
    });

    await expect(updateFeature.openUpdateRelease()).resolves.toEqual({
      success: false,
      error: "Could not open the releases page",
    });
  });

  it.each([
    undefined,
    null,
    { success: "yes" },
    { success: true, error: "unexpected" },
    { success: false },
    { success: false, error: 42 },
    { success: false, error: "failure", path: "/private/cache" },
  ])("rejects malformed open-release IPC data: %j", async (result) => {
    electronMocks.invoke.mockResolvedValueOnce(result);

    await expect(updateFeature.openUpdateRelease()).rejects.toThrow(
      "Received an invalid open-release result",
    );
  });
});
