import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msg, type Message } from "~/features/i18n/shared/message";
import { createTranslator } from "~/features/i18n/shared/translate";
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

// Mirrors `~/features/update/shared/prerelease`'s `PrereleaseState`, declared
// locally for the same reason `UpdateState` above is: these are the values a
// mocked bridge hands the component, not the component's own imports.
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
  // `SettingUpdates` renders inside `<I18nProvider>`, which reads these off
  // `window.electronAPI` on mount (see `localeState.ts`'s `LocaleBridge`).
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

/**
 * Every member an older preload — one built before the pre-release channel
 * existed — does not expose. Spelled once, `keyof`-checked, and asserted
 * absent by the compatibility test below, so the set can never drift from
 * whatever a prose comment claims it is.
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
 * A bridge that genuinely lacks those members, which no honest type can
 * express for a value the component reads as a full `UpdateApi`. The `Omit`
 * parameter is what keeps the unavoidable cast from suppressing the type
 * checker wholesale: the REMAINING members are still checked, so a typo or a
 * newly-required stable method fails to compile here rather than silently
 * widening what this test pretends an old preload looked like.
 */
const legacyPreloadApi = (
  api: Omit<UpdateApi, PrereleaseBridgeMember>,
): UpdateApi => api as UpdateApi;

const readyState = (phase: UpdateState["phase"] = "idle"): UpdateState => ({
  phase,
  currentVersion: "0.1.0",
});

