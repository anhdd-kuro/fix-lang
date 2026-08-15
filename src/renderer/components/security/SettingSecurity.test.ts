/**
 * @file SettingSecurity.test.ts
 * @description Component-level tests for the Settings → Security panel.
 * Renders the real component via `react-dom/client` + `act` (no
 * `@testing-library/react` is installed) — the same technique used in
 * `AutocompletePanel.test.ts`/`LogsPanel.test.ts`.
 *
 * Covers the load/error/ready contract, the two IPC bridges' rejection
 * handling (neither the preload nor the main `get` handler wraps its call in
 * try/catch — this panel is the first live caller of both), the
 * `isBundleIdDenied`-derived chip state, and that a locale switch updates the
 * rendered copy without a stale resolved string sitting in state.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECRET_GUARD_SETTINGS } from "~/features/secretGuard/shared/secretGuardSettings";
import { SettingSecurity } from "./SettingSecurity";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type { Locale } from "~/features/i18n/shared/registry";
import type { ActiveApp } from "~/main/accessibility/activeApp";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/**
 * A manually-resolvable promise, used to control which of the two
 * `handleRestoreDefaults` writes settles first — the whole point of the
 * ordering tests below is that the FINAL status must not depend on that
 * timing, so the timing has to be deliberate rather than left to however
 * `mockResolvedValue` happens to schedule two already-resolved promises.
 */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolveFn!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolveFn = res;
  });
  return { promise, resolve: resolveFn };
};

const defaultGuardSettings = (): SelectionGuardSettings => ({
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
});

