import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrayToolbar } from "./TrayToolbar";

type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "error";

type UpdateState = {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  message?: string;
};

type TrayApi = {
  hideTray: ReturnType<typeof vi.fn>;
  showMainWindowTab: ReturnType<typeof vi.fn>;
  showMainWindowSettings: ReturnType<typeof vi.fn>;
  restartApp: ReturnType<typeof vi.fn>;
  quitApp: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  openUpdateRelease: ReturnType<typeof vi.fn>;
  showMessageBox: ReturnType<typeof vi.fn>;
};

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("TrayToolbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: TrayApi;

  const render = (
    state: UpdateState,
    showMessageBoxResult: { response: number } = { response: 0 },
  ) => {
    api = {
      hideTray: vi.fn(),
      showMainWindowTab: vi.fn(),
      showMainWindowSettings: vi.fn(),
      restartApp: vi.fn(),
      quitApp: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(state),
      openUpdateRelease: vi.fn().mockResolvedValue({ success: true }),
      showMessageBox: vi.fn().mockResolvedValue(showMessageBoxResult),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(TrayToolbar));
    });
  };

  const checkForUpdatesButton = (): HTMLButtonElement => {
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Check for updates"]',
    );
    if (!button) {
      throw new Error("Expected a 'Check for updates' button");
    }
    return button;
  };

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("checks for updates and shows an up-to-date message box", async () => {
    render({ phase: "up-to-date", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.showMessageBox).toHaveBeenCalledTimes(1);
    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toContain("FixLang is up to date (v1.2.3)");
    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("opens the release page when the user picks 'View release' on an available update", async () => {
    render(
      {
        phase: "available",
        currentVersion: "1.2.3",
        availableVersion: "1.3.0",
      },
      { response: 0 },
    );

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toContain(
      "Update available: v1.3.0 (installed v1.2.3)",
    );
    expect(options.buttons).toEqual(["View release", "Close"]);
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("does not open the release page when the user closes the available-update dialog", async () => {
    render(
      {
        phase: "available",
        currentVersion: "1.2.3",
        availableVersion: "1.3.0",
      },
      { response: 1 },
    );

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("surfaces a failure message when the check errors", async () => {
    render({
      phase: "error",
      currentVersion: "1.2.3",
      message: "Network unreachable.",
    });

    await click(checkForUpdatesButton());
    await waitForUi();

    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toBe(
      "Update check failed. Network unreachable.",
    );
  });

  it("never opens the main window or navigates dashboard tabs", async () => {
    render({ phase: "up-to-date", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.hideTray).not.toHaveBeenCalled();
    expect(api.showMainWindowTab).not.toHaveBeenCalled();
  });

  it("shows an unsupported-build message and does not open the release page", async () => {
    render({ phase: "unsupported", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toContain("aren't available for this build");
    expect(options.buttons).toEqual(["OK"]);
    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("disables the button while the check is in flight and re-enables once it resolves", async () => {
    let resolveCheck: ((state: UpdateState) => void) | undefined;
    render({ phase: "up-to-date", currentVersion: "1.2.3" });
    api.checkForUpdates.mockReturnValueOnce(
      new Promise<UpdateState>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const button = checkForUpdatesButton();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(button.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveCheck?.({ phase: "up-to-date", currentVersion: "1.2.3" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("re-enables the button after an error phase resolves", async () => {
    render({
      phase: "error",
      currentVersion: "1.2.3",
      message: "Network unreachable.",
    });

    const button = checkForUpdatesButton();
    await click(button);
    await waitForUi();

    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows a generic failure dialog and re-enables the button when checkForUpdates rejects", async () => {
    render({ phase: "up-to-date", currentVersion: "1.2.3" });
    api.checkForUpdates.mockRejectedValueOnce(
      new Error("Received an invalid update state"),
    );

    const button = checkForUpdatesButton();
    await click(button);
    await waitForUi();

    expect(api.showMessageBox).toHaveBeenCalledTimes(1);
    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toBe("Update check failed. Please try again later.");
    expect(options.buttons).toEqual(["OK"]);
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
