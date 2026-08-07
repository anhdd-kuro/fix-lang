/**
 * @file askInputWindow.test.ts
 * @description Verifies the Ask AI input popup: a creation-cached singleton
 * (same shape as `correctionResultWindow.ts`) that prevents the static
 * `<title>` from clobbering the locale-aware window title, and forwards
 * `ask-input-submit` / `ask-input-cancel` to the caller-supplied handlers, and
 * tells the renderer about EVERY dismissal path rather than only the one that
 * originated there (02/f17).
 * Electron is mocked exactly as `correctionResultWindow.test.ts:44-58` does —
 * this never boots a real window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const windowTitlesMocks = vi.hoisted(() => ({
  buildAskInputWindowTitle: vi.fn(() => "Ask AI"),
}));

vi.mock("./windowTitles", () => ({
  buildAskInputWindowTitle: windowTitlesMocks.buildAskInputWindowTitle,
}));

vi.mock("./attachThemeSync", () => ({
  attachThemeSync: vi.fn(),
}));

const autocompleteServiceMocks = vi.hoisted(() => ({
  abortAutocomplete: vi.fn(),
}));

vi.mock("~/features/autocomplete/main/service", () => ({
  abortAutocomplete: autocompleteServiceMocks.abortAutocomplete,
}));

// A fixed, distinguishable id so assertions can pin the exact string
// `dismissAskInputWindow` must pass to `abortAutocomplete` — the same
// `String(webContents.id)` shape `autocomplete-suggest`'s handler derives
// from `event.sender.id`.
const WEB_CONTENTS_ID = 7;

class BrowserWindowMock {
  setTitle = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  isDestroyed = vi.fn(() => false);
  destroy = vi.fn();
  removeAllListeners = vi.fn();
  on = vi.fn();
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  loadFile = vi.fn();
  setPosition = vi.fn();
  webContents = { id: WEB_CONTENTS_ID, send: vi.fn(), on: vi.fn() };
}

let lastWindow: BrowserWindowMock | null = null;

const electronMocks = vi.hoisted(() => ({
  ipcMainOn: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(function BrowserWindowCtor() {
    lastWindow = new BrowserWindowMock();
    return lastWindow;
  }),
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  ipcMain: { on: electronMocks.ipcMainOn, handle: vi.fn() },
  app: { getAppPath: vi.fn(() => "/app"), on: vi.fn() },
}));

const PAYLOAD = { presetId: "ask", context: "selected text" };

const loadModule = async () => {
  vi.resetModules();
  return import("./askInputWindow");
};

const getIpcHandler = (channel: string) => {
  const call = electronMocks.ipcMainOn.mock.calls.find(
    ([name]) => name === channel,
  );
  if (!call) throw new Error(`no ipcMain.on handler for "${channel}"`);
  return call[1] as (event: unknown, arg?: unknown) => void;
};

describe("askInputWindow", () => {
  beforeEach(() => {
    lastWindow = null;
    vi.clearAllMocks();
  });

  it("does nothing when syncing locale before any window has been created", async () => {
    const { syncAskInputWindowLocale } = await loadModule();

    expect(() => syncAskInputWindowLocale()).not.toThrow();
  });

  it("retitles an already-open window to the freshly-built locale title", async () => {
    const { showAskInputWindow, syncAskInputWindowLocale } = await loadModule();
    showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
    windowTitlesMocks.buildAskInputWindowTitle.mockReturnValue("AIに質問");

    syncAskInputWindowLocale();

    expect(lastWindow?.setTitle).toHaveBeenCalledWith("AIに質問");
  });

  it("does not retitle a destroyed window", async () => {
    const { showAskInputWindow, syncAskInputWindowLocale } = await loadModule();
    showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
    lastWindow?.isDestroyed.mockReturnValue(true);

    syncAskInputWindowLocale();

    expect(lastWindow?.setTitle).not.toHaveBeenCalled();
  });

  it("prevents index.html's static <title> from overriding the localized window title", async () => {
    const { showAskInputWindow } = await loadModule();
    showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

    const pageTitleUpdatedCall = lastWindow?.on.mock.calls.find(
      ([eventName]) => eventName === "page-title-updated",
    );
    expect(pageTitleUpdatedCall).toBeDefined();

    const preventDefault = vi.fn();
    pageTitleUpdatedCall?.[1]({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("forwards a submitted question to onSubmit and hides the window", async () => {
    const { showAskInputWindow } = await loadModule();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit, onCancel });

    getIpcHandler("ask-input-submit")(undefined, "What is a monad?");

    expect(onSubmit).toHaveBeenCalledWith("What is a monad?");
    expect(onCancel).not.toHaveBeenCalled();
    expect(lastWindow?.hide).toHaveBeenCalled();
  });

  it("ignores a non-string submit payload and does not call onSubmit", async () => {
    const { showAskInputWindow } = await loadModule();
    const onSubmit = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit, onCancel: vi.fn() });

    getIpcHandler("ask-input-submit")(undefined, 42);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("forwards cancel to onCancel and hides the window", async () => {
    const { showAskInputWindow } = await loadModule();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit, onCancel });

    getIpcHandler("ask-input-cancel")(undefined);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastWindow?.hide).toHaveBeenCalled();
  });

  it("treats a chrome dismissal (Cmd-W / red X) the same as cancel: runs onCancel and hides", async () => {
    const { showAskInputWindow } = await loadModule();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit, onCancel });

    const closeCall = lastWindow?.on.mock.calls.find(
      ([eventName]) => eventName === "close",
    );
    expect(closeCall).toBeDefined();
    const preventDefault = vi.fn();
    closeCall?.[1]({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastWindow?.hide).toHaveBeenCalled();
  });

  it("does not double-fire onCancel when a chrome close follows an ask-input-cancel", async () => {
    const { showAskInputWindow } = await loadModule();
    const onCancel = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel });

    getIpcHandler("ask-input-cancel")(undefined);
    expect(onCancel).toHaveBeenCalledOnce();

    const closeCall = lastWindow?.on.mock.calls.find(
      ([eventName]) => eventName === "close",
    );
    closeCall?.[1]({ preventDefault: vi.fn() });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // 02/f17. Only ESC originates in the renderer. Cmd-W, the red X and a profile
  // switch all land here, and a window that is hidden rather than destroyed
  // keeps whatever it was showing — so without this signal the next open shows
  // the abandoned question and its ghost suggestion for a frame, because
  // `revealWindow` shows the window right after pushing the fresh payload.
  describe("telling the renderer the ask was abandoned (02/f17)", () => {
    const dismissedSends = () =>
      lastWindow?.webContents.send.mock.calls.filter(
        ([channel]) => channel === "ask-input-dismissed",
      ) ?? [];

    it("sends ask-input-dismissed on a chrome dismissal (Cmd-W / red X)", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      const closeCall = lastWindow?.on.mock.calls.find(
        ([eventName]) => eventName === "close",
      );
      closeCall?.[1]({ preventDefault: vi.fn() });

      expect(dismissedSends()).toHaveLength(1);
    });

    it("sends ask-input-dismissed on ask-input-cancel (ESC)", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      getIpcHandler("ask-input-cancel")(undefined);

      expect(dismissedSends()).toHaveLength(1);
    });

    it("sends ask-input-dismissed when a profile switch dismisses a pending ask", async () => {
      const { showAskInputWindow, dismissAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      dismissAskInputWindow();

      expect(dismissedSends()).toHaveLength(1);
    });

    it("does not send to a destroyed window", async () => {
      const { showAskInputWindow, dismissAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      lastWindow?.isDestroyed.mockReturnValue(true);

      expect(() => dismissAskInputWindow()).not.toThrow();
      expect(dismissedSends()).toHaveLength(0);
    });
  });

  // A dismissed Ask input must stop billing an autocomplete request the user
  // will never see, not just tell the renderer it is gone. Every dismissal
  // route goes through `dismissAskInputWindow`, so each one is covered here.
  describe("aborting an in-flight autocomplete request on dismissal", () => {
    it("aborts this window's session on a chrome dismissal (Cmd-W / red X)", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      const closeCall = lastWindow?.on.mock.calls.find(
        ([eventName]) => eventName === "close",
      );
      closeCall?.[1]({ preventDefault: vi.fn() });

      expect(autocompleteServiceMocks.abortAutocomplete).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("aborts this window's session on ask-input-cancel (ESC)", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      getIpcHandler("ask-input-cancel")(undefined);

      expect(autocompleteServiceMocks.abortAutocomplete).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("aborts this window's session when a profile switch dismisses a pending ask", async () => {
      const { showAskInputWindow, dismissAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      dismissAskInputWindow();

      expect(autocompleteServiceMocks.abortAutocomplete).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("does not abort when dismissing a destroyed window", async () => {
      const { showAskInputWindow, dismissAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      lastWindow?.isDestroyed.mockReturnValue(true);

      expect(() => dismissAskInputWindow()).not.toThrow();
      expect(autocompleteServiceMocks.abortAutocomplete).not.toHaveBeenCalled();
    });

    it("does not throw dismissing with no window ever created", async () => {
      const { dismissAskInputWindow } = await loadModule();

      expect(() => dismissAskInputWindow()).not.toThrow();
      expect(autocompleteServiceMocks.abortAutocomplete).not.toHaveBeenCalled();
    });
  });

  // Same leak, sibling path: submitting ends the ghost-text request for the
  // OLD prefix just as surely as a dismissal does — the renderer's
  // `clearGhost()` on submit only ignores a late reply locally, it cannot
  // reach a request already dispatched from the main process.
  describe("aborting an in-flight autocomplete request on submit", () => {
    it("aborts this window's session on a submitted question", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      getIpcHandler("ask-input-submit")(undefined, "What is a monad?");

      expect(autocompleteServiceMocks.abortAutocomplete).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("aborts this window's session even when the submit payload is rejected as non-string", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      getIpcHandler("ask-input-submit")(undefined, 42);

      expect(autocompleteServiceMocks.abortAutocomplete).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("does not abort when submitting against a destroyed window", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      lastWindow?.isDestroyed.mockReturnValue(true);

      expect(() =>
        getIpcHandler("ask-input-submit")(undefined, "question"),
      ).not.toThrow();
      expect(autocompleteServiceMocks.abortAutocomplete).not.toHaveBeenCalled();
    });
  });

  it("clears handlers on a chrome dismissal so a later invocation's handlers are not dropped", async () => {
    const { showAskInputWindow } = await loadModule();
    const onSubmitA = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit: onSubmitA, onCancel: vi.fn() });

    const closeCall = lastWindow?.on.mock.calls.find(
      ([eventName]) => eventName === "close",
    );
    closeCall?.[1]({ preventDefault: vi.fn() });

    const onSubmitB = vi.fn();
    showAskInputWindow(PAYLOAD, { onSubmit: onSubmitB, onCancel: vi.fn() });
    getIpcHandler("ask-input-submit")(undefined, "question B");

    expect(onSubmitB).toHaveBeenCalledWith("question B");
    expect(onSubmitA).not.toHaveBeenCalled();
  });
});