/** A Homebrew stable install with the pre-release channel available to it. */
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
  let api: UpdateApi;

  /** The pre-release section's own subtree — never the whole panel. */
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
    // `<I18nProvider>` resolves its initial locale via an async `getLocale()`
    // call before rendering children (it renders null until "ready" — see
    // `I18nProvider.tsx` — to avoid an EN -> JA flash), so this needs an extra
    // tick beyond the single `waitForUi()` the update-state fetch itself uses.
    await waitForUi();
    await waitForUi();
  };

  /**
   * The five pre-release bridge methods, captured the same way the stable
   * ones are. Split out so the three call sites below all get a bridge that
   * behaves like the real preload rather than a partial one.
   */
  const prereleaseBridge = (state: PrereleaseState) => ({
    getPrereleaseState: vi.fn().mockResolvedValue(state),
    checkForPrerelease: vi.fn().mockResolvedValue(state),
    switchToPrerelease: vi.fn().mockResolvedValue({ success: true }),
    revertToStable: vi.fn().mockResolvedValue({ success: true }),
    onPrereleaseStateChanged: vi.fn(
      (listener: (next: PrereleaseState) => void) => {
        prereleaseListener = listener;
        return vi.fn();
      },
    ),
  });

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

  it("shows the host a release-notes link actually opens when its label claims another", async () => {
    // Link text and href are INDEPENDENT attacker-controlled inputs in a
    // release body. A label spelling the project's own repository while the
    // href points elsewhere sends the user to an attacker page from the one
    // panel that primes them to download and run a macOS binary.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes:
        "[https://github.com/anhdd-kuro/fix-lang](https://evil.example.com/phish)",
    });

    const link = container.querySelector<HTMLAnchorElement>(
      "a[href='https://evil.example.com/phish']",
    );
    expect(link).not.toBeNull();
    // The visible label must never name a host other than the one a click
    // opens — otherwise the only true statement on screen is the href, which
    // the user cannot see.
    expect(link?.textContent).not.toContain("github.com");
    expect(link?.textContent).toContain("evil.example.com");

    await click(link as Element);
    expect(api.openExternalLink).toHaveBeenCalledWith(
      "https://evil.example.com/phish",
    );
  });

  it("sees through markup wrapped around a mismatched link label", async () => {
    // The label is the attacker's too, so it can be bold, italic or code —
    // which splits it into element children rather than one text node. A
    // check that only understands a bare string is bypassed by two asterisks.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: [
        "[**https://github.com/anhdd-kuro/fix-lang**](https://evil.example.com/bold)",
        "and [//github.com/anhdd-kuro/fix-lang](https://evil.example.com/scheme-relative)",
      ].join(" "),
    });

    const labelOf = (href: string): string | undefined =>
      container.querySelector<HTMLAnchorElement>(`a[href='${href}']`)
        ?.textContent ?? undefined;

    expect(labelOf("https://evil.example.com/bold")).toBe(
      "https://evil.example.com/bold",
    );
    expect(labelOf("https://evil.example.com/scheme-relative")).toBe(
      "https://evil.example.com/scheme-relative",
    );
  });

  it("counts a different path on the same host as a different destination", async () => {
    // github.com is a trusted HOST that anyone can publish a repository and a
    // release binary on, so "same host" is not the same destination.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes:
        "[https://github.com/anhdd-kuro/fix-lang/releases](https://github.com/attacker/fix-lang/releases)",
    });

    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='https://github.com/attacker/fix-lang/releases']",
      )?.textContent,
    ).toBe("https://github.com/attacker/fix-lang/releases");
  });

  it("counts a swapped port as a different destination", async () => {
    // Same hostname, attacker-chosen port: `github.com:8080` is not GitHub.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes:
        "[https://github.com/anhdd-kuro/fix-lang](https://github.com:8080/anhdd-kuro/fix-lang)",
    });

    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='https://github.com:8080/anhdd-kuro/fix-lang']",
      )?.textContent,
    ).toBe("https://github.com:8080/anhdd-kuro/fix-lang");
  });

  it("leaves ordinary release-notes links and autolinks exactly as written", async () => {
    // The common case, and the one a heavy-handed defence would mangle:
    // prose labels, and GFM autolinks whose label IS the href.
    await render({
      ...readyState("available"),
      availableVersion: "0.3.0",
      releaseNotes: [
        "See [the full changelog](https://github.com/anhdd-kuro/fix-lang/releases)",
        "and [README.md](https://github.com/anhdd-kuro/fix-lang/blob/main/README.md),",
        "or https://github.com/anhdd-kuro/fix-lang/pull/12",
        "and [github.com/anhdd-kuro/fix-lang](https://github.com/anhdd-kuro/fix-lang).",
      ].join(" "),
    });

    const labelOf = (href: string): string | undefined =>
      container.querySelector<HTMLAnchorElement>(`a[href='${href}']`)
        ?.textContent ?? undefined;

    expect(labelOf("https://github.com/anhdd-kuro/fix-lang/releases")).toBe(
      "the full changelog",
    );
    expect(
      labelOf("https://github.com/anhdd-kuro/fix-lang/blob/main/README.md"),
    ).toBe("README.md");
    expect(labelOf("https://github.com/anhdd-kuro/fix-lang/pull/12")).toBe(
      "https://github.com/anhdd-kuro/fix-lang/pull/12",
    );
    expect(labelOf("https://github.com/anhdd-kuro/fix-lang")).toBe(
      "github.com/anhdd-kuro/fix-lang",
    );
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
      // Drives the WHOLE production sequence, not just its broadcast half:
      // main publishes the descriptor from inside the handler and returns the
      // same one when the invoke reply resolves. Asserting on a bare
      // broadcast would stay green even if the resolved result overwrote it.
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

    // Prove the locale actually changed (see the loadFailed test above for
    // why both the positive and the "differs from EN" assertion matter).
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      jaExpected,
    );
    expect(jaExpected).not.toBe(enExpected);
  });

  it("keeps main's specific install-failure descriptor instead of the bound generic", async () => {
    // The sequence PRODUCTION always takes, which the locale test above only
    // half-drives: every `installUpdate` failure publishes its own `Message`
    // via `webContents.send` INSIDE the handler and then returns that same
    // descriptor as `{ success: false, error }` when the handler's promise
    // resolves. The send is issued first and both travel the same pipe, so
    // the broadcast lands first and the resolved result lands second — the
    // mock below reproduces exactly that order.
    //
    // Without the fix, `run()`'s call-site-bound `installFailed` overwrites
    // the tap-lag descriptor the whole lagging-tap gate exists to deliver.
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
    // The other half of the rule: a REJECTED request carries no descriptor to
    // prefer, so the call-site-bound generic is all there is — and it must
    // still be shown rather than left blank.
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

  // -------------------------------------------------------------------------
  // Pre-release channel — a second, independent flow rendered below the
  // stable one. Everything below asserts against the RENDERED subtree
  // (`prereleaseSection()`), never against the component's internals: this
  // harness has previously reported green while making zero writes.
  // -------------------------------------------------------------------------

  it("renders the pre-release section below the stable flow, boxed off, with its own check button and result line", async () => {
    await render(readyState("up-to-date"), prereleaseReady("idle"));

    const section = prereleaseSection();
    const stableHeading = container.querySelector("#app-updates-heading");
    expect(stableHeading).not.toBeNull();
    // Below, not merely elsewhere: the stable flow must still be the first
    // thing the user reads in this panel.
    expect(
      (stableHeading as Element).compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Visually distinct: its own bordered, tinted box rather than another
    // paragraph in the stable flow's own run of controls.
    expect(section.className).toContain("border");
    expect(section.className).toContain("rounded");
    expect(section.className).toContain("bg-secondary/40");
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.title"),
    );

    // Its OWN check button — a different control from the stable one, not a
    // second rendering of it.
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

    // Its own result line, inside its own box.
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
    // A pre-release check never reaches the stable API.
    expect(api.checkForPrerelease).toHaveBeenCalledTimes(1);
    expect(api.checkForUpdates).not.toHaveBeenCalled();

    // ...nor does the answer it produces, arriving on the separate broadcast
    // channel, rewrite a word of the section above.
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

    // No dialog is asserted here on purpose: the confirm is a native
    // `dialog.showMessageBox` owned by main, so the renderer's whole
    // contract is "the call was made".
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
    // A declined confirm is a complete no-op in main — nothing published — so
    // the returned descriptor is the only trace the user can be shown.
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
    // The offer survives a decline: the user can still press Switch again.
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.switchButton"),
      ),
    ).toBeDefined();
  });

  it("announces a published channel-op failure once, in the error region only", async () => {
    // The ownership rule: a descriptor main PUBLISHED belongs to the phase
    // box; the notice carries only what main reported back WITHOUT
    // publishing. Every channel-op failure that reaches a `publishPrerelease`
    // also returns the identical `Message`, so setting the notice from it
    // renders one sentence in two live regions — an `alert` and a `status` —
    // and a screen reader announces it twice.
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

  it("keeps the no-confirm Revert button off an unsupported pre-release state", async () => {
    // Revert is the one channel action that deliberately asks nothing, so its
    // arming predicate is the whole gate in front of an uninstall-then-install
    // that launches a detached Homebrew helper and quits the app. Not a
    // combination main publishes today — that is exactly why it must fail safe
    // rather than rely on main never publishing it.
    await render(readyState("up-to-date"), {
      phase: "unsupported",
      activeChannel: "beta",
      canSwitch: true,
    });

    expect(
      maybeButtonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ),
    ).toBeUndefined();
    expect(api.revertToStable).not.toHaveBeenCalled();
  });

  it("still announces a channel-op failure the phase box does not render", async () => {
    // The other half of the ownership rule: suppression is only correct when
    // the published phase ACTUALLY renders the descriptor. `message` is a
    // plain optional field on a flat state, so a phase that carries one
    // without rendering it must not silence the notice too — the sentence
    // would then appear nowhere at all.
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
    // The set the ownership rule above is derived from. Pushed through the
    // LIVE component one phase at a time, so adding a `tm(message)` to a phase
    // — or dropping one — fails here instead of silently desynchronising the
    // suppression rule from what is on screen.
    const messageRenderingPhases = new Set<PrereleaseState["phase"]>([
      "error",
      "installing",
      "restart-required",
    ]);
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
      }).toEqual({ phase, rendered: messageRenderingPhases.has(phase) });
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
    // The explanation is useless unless it names the two tokens and the exact
    // command that removes one of them.
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
    // `switchToPrerelease` refuses unless `activeChannel` is exactly
    // `"stable"`, so a newer beta offered to a beta install has no one-click
    // path — showing the button anyway would only produce a refusal.
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
    // Reverting stays available — it is the way back out of that build.
    expect(
      maybeButtonNamed(
        section,
        tEn("settings.updates.prerelease.revertButton"),
      ),
    ).toBeDefined();
  });

  it("sends a beta install to Revert rather than to a manual DMG install", async () => {
    // `canInstall` is false on a beta install (no stable cask is staged, so
    // `brew upgrade` would refuse the token) — but this user is on Homebrew,
    // and the DMG instructions would send them to replace their own bundle.
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
    // The static "How to update" reference at the bottom keeps its own copy
    // of the quarantine command, so this counts rather than excludes: the
    // offer's own DMG block must not add a second one.
    expect(quarantineCommandCount(container.textContent ?? "")).toBe(1);
    // The route the copy points at has to actually be on screen.
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
    // Main claims its SHARED `installing` flag before awaiting the confirm,
    // and that dialog has no parent window — so this panel stays on screen,
    // still reading `available` / `canInstall: true`, for as long as the
    // dialog is up.
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
    // Without this, `installUpdate()` resolves `{ success: true }`, publishes
    // nothing, and the app quits into a channel switch the stable section
    // never mentioned.
    expect(api.installUpdate).not.toHaveBeenCalled();
    expect(
      buttonNamed(container, tEn("settings.updates.checkButton")).disabled,
    ).toBe(true);

    resolveSwitch?.({ success: true });
    await waitForUi();
  });

  it("keeps the stable Install button live during a pre-release CHECK", async () => {
    // The other half of the rule above: a check never claims main's
    // `installing` flag, so freezing the stable section for one would be a
    // regression of its own.
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
    // The INVERSE of the two rules above, and the one the stable flow cannot
    // signal for itself: `checkForPrerelease` bails on main's shared
    // `installing` flag, and unlike `switchToPrerelease`/`revertToStable` it
    // returns the UNCHANGED `PrereleaseState` with no `success` field — so
    // `runPrerelease`, which only recognises `{ success: false }`, surfaces
    // nothing at all. A live button here round-trips into silence.
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

    // ...and once main publishes the phase, on the phase alone: the state
    // event clears `actionPending`, so this is not the click's own latch.
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
    // The narrow half of the rule above. A stable check claims main's
    // `checking` flag and NEVER `installing`, and `checkForPrerelease` bails
    // only on `installing` — so a pre-release check pressed here would have
    // succeeded outright. Freezing on the shared `actionPending` flag (which
    // `run()` sets for every stable action, check and download included)
    // reintroduces exactly the freeze the excluded `state.phase === "checking"`
    // term exists to avoid: the two windows coincide, because the stable
    // check's promise only resolves once main clears `checking`.
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
    // Not merely enabled: a spinner here would claim a pre-release check is
    // running when none was ever started.
    expect(prereleaseCheck.querySelector("svg")).toBeNull();
    await click(prereleaseCheck);
    expect(api.checkForPrerelease).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await waitForUi();
  });

  it("disables the pre-release Check button while the stable flow is DOWNLOADING", async () => {
    // The phase term on its own, with no stable request in flight: main
    // publishes `downloading` and holds `installing` for the whole fetch,
    // which outlives any one renderer promise. Rendered straight into the
    // phase so nothing but that disjunct can be what shuts the button.
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

    // A switch claims the same `installing` flag the check bails on, and the
    // confirm dialog it awaits leaves this panel clickable behind it.
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
    // The phase the OTHER busy terms all miss, and the only one that is
    // PERMANENT: `publishRestartRequired` sets main's shared `installing`
    // flag and nothing ever clears it, so `checkForPrerelease` refuses for
    // the rest of the session — and refuses by returning the UNCHANGED
    // state with no `success` field, which `runPrerelease` cannot see. A
    // live button here is a control that does nothing at all, forever.
    //
    // Reached on the nominal success path: an ordinary stable in-app update
    // finishes after the app quits, the user reopens, and
    // `reconcileLastInstall` publishes `restart-required` with no channel
    // operation — so `PrereleaseState` is still the constructor's `idle`.
    await render(
      { ...readyState("restart-required"), availableVersion: "0.2.0" },
      prereleaseReady("idle"),
    );

    const check = buttonNamed(
      prereleaseSection(),
      tEn("settings.updates.prerelease.checkButton"),
    );
    expect(check.disabled).toBe(true);
    // Disabled, but NOT spinning: `restart-required` never clears, so a
    // spinner here would claim a pre-release check is running forever.
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

    // A revert fetches from Homebrew before anything is published, so without
    // a spinner the only feedback is a button that went grey.
    expect(
      buttonNamed(
        prereleaseSection(),
        tEn("settings.updates.prerelease.revertButton"),
      ).querySelector("svg"),
    ).not.toBeNull();

    resolveRevert?.({ success: true });
    await waitForUi();
  });

  it("leaves the pre-release section unsupported on a preload without the channel bridge", async () => {
    // The compatibility path the effect's early return exists for: an older
    // preload exposes neither pre-release method, and this component also
    // mounts inside the About tab, where a throwing effect would tear down
    // the user guide alongside it.
    unsubscribe = vi.fn();
    await renderWithApi(
      // The five `PRERELEASE_BRIDGE_MEMBERS` are the point of this test: an
      // old preload exposes none of them, so they are absent rather than
      // mocked. `checkForPrerelease`/`switchToPrerelease`/`revertToStable`
      // are never reachable without a rendered control to press.
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

    // The absence is the fixture, so it is asserted rather than described: a
    // stray member would make the component take the live path and the test
    // would stop covering the compatibility branch at all.
    for (const member of PRERELEASE_BRIDGE_MEMBERS) {
      expect(member in api).toBe(false);
    }

    const section = prereleaseSection();
    expect(section.textContent).toContain(
      tEn("settings.updates.prerelease.unsupported"),
    );
    // Not a half-live section: no control the bridge could not service.
    for (const label of [
      tEn("settings.updates.prerelease.checkButton"),
      tEn("settings.updates.prerelease.switchButton"),
      tEn("settings.updates.prerelease.revertButton"),
    ] as const) {
      expect(maybeButtonNamed(section, label)).toBeUndefined();
    }
    // The stable flow above it is untouched by the missing bridge.
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
      // Proves the JA catalog is actually being read rather than falling
      // back to English — a byte-identical "translation" would pass a
      // contains-check against either catalog.
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
