import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msg, type Message } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { TrayToolbar } from "./TrayToolbar";
import { I18nProvider } from "../../i18n/I18nProvider";

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");

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
  message?: Message;
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
  // The tray now renders through <I18nProvider>, which resolves its initial
  // locale via this trio before anything translated shows up — see
  // ~/renderer/i18n/localeState.ts `LocaleBridge`. Locked to "en" so this
  // suite's English assertions stay meaningful regardless of locale defaults.
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
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

  const render = async (
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
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(TrayToolbar)),
      );
    });
    // I18nProvider renders nothing until its initial `getLocale()` promise
    // resolves (avoids an EN -> JA flash) — flush that microtask before
    // callers query the DOM for tray buttons.
    await waitForUi();
  };

  const checkForUpdatesButton = (): HTMLButtonElement => {
    const button = container.querySelector<HTMLButtonElement>(
      `[aria-label="${tEn("tray.toolbar.checkForUpdates")}"]`,
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
    await render({ phase: "up-to-date", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.showMessageBox).toHaveBeenCalledTimes(1);
    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toContain(
      tEn("tray.toolbar.updateCheck.upToDate", { version: "1.2.3" }),
    );
    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("opens the release page when the user picks 'View release' on an available update", async () => {
    await render(
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
      tEn("tray.toolbar.updateCheck.available", {
        availableVersion: "1.3.0",
        currentVersion: "1.2.3",
      }),
    );
    expect(options.buttons).toEqual([
      tEn("tray.toolbar.updateCheck.viewRelease"),
      tEn("common.close"),
    ]);
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("does not open the release page when the user closes the available-update dialog", async () => {
    await render(
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
    await render({
      phase: "error",
      currentVersion: "1.2.3",
      message: msg("settings.updates.checkErrorMessage"),
    });

    await click(checkForUpdatesButton());
    await waitForUi();

    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toBe(
      tEn("tray.toolbar.updateCheck.failed", {
        reason: tEn("settings.updates.checkErrorMessage"),
      }),
    );
  });

  it("resolves a parameterized `message` descriptor (e.g. Homebrew tap lag) instead of showing it raw", async () => {
    await render({
      phase: "error",
      currentVersion: "1.2.3",
      message: msg("settings.updates.tapBehindMessage", {
        targetVersion: "1.3.0",
        offeredVersion: "1.2.5",
      }),
    });

    await click(checkForUpdatesButton());
    await waitForUi();

    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toBe(
      tEn("tray.toolbar.updateCheck.failed", {
        reason: tEn("settings.updates.tapBehindMessage", {
          targetVersion: "1.3.0",
          offeredVersion: "1.2.5",
        }),
      }),
    );
  });

  it("never opens the main window or navigates dashboard tabs", async () => {
    await render({ phase: "up-to-date", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    expect(api.hideTray).not.toHaveBeenCalled();
    expect(api.showMainWindowTab).not.toHaveBeenCalled();
  });

  it("shows an unsupported-build message and does not open the release page", async () => {
    await render({ phase: "unsupported", currentVersion: "1.2.3" });

    await click(checkForUpdatesButton());
    await waitForUi();

    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toContain(tEn("tray.toolbar.updateCheck.unsupported"));
    expect(options.buttons).toEqual([tEn("common.ok")]);
    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("disables the button while the check is in flight and re-enables once it resolves", async () => {
    let resolveCheck: ((state: UpdateState) => void) | undefined;
    await render({ phase: "up-to-date", currentVersion: "1.2.3" });
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

  it("does not start a second update check while the toolbar button is disabled", async () => {
    let resolveCheck: ((state: UpdateState) => void) | undefined;
    await render({ phase: "up-to-date", currentVersion: "1.2.3" });
    api.checkForUpdates.mockReturnValueOnce(
      new Promise<UpdateState>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const button = checkForUpdatesButton();
    await click(button);
    expect(button.disabled).toBe(true);

    await click(button);
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCheck?.({ phase: "up-to-date", currentVersion: "1.2.3" });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("re-enables the button after an error phase resolves", async () => {
    await render({
      phase: "error",
      currentVersion: "1.2.3",
      message: msg("settings.updates.checkErrorMessage"),
    });

    const button = checkForUpdatesButton();
    await click(button);
    await waitForUi();

    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows a generic failure dialog and re-enables the button when checkForUpdates rejects", async () => {
    await render({ phase: "up-to-date", currentVersion: "1.2.3" });
    api.checkForUpdates.mockRejectedValueOnce(
      new Error("Received an invalid update state"),
    );

    const button = checkForUpdatesButton();
    await click(button);
    await waitForUi();

    expect(api.showMessageBox).toHaveBeenCalledTimes(1);
    const [options] = api.showMessageBox.mock.calls[0];
    expect(options.message).toBe(
      tEn("tray.toolbar.updateCheck.failed", {
        reason: tEn("tray.toolbar.updateCheck.genericFailure"),
      }),
    );
    expect(options.buttons).toEqual([tEn("common.ok")]);
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
