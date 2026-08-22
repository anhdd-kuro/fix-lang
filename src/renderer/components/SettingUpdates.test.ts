import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msg, type Message } from "~/features/i18n/shared/message";
import { createTranslator } from "~/features/i18n/shared/translate";
// The component's OWN predicate; a local restatement would pin the JSX only
// against this file's opinion.
import {
  phaseRendersPrereleaseMessage,
  SettingUpdates,
} from "./SettingUpdates";
import { I18nProvider } from "../i18n/I18nProvider";

// Expected copy is derived through the real translator kernel, never
// hand-restated, so an English-fallback regression still fails a JA assertion.
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

// Declared locally because these are the values a mocked bridge hands the
// component, not the component's own imports.
type PrereleaseState = {
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
  activeChannel: "stable" | "beta" | "both";
  offeredVersion?: string;
  releaseNotes?: string;
  message?: Message;
  canSwitch?: boolean;
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
  getPrereleaseState: ReturnType<typeof vi.fn>;
  checkForPrerelease: ReturnType<typeof vi.fn>;
  switchToPrerelease: ReturnType<typeof vi.fn>;
  revertToStable: ReturnType<typeof vi.fn>;
  onPrereleaseStateChanged: ReturnType<typeof vi.fn>;
  // `<I18nProvider>` reads these off `window.electronAPI` on mount.
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

/**
 * Every member an older preload does not expose. `keyof`-checked and asserted
 * absent below, so the set cannot drift from what a prose comment claims.
 */
const PRERELEASE_BRIDGE_MEMBERS = [
  "getPrereleaseState",
  "checkForPrerelease",
  "switchToPrerelease",
  "revertToStable",
  "onPrereleaseStateChanged",
] as const satisfies readonly (keyof UpdateApi)[];

type PrereleaseBridgeMember = (typeof PRERELEASE_BRIDGE_MEMBERS)[number];

/**
 * A bridge genuinely lacking those members, which no honest type can express.
 * The `Omit` keeps the cast from suppressing the checker wholesale: the
 * REMAINING members are still checked.
 */
const legacyPreloadApi = (
  api: Omit<UpdateApi, PrereleaseBridgeMember>,
): UpdateApi => api as UpdateApi;

const readyState = (phase: UpdateState["phase"] = "idle"): UpdateState => ({
  phase,
  currentVersion: "0.1.0",
});

const prereleaseReady = (
  phase: PrereleaseState["phase"] = "idle",
  extra: Partial<PrereleaseState> = {},
): PrereleaseState => ({
  phase,
  activeChannel: "stable",
  canSwitch: true,
  ...extra,
});

const BETA_VERSION = "0.3.0-beta.1";

const QUARANTINE_COMMAND =
  'xattr -dr com.apple.quarantine "/Applications/FixLang.app"';

/** Occurrences of the quarantine command in rendered text (the static "How to update" reference always holds one). */
const quarantineCommandCount = (text: string): number =>
  text.split(QUARANTINE_COMMAND).length - 1;

const STABLE_CASK_TOKEN = "fixlang";
const BETA_CASK_TOKEN = "fixlang@beta";
const BOTH_CASKS_PARAMS = {
  stableToken: STABLE_CASK_TOKEN,
  betaToken: BETA_CASK_TOKEN,
  fixCommand: `brew uninstall --cask ${BETA_CASK_TOKEN}`,
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

const buttonNamed = (
  container: ParentNode,
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

const maybeButtonNamed = (
  container: ParentNode,
  label: string,
): HTMLButtonElement | undefined =>
  [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );

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
  let prereleaseListener: ((state: PrereleaseState) => void) | undefined;
  let localeListener: ((locale: "en" | "ja") => void) | undefined;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let prereleaseUnsubscribe: ReturnType<typeof vi.fn>;
  let api: UpdateApi;

  const prereleaseSection = (): HTMLElement => {
    const section = container.querySelector<HTMLElement>(
      'section[aria-labelledby="prerelease-updates-heading"]',
    );
    if (!section) {
      throw new Error("Expected the pre-release section to be rendered");
    }
    return section;
  };

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
    // `<I18nProvider>` renders null until an async `getLocale()` resolves (to
    // avoid an EN -> JA flash), so this needs a tick beyond `waitForUi()`.
    await waitForUi();
    await waitForUi();
  };

  /** Captured so all three call sites get a full-preload-shaped bridge. */
  const prereleaseBridge = (state: PrereleaseState) => {
    prereleaseUnsubscribe = vi.fn();
    return {
      getPrereleaseState: vi.fn().mockResolvedValue(state),
      checkForPrerelease: vi.fn().mockResolvedValue(state),
      switchToPrerelease: vi.fn().mockResolvedValue({ success: true }),
      revertToStable: vi.fn().mockResolvedValue({ success: true }),
      onPrereleaseStateChanged: vi.fn(
        (listener: (next: PrereleaseState) => void) => {
          prereleaseListener = listener;
          return prereleaseUnsubscribe;
        },
      ),
    };
  };

  const renderInLocale = async (
    locale: "en" | "ja",
    state: UpdateState,
    prerelease: PrereleaseState,
  ) => {
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
      ...prereleaseBridge(prerelease),
      getLocale: vi.fn().mockResolvedValue({ locale }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
    });
  };

  const render = async (
    state: UpdateState,
    prerelease: PrereleaseState = {
      phase: "unsupported",
      activeChannel: "stable",
      canSwitch: false,
    },
  ) => renderInLocale("en", state, prerelease);

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    updateListener = undefined;
    prereleaseListener = undefined;
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
    expectPrimaryStyles(
      buttonNamed(container, tEn("settings.updates.checkButton")),
    );
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
    expect(container.textContent).toContain("as context");
    expect(container.innerHTML).toContain("&lt;strong&gt;");

    const download = buttonNamed(
      container,
      tEn("settings.updates.downloadButton"),
    );
    expect(download.type).toBe("button");
    expectOutlineStyles(download);
    await click(download);
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
    // DMG-path only; the static "How to update" reference keeps its own copy.
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
    // `run()` never reads this `error`, but the mock still needs the shape
    // `installUpdate()` actually resolves to.
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
    const size = container.querySelector('[role="status"] .text-primary');
    expect(size?.textContent).toBe(
      tEn("settings.updates.downloadingSize", {
        downloaded: "25.0 MB",
        total: "100.0 MB",
      }),
    );
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

  const linkIn = (scope: HTMLElement, href: string): HTMLAnchorElement => {
    const link = scope.querySelector<HTMLAnchorElement>(`a[href='${href}']`);
    if (!link) {
      throw new Error(`Expected a release-notes link to ${href}`);
    }
    return link;
  };

  const linkTo = (href: string): HTMLAnchorElement => linkIn(container, href);

  /** Cancelable, unlike the shared `click`: `preventDefault()` is the point. */
  const clickCancelable = async (element: Element): Promise<MouseEvent> => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      element.dispatchEvent(event);
    });
    return event;
  };

  /**
   * `[name, label markdown, href slug]`, the href always
   * `https://evil.example.com/<slug>`, so a passing row proves BOTH halves: the
   * annotation names `evil.example.com`, and the `github.com` label — which the
   * href never contains — survived intact. No list of decorated labels can be
   * complete, which is why the component reads no part of one.
   */
  const TRUSTED_LOOKING = "https://github.com/anhdd-kuro/fix-lang";
  const DECORATED_LABELS: readonly (readonly [string, string, string])[] = [
    ["undecorated", TRUSTED_LOOKING, "plain"],
    // Escaped, never pasted: these render as nothing at all, and two of them
    // are a `no-irregular-whitespace` error rather than a fixture.
    ["zero-width space prefix", `\u200B${TRUSTED_LOOKING}`, "zwsp"],
    ["soft hyphen prefix", `\u00AD${TRUSTED_LOOKING}`, "shy"],
    ["ASCII space prefix", ` ${TRUSTED_LOOKING}`, "space"],
    ["no-break space prefix", `\u00A0${TRUSTED_LOOKING}`, "nbsp"],
    ["wrapping quotes", `"${TRUSTED_LOOKING}"`, "quotes"],
    ["wrapping parentheses", `(${TRUSTED_LOOKING})`, "parens"],
    ["bullet prefix", `• ${TRUSTED_LOOKING}`, "bullet"],
    ["tab prefix", `\t${TRUSTED_LOOKING}`, "tab"],
    ["space before bold", ` **${TRUSTED_LOOKING}**`, "bold"],
    ["trailing hard break", `${TRUSTED_LOOKING}  \nand more`, "break"],
    [
      "image in the label",
      `![](https://example.com/pixel.png)${TRUSTED_LOOKING}`,
      "image",
    ],
    [
      "division slash for the scheme separator",
      "https:∕∕github.com/anhdd-kuro/fix-lang",
      "slash",
    ],
    ["bare host, no path", "github.com", "bare"],
  ];

  /**
   * THE TWO PANES THAT RENDER RELEASE NOTES. Every table below runs against
   * both: pinning one alone leaves the other free to lose the host annotation,
   * the click routing and the image suppression with nothing red. A third pane
   * belongs in this array, never in a copy of these assertions.
   */
  const NOTES_PANES = [
    {
      name: "stable",
      show: async (notes: string) => {
        await render({
          ...readyState("available"),
          availableVersion: "0.3.0",
          releaseNotes: notes,
        });
      },
      scope: (): HTMLElement => container,
    },
    {
      name: "pre-release",
      show: async (notes: string) => {
        await render(
          readyState("up-to-date"),
          prereleaseReady("available", {
            offeredVersion: BETA_VERSION,
            releaseNotes: notes,
          }),
        );
      },
      scope: (): HTMLElement => prereleaseSection(),
    },
  ] as const;

  type NotesPane = (typeof NOTES_PANES)[number];

  /** `[paneName, rowName, pane, label, hrefSlug]` — the pane name leads so the test title names it. */
  const NOTES_PANE_LABEL_ROWS: readonly (readonly [
    string,
    string,
    NotesPane,
    string,
    string,
  ])[] = NOTES_PANES.flatMap((pane) =>
    DECORATED_LABELS.map(
      ([name, label, slug]) => [pane.name, name, pane, label, slug] as const,
    ),
  );

  const EACH_NOTES_PANE: readonly (readonly [string, NotesPane])[] =
    NOTES_PANES.map((pane) => [pane.name, pane] as const);

  it.each(NOTES_PANE_LABEL_ROWS)(
    "names the host a click opens whatever the label wears (%s pane, %s)",
    async (_paneName, _rowName, pane, label, slug) => {
      const href = `https://evil.example.com/${slug}`;
      await pane.show(`[${label}](${href})`);

      const link = linkIn(pane.scope(), href);
      expect(link.textContent).toContain("github.com");
      expect(link.textContent).toContain(" (evil.example.com)");
      expect(link.title).toBe(href);
    },
  );

  it.each(EACH_NOTES_PANE)(
    "routes a release-notes link through the external-link bridge rather than navigating (%s pane)",
    async (_paneName, pane) => {
      const href = "https://evil.example.com/dl/FixLang.dmg";
      await pane.show(`[${TRUSTED_LOOKING}](${href})`);

      const event = await clickCancelable(linkIn(pane.scope(), href));

      expect(api.openExternalLink).toHaveBeenCalledWith(href);
      // Renderer half of a two-layer defence (main's `will-navigate` guard is the
      // other): without `preventDefault()` the click ALSO navigates, in-window.
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it.each(EACH_NOTES_PANE)(
    "never auto-loads a remote image from release notes (%s pane)",
    async (_paneName, pane) => {
      // Untrusted remote content: a rendered `<img>` is a read receipt plus
      // the IP of everyone who opens About -> Updates, with no click involved.
      await pane.show(
        "![release banner](https://evil.example.com/px.png?u=1)\n\nWhat changed",
      );

      const scope = pane.scope();
      expect(scope.querySelector("img")).toBeNull();
      // Not vacuous: the notes really did render, the image alone did not.
      expect(scope.textContent).toContain("What changed");
    },
  );

  it("names the real host when userinfo makes the href itself read as GitHub", async () => {
    // `https://github.com@evil.example.com/…` has evil.example.com as its
    // AUTHORITY and `github.com` as a USERNAME, so the host is parsed, not echoed.
    const href = "https://github.com@evil.example.com/dl/FixLang.dmg";
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: `[${TRUSTED_LOOKING}](${href})`,
    });

    const link = linkTo(href);
    expect(link.textContent).toContain(" (evil.example.com)");
    expect(link.textContent).not.toContain("github.com@");

    await click(link);
    expect(api.openExternalLink).toHaveBeenCalledWith(href);
  });

  it("counts a swapped port as part of the destination", async () => {
    // `github.com:8080` is not the host a reader means, so the port stays.
    const href = "https://github.com:8080/anhdd-kuro/fix-lang";
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: `[${TRUSTED_LOOKING}](${href})`,
    });

    expect(linkTo(href).textContent).toContain(" (github.com:8080)");
  });

  it("states its own limit: a same-host path swap is only in the tooltip", async () => {
    // STATED LIMIT, pinned rather than left to a comment: the annotation names
    // the HOST, so a same-host path swap is not in the visible text.
    const href = "https://github.com/attacker/fix-lang/releases";
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: `[${TRUSTED_LOOKING}/releases](${href})`,
    });

    const link = linkTo(href);
    expect(link.textContent).toBe(`${TRUSTED_LOOKING}/releases (github.com)`);
    expect(link.title).toBe(href);
  });

  it("keeps a code-span label rendered as code", async () => {
    // A defence that REPLACES the label throws the children tree away with it.
    const href = "https://github.com/anhdd-kuro/fix-lang/blob/main/README.md";
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: `[\`github.com/anhdd-kuro/fix-lang\`](${href})`,
    });

    const link = linkTo(href);
    expect(link.querySelector("code")?.textContent).toBe(
      "github.com/anhdd-kuro/fix-lang",
    );
    expect(link.textContent).toBe("github.com/anhdd-kuro/fix-lang (github.com)");
  });

  it("leaves a link that differs from its label only cosmetically alone", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: [
        `[${TRUSTED_LOOKING}](${TRUSTED_LOOKING}#install)`,
        `[${TRUSTED_LOOKING}](${TRUSTED_LOOKING}?tab=readme)`,
        `[${TRUSTED_LOOKING}](${TRUSTED_LOOKING}/)`,
        `[www.github.com/anhdd-kuro/fix-lang](${TRUSTED_LOOKING})`,
      ].join(" "),
    });

    expect(linkTo(`${TRUSTED_LOOKING}#install`).textContent).toBe(
      `${TRUSTED_LOOKING} (github.com)`,
    );
    expect(linkTo(`${TRUSTED_LOOKING}?tab=readme`).textContent).toBe(
      `${TRUSTED_LOOKING} (github.com)`,
    );
    expect(linkTo(`${TRUSTED_LOOKING}/`).textContent).toBe(
      `${TRUSTED_LOOKING} (github.com)`,
    );
    expect(linkTo(TRUSTED_LOOKING).textContent).toBe(
      "www.github.com/anhdd-kuro/fix-lang (github.com)",
    );
  });

  it("leaves ordinary release-notes labels and autolinks as written", async () => {
    // An annotation only some links carry teaches that its ABSENCE means safe.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: [
        `See [the full changelog](${TRUSTED_LOOKING}/releases)`,
        `and [README.md](${TRUSTED_LOOKING}/blob/main/README.md),`,
        `or ${TRUSTED_LOOKING}/pull/12.`,
      ].join(" "),
    });

    expect(linkTo(`${TRUSTED_LOOKING}/releases`).textContent).toBe(
      "the full changelog (github.com)",
    );
    expect(linkTo(`${TRUSTED_LOOKING}/blob/main/README.md`).textContent).toBe(
      "README.md (github.com)",
    );
    expect(linkTo(`${TRUSTED_LOOKING}/pull/12`).textContent).toBe(
      `${TRUSTED_LOOKING}/pull/12 (github.com)`,
    );
  });

  it.each(EACH_NOTES_PANE)(
    "annotates nothing for a link a click cannot dispatch (%s pane)",
    async (_paneName, pane) => {
      // `mailto:` survives react-markdown's scheme allowlist but the handler
      // dispatches only `http(s)`, so no destination exists to imply.
      await pane.show("[support@example.com](mailto:support@example.com)");

      const link = linkIn(pane.scope(), "mailto:support@example.com");
      expect(link.textContent).toBe("support@example.com");

      await click(link);
      expect(api.openExternalLink).not.toHaveBeenCalled();
    },
  );

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
      ...prereleaseBridge({
        phase: "unsupported",
        activeChannel: "stable",
        canSwitch: false,
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

    // Differs from the EN expectation, so an English fallback still fails.
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      jaExpected,
    );
    expect(jaExpected).not.toBe(enExpected);
    // The locale switch must not re-run `getUpdateState()`; the mount effect's
    // dependency array stays `[]` because it no longer resolves `t()` itself.
    expect(getUpdateState).toHaveBeenCalledTimes(1);
  });

  it("re-resolves a parameterized service-reported error (e.g. Homebrew tap lag) in Japanese after a locale switch", async () => {
    const tapBehindParams = { targetVersion: "0.2.0", offeredVersion: "0.1.0" };
    const tapBehind = msg("settings.updates.tapBehindMessage", tapBehindParams);
    await renderWithApi({
      getUpdateState: vi.fn().mockResolvedValue({
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      }),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      // The whole production sequence: main publishes the descriptor from
      // inside the handler AND returns it when the invoke reply resolves.
      installUpdate: vi.fn().mockImplementation(async () => {
        updateListener?.({
          phase: "error",
          currentVersion: "0.1.0",
          availableVersion: "0.2.0",
          message: tapBehind,
        });
        return { success: false, error: tapBehind };
      }),
      restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
      openExternalLink: vi.fn().mockResolvedValue({ success: true }),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return vi.fn();
      }),
      ...prereleaseBridge({
        phase: "unsupported",
        activeChannel: "stable",
        canSwitch: false,
      }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: "en" | "ja") => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    });

    await click(buttonNamed(container, tEn("settings.updates.installNow")));
    await waitForUi();

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

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      jaExpected,
    );
    expect(jaExpected).not.toBe(enExpected);
  });

  it("keeps main's specific install-failure descriptor instead of the bound generic", async () => {
    // Production order, reproduced exactly: the handler sends its `Message`
    // before returning the same descriptor, so the broadcast lands first — and
    // a bound `installFailed` would overwrite the tap-lag descriptor.
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      prereleaseReady("idle"),
    );
    const tapBehindParams = { targetVersion: "0.2.0", offeredVersion: "0.1.0" };
    const tapBehind = msg("settings.updates.tapBehindMessage", tapBehindParams);
    api.installUpdate.mockImplementationOnce(async () => {
      updateListener?.({
        phase: "error",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        message: tapBehind,
      });
      return { success: false, error: tapBehind };
    });

    await click(buttonNamed(container, tEn("settings.updates.installNow")));
    await waitForUi();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      tEn("settings.updates.tapBehindMessage", tapBehindParams),
    );
    expect(container.textContent).not.toContain(
      tEn("settings.updates.installFailed"),
    );
  });

  it("falls back to the bound message when the install bridge itself breaks", async () => {
    // A REJECTED request carries no descriptor, so the bound generic is all
    // there is — and must still be shown rather than left blank.
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      prereleaseReady("idle"),
    );
    api.installUpdate.mockRejectedValueOnce(new Error("bridge is gone"));

    await click(buttonNamed(container, tEn("settings.updates.installNow")));
    await waitForUi();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      tEn("settings.updates.installFailed"),
    );
  });

  // Pre-release channel. Everything below asserts against the RENDERED subtree
  // (`prereleaseSection()`), never the component's internals: this harness can
  // report green while making zero writes.

  it("renders the pre-release section below the stable flow, boxed off, with its own check button and result line", async () => {
    await render(readyState("up-to-date"), prereleaseReady("idle"));

    const section = prereleaseSection();
    const stableHeading = container.querySelector("#app-updates-heading");
    expect(stableHeading).not.toBeNull();
    expect(
      (stableHeading as Element).compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(section.className).toContain("border");
    expect(section.className).toContain("rounded");
    expect(section.className).toContain("bg-secondary/40");
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.title"),
    );

    const prereleaseCheck = buttonNamed(
      section,
      tEn("settings.updates.prerelease.checkButton"),
    );
    const stableCheck = buttonNamed(
      container,
      tEn("settings.updates.checkButton"),
    );
    expect(prereleaseCheck).not.toBe(stableCheck);
    expect(section.contains(stableCheck)).toBe(false);
    expectPrimaryStyles(prereleaseCheck);

    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.idleDescription"),
    );
  });

  it("leaves the stable flow's status text untouched across a pre-release check", async () => {
    await render(readyState("up-to-date"), prereleaseReady("idle"));

    const stableStatusBefore =
      container.querySelector('[role="status"]')?.textContent;
    expect(stableStatusBefore).toContain(tEn("settings.updates.upToDate"));

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.checkButton"),
      ),
    );
    expect(api.checkForPrerelease).toHaveBeenCalledTimes(1);
    expect(api.checkForUpdates).not.toHaveBeenCalled();

    await act(async () => {
      prereleaseListener?.(
        prereleaseReady("available", {
          offeredVersion: BETA_VERSION,
        }),
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      stableStatusBefore,
    );
    expect(prereleaseSection().textContent).toContain(
      tEn("settings.updates.prerelease.available", {
        version: `v${BETA_VERSION}`,
      }),
    );
  });

  it.each([
    {
      phase: "unsupported",
      state: {
        phase: "unsupported",
        activeChannel: "stable",
        canSwitch: false,
      },
      expected: tEn("settings.updates.prerelease.unsupported"),
    },
    {
      phase: "idle",
      state: prereleaseReady("idle"),
      expected: tEn("settings.updates.prerelease.idleDescription"),
    },
    {
      phase: "checking",
      state: prereleaseReady("checking"),
      expected: tEn("settings.updates.prerelease.checking"),
    },
    {
      phase: "up-to-date",
      state: prereleaseReady("up-to-date"),
      expected: tEn("settings.updates.prerelease.upToDate"),
    },
    {
      phase: "available",
      state: prereleaseReady("available", { offeredVersion: BETA_VERSION }),
      expected: tEn("settings.updates.prerelease.available", {
        version: `v${BETA_VERSION}`,
      }),
    },
    {
      phase: "installing",
      state: prereleaseReady("installing", { offeredVersion: BETA_VERSION }),
      expected: tEn("settings.updates.prerelease.switchDescription"),
    },
    {
      phase: "restart-required",
      state: prereleaseReady("restart-required", {
        offeredVersion: BETA_VERSION,
      }),
      expected: tEn("settings.updates.restartRequiredMessage", {
        targetVersion: `v${BETA_VERSION}`,
      }),
    },
    {
      phase: "error",
      state: prereleaseReady("error"),
      expected: tEn("settings.updates.prerelease.genericError"),
    },
  ] satisfies {
    phase: PrereleaseState["phase"];
    state: PrereleaseState;
    expected: string;
  }[])("renders the $phase pre-release phase", async ({ state, expected }) => {
    await render(readyState(), state);

    expect(prereleaseSection().textContent).toContain(expected);
  });

  it("renders pre-release download progress with its own bytes and bar", async () => {
    await render(
      readyState(),
      prereleaseReady("downloading", {
        offeredVersion: BETA_VERSION,
        downloadedBytes: 30 * 1024 * 1024,
        totalBytes: 120 * 1024 * 1024,
      }),
    );

    const section = prereleaseSection();
    const progress = section.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("25");
    expect(section.querySelector('[role="status"] .text-primary')?.textContent).toBe(
      tEn("settings.updates.downloadingSize", {
        downloaded: "30.0 MB",
        total: "120.0 MB",
      }),
    );
    // Homebrew owns the app from here; nothing in this section may re-arm.
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.checkButton"),
      ),
    ).toBeUndefined();
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeUndefined();
  });

  it("switches to the pre-release through the switch API — the confirm lives in main", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.switchDescription"),
    );
    const switchButton = buttonNamed(
      section,
      tEn("settings.updates.prerelease.switchButton"),
    );
    expect(switchButton.type).toBe("button");
    expectPrimaryStyles(switchButton);

    await click(switchButton);

    // The confirm is main's own dialog; the renderer's whole contract is the call.
    expect(api.switchToPrerelease).toHaveBeenCalledTimes(1);
    expect(api.revertToStable).not.toHaveBeenCalled();
    expect(api.installUpdate).not.toHaveBeenCalled();
  });

  it("reverts to stable through the revert API from a beta install", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("idle", { activeChannel: "beta" }),
    );

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.channelBetaNote"),
    );
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.revertDescription"),
    );
    const revert = buttonNamed(
      section,
      tEn("settings.updates.prerelease.revertButton"),
    );
    expectOutlineStyles(revert);

    await click(revert);

    expect(api.revertToStable).toHaveBeenCalledTimes(1);
    expect(api.switchToPrerelease).not.toHaveBeenCalled();
  });

  it("reports a declined switch confirm without turning the section red", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );
    // A decline is a no-op in main: the returned descriptor is the only trace.
    api.switchToPrerelease.mockResolvedValueOnce({
      success: false,
      error: msg("settings.updates.prerelease.switchCancelledMessage"),
    });

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.switchButton"),
      ),
    );

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.switchCancelledMessage"),
    );
    expect(section.querySelector('[role="alert"]')).toBeNull();
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeDefined();
  });

  it("announces a published channel-op failure once, in the error region only", async () => {
    // Ownership rule: a descriptor main PUBLISHED belongs to the phase box, so
    // setting the notice from it too renders one sentence in an `alert` and a
    // `status` at once and a screen reader announces it twice.
    await render(
      readyState("up-to-date"),
      prereleaseReady("idle", { activeChannel: "beta" }),
    );
    const downloadError = msg(
      "settings.updates.prerelease.downloadErrorMessage",
    );
    api.revertToStable.mockImplementationOnce(async () => {
      prereleaseListener?.({
        phase: "error",
        activeChannel: "beta",
        canSwitch: true,
        message: downloadError,
      });
      return { success: false, error: downloadError };
    });

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ),
    );
    await waitForUi();

    const expected = tEn("settings.updates.prerelease.downloadErrorMessage");
    const section = prereleaseSection();
    const announcing = [
      ...section.querySelectorAll('[role="alert"], [role="status"]'),
    ].filter((node) => node.textContent === expected);
    expect(announcing).toHaveLength(1);
    expect(announcing[0]?.getAttribute("role")).toBe("alert");
  });

  /**
   * Revert asks NOTHING, so `canRevertToStable` is the whole gate in front of a
   * detached Homebrew uninstall-then-install and an app quit. One row per term,
   * each holding the other three, so no term drops without a red test. None of
   * these combinations are ones main publishes: the predicate must fail safe.
   */
  const REVERT_REFUSALS: readonly (readonly [string, PrereleaseState])[] = [
    [
      "an unsupported state that claims a beta channel",
      { phase: "unsupported", activeChannel: "beta", canSwitch: true },
    ],
    [
      "an ordinary stable install that has only checked for a beta",
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    ],
    [
      "a beta install Homebrew cannot switch",
      prereleaseReady("up-to-date", {
        activeChannel: "beta",
        canSwitch: false,
      }),
    ],
    [
      "a beta install Homebrew is already installing over",
      prereleaseReady("installing", { activeChannel: "beta" }),
    ],
    [
      "a beta install waiting on the restart Homebrew staged",
      prereleaseReady("restart-required", { activeChannel: "beta" }),
    ],
  ];

  it.each(REVERT_REFUSALS)(
    "keeps the no-confirm Revert button off %s",
    async (_name, prerelease) => {
      await render(readyState("up-to-date"), prerelease);

      expect(
        maybeButtonNamed(
          prereleaseSection(),
          tEn("settings.updates.prerelease.revertButton"),
        ),
      ).toBeUndefined();
      expect(api.revertToStable).not.toHaveBeenCalled();
    },
  );

  it("still announces a channel-op failure the phase box does not render", async () => {
    // Suppression is correct only when the published phase ACTUALLY renders the
    // descriptor; otherwise the sentence appears nowhere at all.
    await render(
      readyState("up-to-date"),
      prereleaseReady("idle", { activeChannel: "beta" }),
    );
    const revertError = msg("settings.updates.prerelease.revertErrorMessage");
    api.revertToStable.mockImplementationOnce(async () => {
      prereleaseListener?.({
        phase: "up-to-date",
        activeChannel: "beta",
        canSwitch: true,
        message: revertError,
      });
      return { success: false, error: revertError };
    });

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ),
    );
    await waitForUi();

    const expected = tEn("settings.updates.prerelease.revertErrorMessage");
    const announcing = [
      ...prereleaseSection().querySelectorAll('[role="alert"], [role="status"]'),
    ].filter((node) => node.textContent === expected);
    expect(announcing).toHaveLength(1);
    expect(announcing[0]?.getAttribute("role")).toBe("status");
  });

  it("pins which pre-release phases render main's descriptor themselves", async () => {
    // Pushed through the LIVE component one phase at a time, expectation taken
    // from the imported predicate rather than a list restated here.
    const allPhases: PrereleaseState["phase"][] = [
      "unsupported",
      "idle",
      "checking",
      "up-to-date",
      "available",
      "downloading",
      "installing",
      "restart-required",
      "error",
    ];
    await render(
      readyState("up-to-date"),
      prereleaseReady("idle", { activeChannel: "beta" }),
    );
    const carried = msg("settings.updates.prerelease.revertErrorMessage");
    const expected = tEn("settings.updates.prerelease.revertErrorMessage");

    for (const phase of allPhases) {
      await act(async () => {
        prereleaseListener?.({
          phase,
          activeChannel: "beta",
          canSwitch: true,
          message: carried,
        });
      });
      expect({
        phase,
        rendered: prereleaseSection().textContent?.includes(expected) ?? false,
      }).toEqual({ phase, rendered: phaseRendersPrereleaseMessage(phase) });
    }
  });

  it("names both cask tokens when a dead switch left them installed at once", async () => {
    await render(readyState("up-to-date"), {
      phase: "error",
      activeChannel: "both",
      canSwitch: false,
      message: msg(
        "settings.updates.prerelease.bothCasksMessage",
        BOTH_CASKS_PARAMS,
      ),
    });

    const section = prereleaseSection();
    const alert = section.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      tEn("settings.updates.prerelease.bothCasksMessage", BOTH_CASKS_PARAMS),
    );
    // Useless unless it names both tokens and the command that removes one.
    expect(alert?.textContent).toContain(STABLE_CASK_TOKEN);
    expect(alert?.textContent).toContain(BETA_CASK_TOKEN);
    expect(alert?.textContent).toContain(BOTH_CASKS_PARAMS.fixCommand);
    // Ambiguous: neither one-click direction may be offered.
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeUndefined();
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.revertButton"),
      ),
    ).toBeUndefined();
  });

  it("offers a GitHub download link instead of a one-click switch on a manual install", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", {
        canSwitch: false,
        offeredVersion: BETA_VERSION,
      }),
    );

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.manualSwitchInstructions"),
    );
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeUndefined();

    const link = section.querySelector("a[href]");
    expect(link?.textContent).toBe(tEn("settings.updates.downloadButton"));
    await click(link as Element);
    expect(api.openExternalLink).toHaveBeenCalledWith(
      "https://github.com/anhdd-kuro/fix-lang/releases",
    );
  });

  it("offers a beta install the GitHub link rather than a switch it cannot run", async () => {
    // `switchToPrerelease` refuses unless `activeChannel` is exactly `"stable"`.
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", {
        activeChannel: "beta",
        offeredVersion: BETA_VERSION,
      }),
    );

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.betaChannelUpgradeHint"),
    );
    expect(section.textContent).not.toContain(
      tEn("settings.updates.prerelease.manualSwitchInstructions"),
    );
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeUndefined();
    expect(section.querySelector("a[href]")?.textContent).toBe(
      tEn("settings.updates.downloadButton"),
    );
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.revertButton"),
      ),
    ).toBeDefined();
  });

  it("sends a beta install to Revert rather than to a manual DMG install", async () => {
    // `canInstall` is false on a beta install (no stable cask staged, so `brew
    // upgrade` refuses the token), but a DMG instruction is the wrong route.
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: false,
      },
      prereleaseReady("idle", { activeChannel: "beta" }),
    );

    expect(container.textContent).toContain(
      tEn("settings.updates.prerelease.stableBlockedByBeta"),
    );
    expect(container.textContent).not.toContain(
      tEn("settings.updates.installInstructions"),
    );
    // The static "How to update" reference holds its own copy, so this counts.
    expect(quarantineCommandCount(container.textContent ?? "")).toBe(1);
    expect(
      maybeButtonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ),
    ).toBeDefined();
  });

  it("freezes the stable Install button while a channel switch confirm is open", async () => {
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );
    // Main claims its SHARED `installing` flag before awaiting a confirm with no
    // parent window, so this panel stays clickable reading `available` beneath it.
    let resolveSwitch: ((result: { success: boolean }) => void) | undefined;
    api.switchToPrerelease.mockReturnValueOnce(
      new Promise<{ success: boolean }>((resolve) => {
        resolveSwitch = resolve;
      }),
    );

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.switchButton"),
      ),
    );

    const install = buttonNamed(container, tEn("settings.updates.installNow"));
    expect(install.disabled).toBe(true);
    await click(install);
    // Otherwise the app quits into a channel switch this section never mentioned.
    expect(api.installUpdate).not.toHaveBeenCalled();
    expect(
      buttonNamed(container, tEn("settings.updates.checkButton")).disabled,
    ).toBe(true);

    resolveSwitch?.({ success: true });
    await waitForUi();
  });

  it("keeps the stable Install button live during a pre-release CHECK", async () => {
    // A check never claims `installing`, so freezing here is its own regression.
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      prereleaseReady("idle"),
    );
    let resolveCheck: (() => void) | undefined;
    api.checkForPrerelease.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.checkButton"),
      ),
    );

    expect(
      buttonNamed(container, tEn("settings.updates.installNow")).disabled,
    ).toBe(false);

    resolveCheck?.();
    await waitForUi();
  });

  it("disables the pre-release Check button while the stable flow is busy", async () => {
    // `checkForPrerelease` bails on main's shared `installing` flag but returns
    // UNCHANGED state with no `success` field, so a live button here is silence.
    await render(
      {
        ...readyState("available"),
        availableVersion: "0.2.0",
        canInstall: true,
      },
      prereleaseReady("idle"),
    );
    let resolveInstall: (() => void) | undefined;
    api.installUpdate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveInstall = resolve;
      }),
    );

    await click(buttonNamed(container, tEn("settings.updates.installNow")));

    const pendingCheck = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(pendingCheck.disabled).toBe(true);
    await click(pendingCheck);
    expect(api.checkForPrerelease).not.toHaveBeenCalled();

    resolveInstall?.();
    await waitForUi();

    // The state event clears `actionPending`, so this is the phase, not the click.
    await act(async () => {
      updateListener?.({
        ...readyState("installing"),
        availableVersion: "0.2.0",
      });
    });
    expect(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.checkButton"),
      ).disabled,
    ).toBe(true);
  });

  it("keeps the pre-release Check button live during a stable CHECK", async () => {
    // A stable check claims `checking`, never `installing`, so a pre-release
    // check pressed here would have succeeded. Freezing on the broad
    // `actionPending` flag reinstates the freeze its exclusion exists to avoid.
    await render(readyState("idle"), prereleaseReady("idle"));
    let resolveCheck: (() => void) | undefined;
    api.checkForUpdates.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    await click(buttonNamed(container, tEn("settings.updates.checkButton")));

    const prereleaseCheck = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(prereleaseCheck.disabled).toBe(false);
    // Not merely enabled: a spinner would claim a check nobody started.
    expect(prereleaseCheck.querySelector("svg")).toBeNull();
    await click(prereleaseCheck);
    expect(api.checkForPrerelease).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await waitForUi();
  });

  it("disables the pre-release Check button while the stable flow is DOWNLOADING", async () => {
    // Phase term alone: main holds `installing` for the whole fetch, outliving
    // any one renderer promise.
    await render(
      {
        ...readyState("downloading"),
        availableVersion: "0.2.0",
        canInstall: true,
        downloadedBytes: 1_000,
        totalBytes: 4_000,
      },
      prereleaseReady("idle"),
    );

    const check = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(check.disabled).toBe(true);
    await click(check);
    expect(api.checkForPrerelease).not.toHaveBeenCalled();
  });

  it("disables the pre-release Check button while a channel op is in flight", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );
    let resolveSwitch: ((result: { success: boolean }) => void) | undefined;
    api.switchToPrerelease.mockReturnValueOnce(
      new Promise<{ success: boolean }>((resolve) => {
        resolveSwitch = resolve;
      }),
    );

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.switchButton"),
      ),
    );

    // A switch claims the same flag, and its confirm leaves this panel clickable.
    const check = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(check.disabled).toBe(true);
    await click(check);
    expect(api.checkForPrerelease).not.toHaveBeenCalled();

    resolveSwitch?.({ success: true });
    await waitForUi();
  });

  it("disables the pre-release Check button once the stable flow reaches restart-required", async () => {
    // The PERMANENT one: `publishRestartRequired` claims main's shared
    // `installing` flag and nothing clears it, so a check refuses invisibly for
    // the rest of the session. Reached on the nominal path too, with
    // `PrereleaseState` still `idle`.
    await render(
      { ...readyState("restart-required"), availableVersion: "0.2.0" },
      prereleaseReady("idle"),
    );

    const check = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(check.disabled).toBe(true);
    // Disabled but NOT spinning: `restart-required` never clears.
    expect(check.querySelector("svg")).toBeNull();
    await click(check);
    expect(api.checkForPrerelease).not.toHaveBeenCalled();
  });

  it("spins the Revert button while the revert it started is in flight", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("idle", { activeChannel: "beta" }),
    );
    let resolveRevert: ((result: { success: boolean }) => void) | undefined;
    api.revertToStable.mockReturnValueOnce(
      new Promise<{ success: boolean }>((resolve) => {
        resolveRevert = resolve;
      }),
    );

    const revert = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.revertButton"),
    );
    expect(revert.querySelector("svg")).toBeNull();

    await click(revert);

    // A revert fetches before anything is published; otherwise it just greys out.
    expect(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ).querySelector("svg"),
    ).not.toBeNull();

    resolveRevert?.({ success: true });
    await waitForUi();
  });

  it("keeps the pre-release Check button shut for the length of its own check", async () => {
    // The section's OWN busy term: the pending flag is cleared the instant main
    // broadcasts `checking`, so the phase alone holds the button shut — and each
    // extra press spends another of 60 unauthenticated GitHub requests an hour.
    await render(readyState("up-to-date"), prereleaseReady("idle"));
    let resolveCheck: ((next: PrereleaseState) => void) | undefined;
    api.checkForPrerelease.mockReturnValueOnce(
      new Promise<PrereleaseState>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.checkButton"),
      ),
    );
    expect(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.checkButton"),
      ).querySelector("svg"),
    ).not.toBeNull();

    await act(async () => {
      prereleaseListener?.(prereleaseReady("checking"));
    });

    const check = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(check.disabled).toBe(true);
    // A spinner that stopped mid-check would read as a check that finished.
    expect(check.querySelector("svg")).not.toBeNull();
    await click(check);
    expect(api.checkForPrerelease).toHaveBeenCalledTimes(1);

    resolveCheck?.(prereleaseReady("up-to-date"));
    await waitForUi();
  });

  it.each([
    [
      "downloading",
      prereleaseReady("downloading", {
        offeredVersion: BETA_VERSION,
        downloadedBytes: 1_000,
        totalBytes: 4_000,
      }),
    ],
    ["installing", prereleaseReady("installing", { offeredVersion: BETA_VERSION })],
  ] satisfies (readonly [string, PrereleaseState])[])(
    "freezes the stable Install button while a channel switch is %s",
    async (_phase, prerelease) => {
      // The half of `isBusy` that `channelActionPending` cannot cover: it lives
      // only while THIS renderer's invoke is outstanding, yet main can be
      // mid-switch from a relaunch or another window — and a press here starts a
      // second brew operation into the first one's download lock.
      await render(
        {
          ...readyState("available"),
          availableVersion: "0.2.0",
          canInstall: true,
        },
        prerelease,
      );

      const install = buttonNamed(container, tEn("settings.updates.installNow"));
      expect(install.disabled).toBe(true);
      await click(install);
      expect(api.installUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      action: "switch",
      prerelease: prereleaseReady("available", {
        offeredVersion: BETA_VERSION,
      }),
      button: "settings.updates.prerelease.switchButton",
      bridge: "switchToPrerelease",
      expected: "settings.updates.prerelease.switchErrorMessage",
    },
    {
      action: "revert",
      prerelease: prereleaseReady("idle", { activeChannel: "beta" }),
      button: "settings.updates.prerelease.revertButton",
      bridge: "revertToStable",
      expected: "settings.updates.prerelease.revertErrorMessage",
    },
  ] as const)(
    "surfaces a broken $action bridge instead of swallowing it",
    async ({ prerelease, button, bridge, expected }) => {
      // `runPrerelease`'s catch. Switch and Revert live on `available`/`idle`,
      // neither of which renders `prereleaseState.message`, so without the catch
      // moving the section to `error` nothing changes on screen. These are also
      // the only paths reaching the component's own bound descriptors.
      await render(readyState("up-to-date"), prerelease);
      api[bridge].mockRejectedValueOnce(new Error("bridge is gone"));

      await click(buttonNamed(prereleaseSection(), tEn(button)));
      await waitForUi();

      expect(
        prereleaseSection().querySelector('[role="alert"]')?.textContent,
      ).toBe(tEn(expected));
    },
  );

  it.each([
    {
      case: "the phase box is showing a different sentence",
      published: msg("settings.updates.prerelease.downloadErrorMessage"),
      reported: msg("settings.updates.prerelease.revertErrorMessage"),
    },
    {
      case: "the phase box is showing the generic fallback with no descriptor",
      published: undefined,
      reported: msg("settings.updates.prerelease.revertErrorMessage"),
    },
    {
      case: "the two sentences share a key but not their params",
      published: msg(
        "settings.updates.prerelease.bothCasksMessage",
        BOTH_CASKS_PARAMS,
      ),
      reported: msg("settings.updates.prerelease.bothCasksMessage", {
        ...BOTH_CASKS_PARAMS,
        betaToken: "fixlang@beta-2",
      }),
    },
  ])(
    "still announces a channel-op failure when $case",
    async ({ published, reported }) => {
      // The MESSAGE half of the ownership rule — `isSameMessage`. Every case
      // above turns on the PHASE half alone, so a bare `return true` passes them
      // while suppressing every notice of a refusal main does not publish.
      await render(
        readyState("up-to-date"),
        prereleaseReady("idle", { activeChannel: "beta" }),
      );
      api.revertToStable.mockImplementationOnce(async () => {
        prereleaseListener?.({
          phase: "error",
          activeChannel: "beta",
          canSwitch: true,
          ...(published === undefined ? {} : { message: published }),
        });
        return { success: false, error: reported };
      });

      await click(
        buttonNamed(
          prereleaseSection(),
          tEn("settings.updates.prerelease.revertButton"),
        ),
      );
      await waitForUi();

      const announced = tEn(reported.key, reported.params);
      const notice = [
        ...prereleaseSection().querySelectorAll('[role="status"]'),
      ].find((node) => node.textContent === announced);
      expect(notice).toBeDefined();
    },
  );

  it("spins the Switch button, and only that button, while its switch is in flight", async () => {
    await render(
      readyState("up-to-date"),
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );
    let resolveSwitch: ((result: { success: boolean }) => void) | undefined;
    api.switchToPrerelease.mockReturnValueOnce(
      new Promise<{ success: boolean }>((resolve) => {
        resolveSwitch = resolve;
      }),
    );

    await click(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.switchButton"),
      ),
    );

    const section = prereleaseSection();
    // A switch waits on main's native confirm; otherwise it just greys out.
    expect(
      buttonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ).querySelector("svg"),
    ).not.toBeNull();
    // Every control shares one disabled flag, so the spinner is what names the
    // control that was pressed.
    expect(
      buttonNamed(
        section,
        tEn("settings.updates.prerelease.checkButton"),
      ).querySelector("svg"),
    ).toBeNull();

    resolveSwitch?.({ success: true });
    await waitForUi();
  });

  it("does not let a late pre-release snapshot overwrite a newer channel event", async () => {
    // "Subscribe before fetch" on the pre-release channel: a reorder leaves the
    // section reading `idle` over a Homebrew run that already started, re-arming
    // Switch and Check.
    let resolveInitial: ((state: PrereleaseState) => void) | undefined;
    const initial = new Promise<PrereleaseState>((resolve) => {
      resolveInitial = resolve;
    });

    await render(readyState("up-to-date"), prereleaseReady("idle"));
    api.getPrereleaseState.mockReturnValueOnce(initial);

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
      prereleaseListener?.(
        prereleaseReady("available", { offeredVersion: BETA_VERSION }),
      );
      resolveInitial?.(prereleaseReady("idle"));
      await initial;
    });

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.available", {
        version: `v${BETA_VERSION}`,
      }),
    );
    expect(section.textContent).not.toContain(
      tEn("settings.updates.prerelease.idleDescription"),
    );
  });

  it("reports a pre-release bridge that fails at mount rather than reading as unsupported", async () => {
    // Without this, a rejecting `getPrereleaseState()` reads as "not available
    // on this install" — indistinguishable from a broken bridge, and no retry.
    unsubscribe = vi.fn();
    await renderWithApi({
      getUpdateState: vi.fn().mockResolvedValue(readyState("up-to-date")),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
      openExternalLink: vi.fn().mockResolvedValue({ success: true }),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return unsubscribe;
      }),
      ...prereleaseBridge(prereleaseReady("idle")),
      getPrereleaseState: vi.fn().mockRejectedValue(new Error("bridge is gone")),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
    });

    const section = prereleaseSection();
    expect(section.querySelector('[role="alert"]')?.textContent).toBe(
      tEn("settings.updates.prerelease.genericError"),
    );
    expect(section.textContent).not.toContain(
      tEn("settings.updates.prerelease.unsupported"),
    );
    expect(container.textContent).toContain(tEn("settings.updates.upToDate"));
  });

  it("unsubscribes from the pre-release channel on unmount", async () => {
    // This also mounts in the About tab: a leftover listener writes into an
    // unmounted tree on every channel-state publish.
    await render(readyState("up-to-date"), prereleaseReady("idle"));

    expect(api.onPrereleaseStateChanged).toHaveBeenCalledTimes(1);
    expect(prereleaseUnsubscribe).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });

    expect(prereleaseUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("leaves the pre-release section unsupported on a preload without the channel bridge", async () => {
    // The compatibility path the effect's early return exists for: an older
    // preload exposes neither method, and this also mounts in the About tab.
    unsubscribe = vi.fn();
    await renderWithApi(
      // An old preload exposes none of `PRERELEASE_BRIDGE_MEMBERS`, so they are
      // absent rather than mocked; the rest need a rendered control to reach.
      legacyPreloadApi({
        getUpdateState: vi.fn().mockResolvedValue(readyState("up-to-date")),
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
      }),
    );

    // The absence IS the fixture: a stray member silently stops covering it.
    for (const member of PRERELEASE_BRIDGE_MEMBERS) {
      expect(member in api).toBe(false);
    }

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.unsupported"),
    );
    for (const label of [
      tEn("settings.updates.prerelease.checkButton"),
      tEn("settings.updates.prerelease.switchButton"),
      tEn("settings.updates.prerelease.revertButton"),
    ] as const) {
      expect(maybeButtonNamed(section, label)).toBeUndefined();
    }
    expect(container.textContent).toContain(tEn("settings.updates.upToDate"));
  });

  it("renders the pre-release section in Japanese, derived from the JA catalog", async () => {
    await renderInLocale(
      "ja",
      readyState("up-to-date"),
      prereleaseReady("available", { offeredVersion: BETA_VERSION }),
    );

    const section = prereleaseSection();
    for (const key of [
      "settings.updates.prerelease.title",
      "settings.updates.prerelease.switchDescription",
      "settings.updates.prerelease.switchButton",
      "settings.updates.prerelease.checkButton",
    ] as const) {
      const jaExpected = tJa(key);
      expect(section.textContent).toContain(jaExpected);
      // A byte-identical "translation" would pass against either catalog.
      expect(jaExpected).not.toBe(tEn(key));
    }

    const availableParams = { version: `v${BETA_VERSION}` };
    expect(section.textContent).toContain(
      tJa("settings.updates.prerelease.available", availableParams),
    );
    expect(
      tJa("settings.updates.prerelease.available", availableParams),
    ).not.toBe(tEn("settings.updates.prerelease.available", availableParams));
    expect(
      buttonNamed(section, tJa("settings.updates.prerelease.switchButton")),
    ).toBeDefined();
  });
});