describe("SettingSecurity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  const render = async (overrides: Partial<typeof api> = {}) => {
    api = {
      getSelectionGuards: vi.fn().mockResolvedValue(defaultGuardSettings()),
      setSelectionGuards: vi.fn().mockResolvedValue({ success: true }),
      getRecentActiveApps: vi.fn().mockResolvedValue([]),
      getSecretGuardSettings: vi.fn().mockResolvedValue(DEFAULT_SECRET_GUARD_SETTINGS),
      setSecretGuardSettings: vi.fn().mockResolvedValue({ success: true }),
      chooseDeniedApps: vi.fn().mockResolvedValue({ success: true, bundleIds: [] }),
      resolveAppBundleIds: vi.fn().mockResolvedValue({ success: true, bundleIds: [] }),
      getAppBundlePathForFile: vi.fn().mockReturnValue(null),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
      ...overrides,
    };
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(SettingSecurity)));
    });
    await waitForUi();
    await waitForUi();
    await waitForUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    localeListener = undefined;
    vi.restoreAllMocks();
  });

  it("renders the four sections in order once settings resolve", async () => {
    await render();

    const text = container.textContent ?? "";
    const order = [
      "Blocked apps",
      "Stale clipboard",
      "Large selections",
      "Secret guard",
    ].map((title) => text.indexOf(title));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("uses shared Input chrome matching General API key on every text and number field", async () => {
    await render();

    const fields = [
      ...container.querySelectorAll<HTMLInputElement>(
        "input:not([type=checkbox])",
      ),
    ];
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const field of fields) {
      expect(field.className).toContain("bg-secondary");
      expect(field.className).toContain("p-2");
      expect(field.className).toContain("border-control-border");
      expect(field.className).toContain("focus-visible:ring-ring");
      expect(field.className).not.toContain("bg-input");
      expect(field.className).not.toContain("rounded-md");
    }
  });

  it("renders the honest-limitations copy verbatim, not hidden behind a disclosure", async () => {
    await render();

    expect(container.textContent).toContain(
      "This is a pattern check, not a guarantee.",
    );
    expect(container.textContent).toContain("It cannot un-send.");
    expect(container.textContent).toContain(
      "The selection is still copied and restored — it just never reaches a provider.",
    );
    expect(container.textContent).toContain(
      "It stores only a fingerprint and a timestamp — never the text.",
    );
  });

  it("renders an error message instead of throwing when a settings call rejects", async () => {
    await expect(
      render({
        getSecretGuardSettings: vi.fn().mockRejectedValue(new Error("ipc failed")),
      }),
    ).resolves.not.toThrow();
    expect(container.textContent).toContain("Could not load security settings.");
  });

  it("renders an error message instead of throwing when getRecentActiveApps rejects", async () => {
    await expect(
      render({
        getRecentActiveApps: vi.fn().mockRejectedValue(new Error("ipc failed")),
      }),
    ).resolves.not.toThrow();
    expect(container.textContent).toContain("Could not load security settings.");
  });

  it("shows the disabled hint, not the running description, when clipboard age is 0", async () => {
    await render({
      getSelectionGuards: vi
        .fn()
        .mockResolvedValue({ ...defaultGuardSettings(), clipboardMaxAgeSeconds: 0 }),
    });

    expect(container.textContent).toContain(
      "0 disables this guard and stops the background check entirely.",
    );
  });

  it("flags a recently-used app chip as blocked via isBundleIdDenied, case/whitespace-insensitively", async () => {
    const recentApps: ActiveApp[] = [
      { name: "1Password", bundleId: " Com.1Password.1Password " },
      { name: "Slack", bundleId: "com.slack.slack" },
    ];
    await render({ getRecentActiveApps: vi.fn().mockResolvedValue(recentApps) });

    const onePasswordChip = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "1Password",
    );
    const slackChip = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Slack",
    );
    expect(onePasswordChip?.getAttribute("aria-pressed")).toBe("true");
    expect(slackChip?.getAttribute("aria-pressed")).toBe("false");
  });

  it("persists adding a recently-used app to the deny list on chip click", async () => {
    const recentApps: ActiveApp[] = [{ name: "Figma", bundleId: "com.figma.Desktop" }];
    await render({ getRecentActiveApps: vi.fn().mockResolvedValue(recentApps) });

    const figmaChip = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Figma",
    );
    if (!figmaChip) throw new Error("Expected the Figma chip");

    await act(async () => {
      figmaChip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    expect(api.setSelectionGuards).toHaveBeenCalledWith({
      ...defaultGuardSettings(),
      deniedBundleIds: ["com.1password.1password", "com.figma.desktop"],
    });
  });

  it("persists removing an already-denied app from a blocked-list row", async () => {
    await render();

    const removeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove com.1password.1password from the blocked list"]',
    );
    if (!removeButton) throw new Error("Expected the remove-from-deny-list button");

    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    expect(api.setSelectionGuards).toHaveBeenCalledWith({
      ...defaultGuardSettings(),
      deniedBundleIds: [],
    });
  });

  it("shows a save-error status without throwing when persisting rejects", async () => {
    await render({ setSelectionGuards: vi.fn().mockRejectedValue(new Error("boom")) });

    const removeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove com.1password.1password from the blocked list"]',
    );
    if (!removeButton) throw new Error("Expected the remove-from-deny-list button");

    await expect(
      act(async () => {
        removeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }),
    ).resolves.not.toThrow();
    await waitForUi();

    expect(container.textContent).toContain("Couldn't save security settings.");
  });

  it("shows a save-error status without throwing when persisting the secret-guard settings rejects", async () => {
    await render({ setSecretGuardSettings: vi.fn().mockRejectedValue(new Error("boom")) });

    const maskButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Mask and restore",
    );
    if (!maskButton) throw new Error("Expected the mask mode option");

    await expect(
      act(async () => {
        maskButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }),
    ).resolves.not.toThrow();
    await waitForUi();

    expect(container.textContent).toContain("Couldn't save security settings.");
  });

  it("shows the mask hint only in mask mode", async () => {
    await render({
      getSecretGuardSettings: vi
        .fn()
        .mockResolvedValue({ mode: "mask", highEntropyRule: false }),
    });

    expect(container.textContent).toContain(
      "Masking replaces the values it recognizes before your text is sent. A secret it doesn't recognize is sent just as it would be with the guard off, and a value it can't cover completely asks you first instead.",
    );
    // The retired claim, pinned as a NEGATIVE: both halves of it were false in
    // the shipped UI — unrecognized secrets are sent unchanged, and a
    // `maskable: false` span downgrades the whole request to the dialog. A
    // revert has to fail here rather than read fine.
    expect(container.textContent).not.toContain("nothing is sent");
  });

  it("restores both stores to their defaults", async () => {
    await render({
      getSelectionGuards: vi.fn().mockResolvedValue({
        clipboardMaxAgeSeconds: 0,
        maxSelectionChars: 0,
        deniedBundleIds: [],
      }),
      getSecretGuardSettings: vi
        .fn()
        .mockResolvedValue({ mode: "off", highEntropyRule: true }),
    });

    const restoreButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore defaults",
    );
    if (!restoreButton) throw new Error("Expected the Restore defaults button");

    await act(async () => {
      restoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    expect(api.setSelectionGuards).toHaveBeenCalledWith({
      clipboardMaxAgeSeconds: 5,
      maxSelectionChars: 20_000,
      deniedBundleIds: [
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.apple.keychainaccess",
      ],
    });
    expect(api.setSecretGuardSettings).toHaveBeenCalledWith({
      mode: "confirm",
      highEntropyRule: false,
    });
  });

  it("reports a partial-restore failure, not \"Saved.\", when the guard write fails and the secret write succeeds shortly after", async () => {
    const guardCall = deferred<{ success: boolean }>();
    const secretCall = deferred<{ success: boolean }>();
    await render({
      setSelectionGuards: vi.fn(() => guardCall.promise),
      setSecretGuardSettings: vi.fn(() => secretCall.promise),
    });

    const restoreButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore defaults",
    );
    if (!restoreButton) throw new Error("Expected the Restore defaults button");

    await act(async () => {
      restoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    // The guard write fails first...
    await act(async () => {
      guardCall.resolve({ success: false });
    });
    await waitForUi();
    await waitForUi();

    // ...and the secret write succeeds shortly after, arriving second.
    await act(async () => {
      secretCall.resolve({ success: true });
    });
    await waitForUi();
    await waitForUi();

    expect(container.textContent).not.toContain("Saved.");
    expect(container.textContent).toContain(
      "the blocked apps, clipboard age and selection size settings failed to save and were left unchanged",
    );
  });

  it("reports a partial-restore failure, not \"Saved.\", when the secret write fails and the guard write succeeds shortly after", async () => {
    const guardCall = deferred<{ success: boolean }>();
    const secretCall = deferred<{ success: boolean }>();
    await render({
      setSelectionGuards: vi.fn(() => guardCall.promise),
      setSecretGuardSettings: vi.fn(() => secretCall.promise),
    });

    const restoreButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore defaults",
    );
    if (!restoreButton) throw new Error("Expected the Restore defaults button");

    await act(async () => {
      restoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    // The secret write fails first...
    await act(async () => {
      secretCall.resolve({ success: false });
    });
    await waitForUi();
    await waitForUi();

    // ...and the guard write succeeds shortly after, arriving second.
    await act(async () => {
      guardCall.resolve({ success: true });
    });
    await waitForUi();
    await waitForUi();

    expect(container.textContent).not.toContain("Saved.");
    expect(container.textContent).toContain(
      "the secret guard settings failed to save and were left unchanged",
    );
  });

  /** Fires the click WITHOUT flushing, so a still-pending handler stays pending. */
  const clickButtonLabelledSync = (label: string): void => {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`Expected a "${label}" button`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  const clickButtonLabelled = async (label: string): Promise<void> => {
    await act(async () => {
      clickButtonLabelledSync(label);
    });
    await waitForUi();
    await waitForUi();
  };

  /** A drop carrying `files`, which jsdom's `Event` does not model on its own. */
  const dropFilesOnBlockedApps = async (files: readonly unknown[]): Promise<void> => {
    const section = container.querySelector("section");
    if (!section) throw new Error("Expected the blocked-apps section");
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { files } });
    await act(async () => {
      section.dispatchEvent(dropEvent);
    });
    await waitForUi();
    await waitForUi();
  };

  it("adds the bundle ids picked in the native app chooser", async () => {
    await render({
      chooseDeniedApps: vi
        .fn()
        .mockResolvedValue({ success: true, bundleIds: ["com.tinyspeck.slackmacgap"] }),
    });

    await clickButtonLabelled("Choose app…");

    expect(api.chooseDeniedApps).toHaveBeenCalled();
    expect(api.setSelectionGuards).toHaveBeenCalledWith({
      ...defaultGuardSettings(),
      deniedBundleIds: ["com.1password.1password", "com.tinyspeck.slackmacgap"],
    });
  });

  // Cancelling the dialog is a success with no ids: nothing to write, and
  // nothing to tell the user about.
  it("writes nothing when the app chooser is cancelled", async () => {
    await render();

    await clickButtonLabelled("Choose app…");

    expect(api.setSelectionGuards).not.toHaveBeenCalled();
  });

  /**
   * Every deny-list write replaces the WHOLE settings object, and both
   * app-picking paths are async. Two overlapping resolutions that each build
   * on the settings captured at their own render would make the later write
   * erase the earlier one's app — the user blocks two apps and ends up with
   * one, with a "Saved." flash claiming otherwise. The second write must
   * therefore carry BOTH ids.
   */
  it("merges a second app resolution onto the first instead of erasing it", async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    const chooseDeniedApps = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ success: true, bundleIds: ["com.figma.Desktop"] });

    await render({ chooseDeniedApps });

    // First pick is still in flight when the second one starts and settles.
    await act(async () => {
      clickButtonLabelledSync("Choose app…");
    });
    await clickButtonLabelled("Choose app…");
    await act(async () => {
      resolveFirst?.({ success: true, bundleIds: ["com.tinyspeck.slackmacgap"] });
    });
    await waitForUi();

    const written = api.setSelectionGuards.mock.calls.at(-1)?.[0] as SelectionGuardSettings;
    expect(written.deniedBundleIds).toContain("com.figma.desktop");
    expect(written.deniedBundleIds).toContain("com.tinyspeck.slackmacgap");
  });

  it("reports the failure from main instead of silently adding nothing", async () => {
    await render({
      chooseDeniedApps: vi.fn().mockResolvedValue({
        success: false,
        error: { kind: "message", message: { key: "security.deniedApps.dropError" } },
      }),
    });

    await clickButtonLabelled("Choose app…");

    expect(api.setSelectionGuards).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Couldn't read the bundle ID of that app.");
  });

  it("resolves dropped .app bundles through main and blocks them", async () => {
    await render({
      getAppBundlePathForFile: vi.fn().mockReturnValue("/Applications/Slack.app"),
      resolveAppBundleIds: vi
        .fn()
        .mockResolvedValue({ success: true, bundleIds: ["com.tinyspeck.slackmacgap"] }),
    });

    await dropFilesOnBlockedApps([{}]);

    expect(api.resolveAppBundleIds).toHaveBeenCalledWith(["/Applications/Slack.app"]);
    expect(api.setSelectionGuards).toHaveBeenCalledWith({
      ...defaultGuardSettings(),
      deniedBundleIds: ["com.1password.1password", "com.tinyspeck.slackmacgap"],
    });
  });

  /**
   * `File.path` is gone in Electron 43, so a path the preload bridge cannot
   * resolve to an `.app` yields `null`. Dropping a document must SAY so —
   * "nothing happened" is indistinguishable from a broken feature.
   */
  it("tells the user when a drop carried no .app bundle, instead of doing nothing", async () => {
    await render();

    await dropFilesOnBlockedApps([{}]);

    expect(api.resolveAppBundleIds).not.toHaveBeenCalled();
    expect(api.setSelectionGuards).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only .app bundles can be added this way.");
  });

  /**
   * A drop is all-or-nothing, matching `resolveAppBundleIds` in main. Blocking
   * only the resolvable half and reporting success would hide that something
   * was ignored — and the item that vanished could be the app the user meant
   * to block, which they would discover only by not being protected by it.
   */
  it("refuses the whole drop when one item is not an .app, rather than blocking the rest", async () => {
    await render({
      getAppBundlePathForFile: vi
        .fn()
        .mockReturnValueOnce("/Applications/Slack.app")
        .mockReturnValueOnce(null),
    });

    await dropFilesOnBlockedApps([{}, {}]);

    expect(api.resolveAppBundleIds).not.toHaveBeenCalled();
    expect(api.setSelectionGuards).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only .app bundles can be added this way.");
  });

  /**
   * Each write optimistically installs its own `next`. An OLDER write that
   * fails after a NEWER one succeeded must not rewind to its own pre-state:
   * that would leave the panel showing S0 while the store holds B, and the
   * next edit — built from the rewound state — would overwrite B for real.
   * No response reordering is needed to reach this; W1 simply loses.
   */
  it("does not let a superseded failed write roll back a newer successful one", async () => {
    const firstWrite = deferred<{ success: boolean }>();
    const setSelectionGuards = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({ success: true });

    await render({
      setSelectionGuards,
      // Must actually add something, or W1 makes no write and the deferred
      // promise would be consumed by W2 instead.
      chooseDeniedApps: vi
        .fn()
        .mockResolvedValue({ success: true, bundleIds: ["com.tinyspeck.slackmacgap"] }),
    });

    // W1: block an app via the chooser. Left in flight.
    await act(async () => {
      clickButtonLabelledSync("Choose app…");
    });

    // W2: a newer write that succeeds — remove the pre-existing denied app.
    const removeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove com.1password.1password from the blocked list"]',
    );
    if (!removeButton) throw new Error("Expected the remove-from-deny-list button");
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();

    // Only now does the older write fail.
    await act(async () => {
      firstWrite.resolve({ success: false });
    });
    await waitForUi();

    // The removal stuck in the store, so it must still be gone from the panel.
    // An unguarded rollback would resurrect the chip here.
    expect(
      container.querySelector(
        '[aria-label="Remove com.1password.1password from the blocked list"]',
      ),
    ).toBeNull();
  });

  /**
   * The capacity warning may only stand if the partial write actually landed.
   * Reporting solely "these did not fit" after a failed write would leave the
   * user believing the ones that DID fit were saved.
   */
  it("reports the write failure, not just the overflow, when a partial add fails", async () => {
    const full = Array.from({ length: 199 }, (_unused, index) => `com.example.app${String(index)}`);
    await render({
      getSelectionGuards: vi
        .fn()
        .mockResolvedValue({ ...defaultGuardSettings(), deniedBundleIds: full }),
      setSelectionGuards: vi.fn().mockResolvedValue({ success: false }),
      chooseDeniedApps: vi.fn().mockResolvedValue({
        success: true,
        bundleIds: ["com.tinyspeck.slackmacgap", "com.figma.desktop"],
      }),
    });

    await clickButtonLabelled("Choose app…");

    expect(container.textContent).toContain("Couldn't save");
  });

  /**
   * `withDeniedBundleId` returning the same reference at the cap made every
   * single-id add look like a generic no-op: the control stayed enabled and
   * nothing was said, so Add and the recent-app chips appeared broken.
   */
  it("explains the limit when a typed add cannot fit", async () => {
    const full = Array.from({ length: 200 }, (_unused, index) => `com.example.app${String(index)}`);
    await render({
      getSelectionGuards: vi
        .fn()
        .mockResolvedValue({ ...defaultGuardSettings(), deniedBundleIds: full }),
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Block an app"]',
    );
    if (!input) throw new Error("Expected the bundle-id input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "com.tinyspeck.slackmacgap");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButtonLabelled("Block an app");

    expect(api.setSelectionGuards).not.toHaveBeenCalled();
    // The exact sentence, not just "full" — the limitations copy below also
    // contains the word "full", which would match no matter what happened.
    expect(container.textContent).toContain("The blocked-apps list is full at 200");
    // The rejected id stays in the field rather than vanishing.
    expect(input.value).toBe("com.tinyspeck.slackmacgap");
  });

  it("sizes the secret-guard mode switch to its options rather than the panel width", async () => {
    await render();

    const modeSwitch = container.querySelector('[role="group"][aria-label="Mode"]');
    expect(modeSwitch?.className).toContain("self-start");
  });

  it("renders the limitations as separate points, not one paragraph", async () => {
    await render();

    const points = [...container.querySelectorAll("li")].map((item) => item.textContent);
    expect(points).toContain("It cannot un-send. Text you send is saved to your local history on this machine, including when you choose Send anyway.");
    expect(points.length).toBeGreaterThanOrEqual(5);
  });

  it("survives a language switch — no resolved string frozen into state", async () => {
    await render();
    expect(container.textContent).toContain("Stale clipboard");

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(container.textContent).toContain("古いクリップボード");
  });

  it("keeps a later partial-restore failure on screen once an earlier flash's untracked timer would have fired", async () => {
    vi.useFakeTimers();
    try {
      await render({
        setSecretGuardSettings: vi.fn().mockResolvedValue({ success: false }),
      });

      const removeButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Remove com.1password.1password from the blocked list"]',
      );
      if (!removeButton) throw new Error("Expected the remove-from-deny-list button");

      // Change one field: flashes "Saved." and starts a 2s timer.
      await act(async () => {
        removeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForUi();
      await waitForUi();
      expect(container.textContent).toContain("Saved.");

      // Within that 2s window, Restore Defaults fires and one half fails.
      const restoreButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Restore defaults",
      );
      if (!restoreButton) throw new Error("Expected the Restore defaults button");

      await act(async () => {
        restoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForUi();
      await waitForUi();
      await waitForUi();
      await waitForUi();
      expect(container.textContent).toContain(
        "the secret guard settings failed to save and were left unchanged",
      );

      // Advance past the EARLIER flash's timer window.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await waitForUi();

      expect(container.textContent).not.toContain("Saved.");
      expect(container.textContent).toContain(
        "the secret guard settings failed to save and were left unchanged",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the pending flash timeout on unmount instead of leaving it to fire against a gone component", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    await render();

    const removeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove com.1password.1password from the blocked list"]',
    );
    if (!removeButton) throw new Error("Expected the remove-from-deny-list button");

    // Starts the flash timeout; the panel unmounts before it would fire.
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForUi();
    expect(container.textContent).toContain("Saved.");

    const flashTimeoutId = setTimeoutSpy.mock.results.at(-1)?.value;
    expect(flashTimeoutId).toBeDefined();

    await act(async () => {
      root.unmount();
    });

    expect(clearTimeoutSpy).toHaveBeenCalledWith(flashTimeoutId);

    // A fresh, never-rendered root so the shared afterEach's unmount call
    // stays a no-op instead of double-unmounting the one above.
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
});
