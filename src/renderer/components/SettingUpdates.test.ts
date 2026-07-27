import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msg, type Message } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { SettingUpdates } from "./SettingUpdates";
import { I18nProvider } from "../i18n/I18nProvider";

// Expected copy is derived through the real translator kernel — never
// hand-restated — so a catalog reword can't silently break this file, and an
// English-fallback regression still fails a test that asserts JA text.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

type UpdateState = {
  phase:
    | "unsupported"
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "installing"
    | "restart-required"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  message?: Message;
  canInstall?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
};

type UpdateApi = {
  getUpdateState: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  openUpdateRelease: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
  restartForUpdate: ReturnType<typeof vi.fn>;
  onUpdateStateChanged: ReturnType<typeof vi.fn>;
  openExternalLink: ReturnType<typeof vi.fn>;
  // `SettingUpdates` renders inside `<I18nProvider>`, which reads these off
  // `window.electronAPI` on mount (see `localeState.ts`'s `LocaleBridge`).
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

const readyState = (phase: UpdateState["phase"] = "idle"): UpdateState => ({
  phase,
  currentVersion: "0.1.0",
});

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

const buttonNamed = (
  container: HTMLElement,
  label: string,
): HTMLButtonElement => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) {
    throw new Error(`Expected a button named ${label}`);
  }
  return button;
};

const updateActionLabels = [
  tEn("settings.updates.installNow"),
  tEn("settings.updates.downloadButton"),
  tEn("settings.updates.viewReleases"),
  tEn("settings.updates.checkButton"),
  tEn("settings.updates.tryAgain"),
  tEn("settings.updates.restartButton"),
] as const;

const expectNoUpdateActions = (container: HTMLElement): void => {
  for (const label of updateActionLabels) {
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      ),
    ).toBeUndefined();
  }
};

const expectPrimaryStyles = (button: HTMLButtonElement): void => {
  expect(button.className).toContain("bg-primary");
  expect(button.className).toContain("text-primary-foreground");
  expect(button.className).toContain(
    "[&:where(:enabled:hover)]:bg-primary-hover",
  );
  expect(button.className).toContain(
    "[&:where(:enabled:active)]:bg-primary-active",
  );
  expect(button.className).toContain("focus-visible:ring-ring");
};

const expectOutlineStyles = (button: HTMLButtonElement): void => {
  expect(button.className).toContain("border");
  expect(button.className).toContain("border-current");
  expect(button.className).toContain("focus-visible:ring-ring");
};

type UpdateAction =
  | "checkForUpdates"
  | "openUpdateRelease"
  | "installUpdate"
  | "restartForUpdate";

type UpdateActionContract = {
  id: `BTN-${string}`;
  label: string;
  state: UpdateState;
  variant: "primary" | "outline";
  action?: UpdateAction;
  disabled?: boolean;
};

