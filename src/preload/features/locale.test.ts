import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeFeature } from "./locale";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

describe("locale preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getLocale invokes get-locale and returns the result", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ locale: "ja" });

    await expect(localeFeature.getLocale()).resolves.toEqual({ locale: "ja" });
    expect(electronMocks.invoke).toHaveBeenCalledWith("get-locale");
  });

  it("setLocale invokes set-locale with the requested locale", async () => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true });

    await expect(localeFeature.setLocale("ja")).resolves.toEqual({ success: true });
    expect(electronMocks.invoke).toHaveBeenCalledWith("set-locale", "ja");
  });

  it("setLocale forwards a failure result unchanged", async () => {
    electronMocks.invoke.mockResolvedValueOnce({
      success: false,
      error: "Invalid locale",
    });

    await expect(localeFeature.setLocale("ja")).resolves.toEqual({
      success: false,
      error: "Invalid locale",
    });
  });

  it("onLocaleChanged forwards the payload to the callback", () => {
    const callback = vi.fn();
    localeFeature.onLocaleChanged(callback);

    expect(electronMocks.on).toHaveBeenCalledWith("locale-changed", expect.any(Function));
    const listener = electronMocks.on.mock.calls[0][1] as (
      event: unknown,
      locale: string,
    ) => void;

    listener(undefined, "ja");
    expect(callback).toHaveBeenCalledWith("ja");
  });

  it("the returned unsubscribe function removes the same listener", () => {
    const callback = vi.fn();
    const unsubscribe = localeFeature.onLocaleChanged(callback);
    const listener = electronMocks.on.mock.calls[0][1];

    unsubscribe();

    expect(electronMocks.removeListener).toHaveBeenCalledWith("locale-changed", listener);
  });
});