describe("SettingUpdates", () => {
  let container: HTMLDivElement;
  let root: Root;
  let updateListener: ((state: UpdateState) => void) | undefined;
  let localeListener: ((locale: "en" | "ja") => void) | undefined;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let api: UpdateApi;

  const renderWithApi = async (customApi: UpdateApi) => {
    api = customApi;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingUpdates)),
      );
    });
    // `<I18nProvider>` resolves its initial locale via an async `getLocale()`
    // call before rendering children (it renders null until "ready" — see
    // `I18nProvider.tsx` — to avoid an EN -> JA flash), so this needs an extra
    // tick beyond the single `waitForUi()` the update-state fetch itself uses.
    await waitForUi();
    await waitForUi();
  };

  const render = async (state: UpdateState) => {
    unsubscribe = vi.fn();
    await renderWithApi({
      getUpdateState: vi.fn().mockResolvedValue(state),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
      openExternalLink: vi.fn().mockResolvedValue({ success: true }),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return unsubscribe;
      }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
    });
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    updateListener = undefined;
    localeListener = undefined;
    vi.restoreAllMocks();
  });

  it("explains that updates require an installed release when unavailable", async () => {
    await render({
      phase: "unsupported",
      currentVersion: "0.1.0-dev",
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.versionLabel", { version: "0.1.0-dev" }),
    );
    expect(container.textContent).toContain(
      tEn("settings.updates.unsupported"),
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === tEn("settings.updates.checkButton"),
      ),
    ).toBeUndefined();
  });

  it("checks for updates from the idle state", async () => {
    await render(readyState());

    const check = buttonNamed(container, tEn("settings.updates.checkButton"));
    expectPrimaryStyles(check);

    await click(check);
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      id: "BTN-064",
      label: tEn("settings.updates.checkButton"),
      state: readyState(),
      variant: "primary",
      action: "checkForUpdates",
    },
    {
      id: "BTN-065",
      label: tEn("settings.updates.checkButton"),
      state: readyState("checking"),
      variant: "primary",
      disabled: true,
    },
    {
      id: "BTN-066",
      label: tEn("settings.updates.checkButton"),
      state: readyState("up-to-date"),
      variant: "primary",
      action: "checkForUpdates",
    },
    {
      id: "BTN-067",
      label: tEn("settings.updates.downloadButton"),
      state: {
        ...readyState("up-to-date"),
        message: msg("settings.updates.tapPendingMessage", {
          publishedVersion: "0.2.0",
        }),
      },
      variant: "outline",
      action: "openUpdateRelease",
    },
    {
      id: "BTN-068",
      label: tEn("settings.updates.installNow"),
      state: {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      variant: "primary",
      action: "installUpdate",
    },
    {
      id: "BTN-069",
      label: tEn("settings.updates.downloadButton"),
      state: {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      variant: "outline",
      action: "openUpdateRelease",
    },
    {
      id: "BTN-070",
      label: tEn("settings.updates.downloadButton"),
      state: {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: false,
      },
      variant: "primary",
      action: "openUpdateRelease",
    },
    {
      id: "BTN-071",
      label: tEn("settings.updates.viewReleases"),
      state: {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      variant: "outline",
      action: "openUpdateRelease",
    },
    {
      id: "BTN-072",
      label: tEn("settings.updates.checkButton"),
      state: {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      variant: "outline",
      action: "checkForUpdates",
    },
    {
      id: "BTN-073",
      label: tEn("settings.updates.restartButton"),
      state: {
        ...readyState("restart-required"),
        availableVersion: "0.2.0",
      },
      variant: "primary",
      action: "restartForUpdate",
    },
    {
      id: "BTN-074",
      label: tEn("settings.updates.tryAgain"),
      state: {
        ...readyState("error"),
        message: msg("settings.updates.checkErrorMessage"),
      },
      variant: "primary",
      action: "checkForUpdates",
    },
    {
      id: "BTN-075",
      label: tEn("settings.updates.viewReleases"),
      state: {
        ...readyState("error"),
        message: msg("settings.updates.checkErrorMessage"),
      },
      variant: "outline",
      action: "openUpdateRelease",
    },
  ] satisfies UpdateActionContract[])(
    "$id preserves its $variant hierarchy, button type, and handler",
    async ({ state, label, variant, action, disabled = false }) => {
      await render(state);

      const button = buttonNamed(container, label);
      expect(button.type).toBe("button");
      expect(button.disabled).toBe(disabled);
      if (variant === "primary") {
        expectPrimaryStyles(button);
      } else {
        expectOutlineStyles(button);
      }

      await click(button);

      for (const request of [
        "checkForUpdates",
        "openUpdateRelease",
        "installUpdate",
        "restartForUpdate",
      ] as const) {
        expect(api[request]).toHaveBeenCalledTimes(request === action ? 1 : 0);
      }
    },
  );

  it("announces checking and prevents another check while one is in progress", async () => {
    await render(readyState("checking"));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      tEn("settings.updates.checking"),
    );
    const check = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("settings.updates.checkButton"),
    );
    expect(check?.hasAttribute("disabled")).toBe(true);
    expectPrimaryStyles(check as HTMLButtonElement);
  });

  it("reports when the installed version is already current", async () => {
    await render(readyState("up-to-date"));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      tEn("settings.updates.upToDate"),
    );
    // The check button stays available so the user can re-check on demand.
    expectPrimaryStyles(
      buttonNamed(container, tEn("settings.updates.checkButton")),
    );
    // Nothing newer exists, so there is no release page worth opening.
    expect(
      [...container.querySelectorAll("button")].find(
        (button) =>
          button.textContent === tEn("settings.updates.downloadButton"),
      ),
    ).toBeUndefined();
  });

  it("links to the published release Homebrew has not synced yet", async () => {
    await render({
      ...readyState("up-to-date"),
      message: msg("settings.updates.tapPendingMessage", {
        publishedVersion: "0.2.0",
      }),
      releaseNotes: "* <strong>Frontmost app name</strong> as context",
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.tapPendingMessage", { publishedVersion: "0.2.0" }),
    );
    // What the release changed, escaped the same way an offer's notes are.
    expect(container.textContent).toContain("as context");
    expect(container.innerHTML).toContain("&lt;strong&gt;");

    const download = buttonNamed(
      container,
      tEn("settings.updates.downloadButton"),
    );
    expect(download.type).toBe("button");
    expectOutlineStyles(download);
    await click(download);
    // Main already aimed the release URL at that tag; the renderer just asks.
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("locks tap-pending actions while a re-check is pending", async () => {
    await render({
      ...readyState("up-to-date"),
      message: msg("settings.updates.tapPendingMessage", {
        publishedVersion: "0.2.0",
      }),
    });
    let resolveCheck: (() => void) | undefined;
    const pendingCheck = new Promise<void>((resolve) => {
      resolveCheck = resolve;
    });
    api.checkForUpdates.mockReturnValueOnce(pendingCheck);

    const check = buttonNamed(container, tEn("settings.updates.checkButton"));
    const download = buttonNamed(
      container,
      tEn("settings.updates.downloadButton"),
    );
    await click(check);

    expect(check.disabled).toBe(true);
    expect(download.disabled).toBe(true);
    await click(check);
    await click(download);
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.openUpdateRelease).not.toHaveBeenCalled();

    resolveCheck?.();
    await waitForUi();
  });

  it("locks tap-pending actions while the release link is opening", async () => {
    await render({
      ...readyState("up-to-date"),
      message: msg("settings.updates.tapPendingMessage", {
        publishedVersion: "0.2.0",
      }),
    });
    let resolveRelease: (() => void) | undefined;
    const pendingRelease = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    api.openUpdateRelease.mockReturnValueOnce(pendingRelease);

    const check = buttonNamed(container, tEn("settings.updates.checkButton"));
    const download = buttonNamed(
      container,
      tEn("settings.updates.downloadButton"),
    );
    await click(download);

    expect(check.disabled).toBe(true);
    expect(download.disabled).toBe(true);
    await click(check);
    await click(download);
    expect(api.checkForUpdates).not.toHaveBeenCalled();
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);

    resolveRelease?.();
    await waitForUi();
  });

  it("offers a manual GitHub download without rendering its notes as HTML", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      releaseNotes: "<strong>Safer updater</strong>",
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.available", {
        version: "v0.2.0",
        currentVersion: "0.1.0",
      }),
    );
    expect(container.innerHTML).toContain(
      "&lt;strong&gt;Safer updater&lt;/strong&gt;",
    );

    // `installInstructions` is a longer prose string; assert the whole
    // catalog value rather than a hand-picked prefix.
    expect(container.textContent).toContain(
      tEn("settings.updates.installInstructions"),
    );
    expect(container.textContent).toContain(
      'xattr -dr com.apple.quarantine "/Applications/FixLang.app"',
    );
    const download = buttonNamed(
      container,
      tEn("settings.updates.downloadButton"),
    );
    expectPrimaryStyles(download);
    expectOutlineStyles(
      buttonNamed(container, tEn("settings.updates.checkButton")),
    );
    expect(buttonNamed(container, tEn("settings.updates.checkButton")).type).toBe(
      "button",
    );
    await click(download);
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("offers a one-click Homebrew update for a cask install", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      canInstall: true,
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.canInstallDescription"),
    );
    // The manual replace-the-bundle instructions belong to the DMG path only;
    // the static "How to update" reference below still documents them.
    expect(container.textContent).not.toContain(
      tEn("settings.updates.installInstructions"),
    );

    const install = buttonNamed(container, tEn("settings.updates.installNow"));
    expectPrimaryStyles(install);
    expect(install.type).toBe("button");
    expectOutlineStyles(
      buttonNamed(container, tEn("settings.updates.downloadButton")),
    );
    expectOutlineStyles(
      buttonNamed(container, tEn("settings.updates.viewReleases")),
    );
    await click(install);

    expect(api.installUpdate).toHaveBeenCalledTimes(1);
    expect(api.openUpdateRelease).not.toHaveBeenCalled();
  });

  it("hides the one-click update from a manual DMG install", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      canInstall: false,
    });

    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === tEn("settings.updates.installNow"),
      ),
    ).toBeUndefined();
    expect(container.textContent).toContain(
      'xattr -dr com.apple.quarantine "/Applications/FixLang.app"',
    );
  });

  it("surfaces a failed install start as an error", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      canInstall: true,
    });
    // `run()` never reads this `error` descriptor — it always sets
    // `state.message` from its own bound failure message (see below) — but
    // the mock still needs the shape `installUpdate()` actually resolves to.
    api.installUpdate.mockResolvedValueOnce({
      success: false,
      error: msg("settings.updates.installErrorMessage"),
    });

    await click(buttonNamed(container, tEn("settings.updates.installNow")));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      tEn("settings.updates.installFailed"),
    );
  });

  it("disables every available action while an install request is pending", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      canInstall: true,
    });
    let resolveInstall: (() => void) | undefined;
    const pendingInstall = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });
    api.installUpdate.mockReturnValueOnce(pendingInstall);

    await click(buttonNamed(container, tEn("settings.updates.installNow")));

    for (const label of [
      tEn("settings.updates.installNow"),
      tEn("settings.updates.downloadButton"),
      tEn("settings.updates.viewReleases"),
      tEn("settings.updates.checkButton"),
    ]) {
      expect(buttonNamed(container, label).disabled).toBe(true);
    }

    resolveInstall?.();
    await waitForUi();
  });

  it("announces the installing phase while Homebrew works", async () => {
    await render({
      ...readyState("installing"),
      availableVersion: "0.2.0",
      canInstall: true,
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      tEn("settings.updates.installingDescription", { version: "v0.2.0" }),
    );
  });

  it("retains progress semantics while the Homebrew download is active", async () => {
    await render({
      ...readyState("downloading"),
      availableVersion: "0.2.0",
      downloadedBytes: 25 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
    });

    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("25");
    expect(progress?.getAttribute("aria-valuemax")).toBe("100");
    expectNoUpdateActions(container);
  });

  it("keeps a stalled Homebrew update status non-interactive", async () => {
    await render({
      ...readyState("installing"),
      availableVersion: "0.2.0",
      message: msg("settings.updates.installingDescription", {
        version: "v0.2.0",
      }),
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      tEn("settings.updates.installingDescription", {
        version: "v0.2.0",
      }),
    );
    expectNoUpdateActions(container);
  });

  it("restarts the installed update, including the wrong-bundle recovery state", async () => {
    await render({
      ...readyState("restart-required"),
      availableVersion: "0.2.0",
      message: msg("settings.updates.wrongBundleMessage", {
        targetVersion: "0.2.0",
        targetPath: "/Applications/FixLang.app",
      }),
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      tEn("settings.updates.wrongBundleMessage", {
        targetVersion: "0.2.0",
        targetPath: "/Applications/FixLang.app",
      }),
    );

    const restart = buttonNamed(container, tEn("settings.updates.restartButton"));
    expectPrimaryStyles(restart);
    expect(restart.type).toBe("button");
    await click(restart);
    expect(api.restartForUpdate).toHaveBeenCalledTimes(1);
  });

  it("prevents a second restart while the recovery request is pending", async () => {
    await render({
      ...readyState("restart-required"),
      availableVersion: "0.2.0",
    });
    let resolveRestart: (() => void) | undefined;
    const pendingRestart = new Promise<void>((resolve) => {
      resolveRestart = resolve;
    });
    api.restartForUpdate.mockReturnValueOnce(pendingRestart);

    const restart = buttonNamed(container, tEn("settings.updates.restartButton"));
    await click(restart);

    expect(restart.disabled).toBe(true);
    await click(restart);
    expect(api.restartForUpdate).toHaveBeenCalledTimes(1);

    resolveRestart?.();
    await waitForUi();
  });

  it("renders GitHub-flavored markdown release notes instead of raw text", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: "## Title\n* item [link](https://example.com)",
    });

    const heading = [...container.querySelectorAll("h1, h2, h3")].find(
      (candidate) => candidate.textContent === "Title",
    );
    const listItem = container.querySelector("li");

    expect(heading).toBeTruthy();
    expect(listItem?.textContent).toContain("item");
    expect(container.textContent).not.toContain("## Title");
    expect(container.textContent).not.toContain("* item");

    const link = container.querySelector("a[href='https://example.com']");
    expect(link).not.toBeNull();

    await click(link as Element);
    expect(api.openExternalLink).toHaveBeenCalledWith("https://example.com");
  });

  it("lets the user retry and open the release page after an error", async () => {
    await render({
      ...readyState("error"),
      message: msg("settings.updates.checkErrorMessage"),
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      tEn("settings.updates.checkErrorMessage"),
    );
    await click(buttonNamed(container, tEn("settings.updates.tryAgain")));
    await click(buttonNamed(container, tEn("settings.updates.viewReleases")));

    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("subscribes to update state changes and cleans up on unmount", async () => {
    await render(readyState());

    expect(api.onUpdateStateChanged).toHaveBeenCalledTimes(1);
    await act(async () => {
      updateListener?.({
        ...readyState("available"),
        availableVersion: "0.2.0",
      });
    });
    expect(container.textContent).toContain(
      tEn("settings.updates.available", {
        version: "v0.2.0",
        currentVersion: "0.1.0",
      }),
    );

    await act(async () => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    root = undefined as unknown as Root;
  });

  it("does not let a late initial snapshot overwrite a newer update event", async () => {
    let resolveInitial: ((state: UpdateState) => void) | undefined;
    const initial = new Promise<UpdateState>((resolve) => {
      resolveInitial = resolve;
    });

    await render(readyState());
    api.getUpdateState.mockReturnValueOnce(initial);

    await act(async () => {
      root.unmount();
    });

    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingUpdates)),
      );
    });
    await waitForUi();
    await waitForUi();

    await act(async () => {
      updateListener?.({
        ...readyState("available"),
        availableVersion: "0.2.0",
      });
      resolveInitial?.(readyState("idle"));
      await initial;
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.available", {
        version: "v0.2.0",
        currentVersion: "0.1.0",
      }),
    );
    expect(container.textContent).not.toContain(
      tEn("settings.updates.idleDescription"),
    );
  });

  it("does not let a late snapshot failure overwrite a newer update event", async () => {
    let rejectInitial: ((error: Error) => void) | undefined;
    const initial = new Promise<UpdateState>((_resolve, reject) => {
      rejectInitial = reject;
    });

    await render(readyState());
    api.getUpdateState.mockReturnValueOnce(initial);

    await act(async () => {
      root.unmount();
    });

    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingUpdates)),
      );
    });
    await waitForUi();
    await waitForUi();

    await act(async () => {
      updateListener?.({
        ...readyState("available"),
        availableVersion: "0.2.0",
      });
      rejectInitial?.(new Error("late snapshot failure"));
      await initial.catch(() => undefined);
    });

    expect(container.textContent).toContain(
      tEn("settings.updates.available", {
        version: "v0.2.0",
        currentVersion: "0.1.0",
      }),
    );
    expect(container.textContent).not.toContain(
      tEn("settings.updates.loadFailed"),
    );
  });

  it("shows a locale-free load-failure descriptor that re-renders in Japanese without an extra fetch", async () => {
    const getUpdateState = vi.fn().mockRejectedValue(new Error("network down"));
    await renderWithApi({
      getUpdateState,
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
      openExternalLink: vi.fn().mockResolvedValue({ success: true }),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return vi.fn();
      }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: "en" | "ja") => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    });

    const enExpected = tEn("settings.updates.loadFailed");
    const jaExpected = tJa("settings.updates.loadFailed");

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      enExpected,
    );

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    // Prove the locale actually changed: JA text matches the JA-derived
    // expectation and differs from the EN one (this is the exact regression
    // this file used to hide — a JA catalog reword failed here even though
    // the component itself was correct).
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      jaExpected,
    );
    expect(jaExpected).not.toBe(enExpected);
    // The locale switch must not re-run `getUpdateState()` — the mount
    // effect's dependency array stays `[]` because it no longer resolves
    // `t()` itself.
    expect(getUpdateState).toHaveBeenCalledTimes(1);
  });

  it("re-resolves a parameterized service-reported error (e.g. Homebrew tap lag) in Japanese after a locale switch", async () => {
    await renderWithApi({
      getUpdateState: vi.fn().mockResolvedValue(readyState()),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
      openExternalLink: vi.fn().mockResolvedValue({ success: true }),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return vi.fn();
      }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: "en" | "ja") => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    });

    await act(async () => {
      updateListener?.({
        phase: "error",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        message: msg("settings.updates.tapBehindMessage", {
          targetVersion: "0.2.0",
          offeredVersion: "0.1.0",
        }),
      });
    });

    const tapBehindParams = { targetVersion: "0.2.0", offeredVersion: "0.1.0" };
    const enExpected = tEn(
      "settings.updates.tapBehindMessage",
      tapBehindParams,
    );
    const jaExpected = tJa(
      "settings.updates.tapBehindMessage",
      tapBehindParams,
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      enExpected,
    );

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    // Prove the locale actually changed (see the loadFailed test above for
    // why both the positive and the "differs from EN" assertion matter).
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      jaExpected,
    );
    expect(jaExpected).not.toBe(enExpected);
  });
});
