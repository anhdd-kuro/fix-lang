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
  rememberAskSession: vi.fn(),
  forgetAskSession: vi.fn(),
}));

vi.mock("~/features/autocomplete/main/service", () => ({
  abortAutocomplete: autocompleteServiceMocks.abortAutocomplete,
  rememberAskSession: autocompleteServiceMocks.rememberAskSession,
  forgetAskSession: autocompleteServiceMocks.forgetAskSession,
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
  setSize = vi.fn();
  webContents = { id: WEB_CONTENTS_ID, send: vi.fn(), on: vi.fn() };
}

let lastWindow: BrowserWindowMock | null = null;

const electronMocks = vi.hoisted(() => ({
  ipcMainOn: vi.fn(),
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(function BrowserWindowCtor() {
    lastWindow = new BrowserWindowMock();
    return lastWindow;
  }),
  screen: {
    getCursorScreenPoint: electronMocks.getCursorScreenPoint,
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  ipcMain: { on: electronMocks.ipcMainOn, handle: vi.fn() },
  app: { getAppPath: vi.fn(() => "/app"), on: vi.fn() },
}));

const WINDOW_WIDTH = 620;
// Framed heights, mirroring `askInputWindow.ts`. Repeated rather than imported
// so a silent edit there has to be acknowledged here too.
const WINDOW_HEIGHT = 380;

const PAYLOAD = { presetId: "ask", context: "selected text" };
const PAYLOAD_WITHOUT_CONTEXT = { presetId: "ask", context: "" };

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
    electronMocks.getCursorScreenPoint.mockReturnValue({ x: 100, y: 100 });
  });

  // The context card is a fixed 200px block the page either carries or does
  // not, so the window is one of two heights rather than one height with slack
  // in it. Both are FRAMED sizes — no `useContentSize` — and macOS takes its
  // 32px title bar out of each, which is what the renderer's height budget is
  // written against.
  describe("sizing the window to whether a context is attached", () => {
    it("opens tall enough for the context card when the payload carries one", async () => {
      const { showAskInputWindow } = await loadModule();

      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      expect(lastWindow?.setSize).toHaveBeenCalledWith(
        WINDOW_WIDTH,
        WINDOW_HEIGHT,
      );
    });

    it("opens at the shorter height when nothing was selected", async () => {
      const { showAskInputWindow } = await loadModule();

      showAskInputWindow(PAYLOAD_WITHOUT_CONTEXT, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(lastWindow?.setSize).toHaveBeenCalledWith(
        WINDOW_WIDTH,
        WINDOW_HEIGHT,
      );
    });

    it("resizes a reused window back down when the next ask has no context", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      showAskInputWindow(PAYLOAD_WITHOUT_CONTEXT, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(lastWindow?.setSize).toHaveBeenLastCalledWith(
        WINDOW_WIDTH,
        WINDOW_HEIGHT,
      );
    });

    it("constructs the window at the shorter height and refuses to be dragged below it", async () => {
      const { showAskInputWindow } = await loadModule();
      const { BrowserWindow } = await import("electron");

      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          width: WINDOW_WIDTH,
          height: WINDOW_HEIGHT,
          minHeight: WINDOW_HEIGHT,
        }),
      );
    });

    // The clamp must be handed the height actually in use. Fed a constant, the
    // tall window is positioned as if it were the short one and runs off the
    // bottom of the screen — so the cursor sits low enough here that the two
    // heights produce different answers.
    it("clamps the tall window against its own height, not the short one", async () => {
      const { showAskInputWindow } = await loadModule();
      electronMocks.getCursorScreenPoint.mockReturnValue({ x: 100, y: 1000 });

      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      expect(lastWindow?.setPosition).toHaveBeenCalledWith(
        116,
        1080 - WINDOW_HEIGHT,
        false,
      );
    });

    it("clamps the short window against the short height", async () => {
      const { showAskInputWindow } = await loadModule();
      electronMocks.getCursorScreenPoint.mockReturnValue({ x: 100, y: 1000 });

      showAskInputWindow(PAYLOAD_WITHOUT_CONTEXT, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(lastWindow?.setPosition).toHaveBeenCalledWith(
        116,
        1080 - WINDOW_HEIGHT,
        false,
      );
    });
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

  /**
   * THE ATTACHED CONTEXT HANDED TO AUTOCOMPLETE, and its lifetime.
   *
   * The passage travels main-side — keyed by this window's `webContents.id`, the
   * same string `autocomplete-suggest` derives its `sessionId` from — because a
   * context field on the wire request would be renderer-controlled text going
   * into a provider prompt. So the two things that can go wrong here are both
   * about lifetime: a passage that never arrives, and a passage that outlives its
   * ask. The second is the dangerous one, because there is nothing on screen to
   * show it: the ghost text would be reading the PREVIOUS question's selection.
   */
  describe("handing the attached context to autocomplete", () => {
    it("records the payload's context against this window's session id", async () => {
      const { showAskInputWindow } = await loadModule();

      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
        { context: { text: "selected text", source: "selection" } },
      );
    });

    // `AskContextSource`'s own documented reading — and it must match the label
    // the renderer's card shows, or the prompt would describe the passage
    // differently from the window the user is looking at.
    it("carries a clipboard-sourced context as such, and defaults an absent source to selection", async () => {
      const { showAskInputWindow } = await loadModule();

      showAskInputWindow(
        { presetId: "ask", context: "stale clipboard text", contextSource: "clipboard" },
        { onSubmit: vi.fn(), onCancel: vi.fn() },
      );

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenLastCalledWith(
        String(WEB_CONTENTS_ID),
        { context: { text: "stale clipboard text", source: "clipboard" } },
      );

      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenLastCalledWith(
        String(WEB_CONTENTS_ID),
        { context: { text: "selected text", source: "selection" } },
      );
    });

    it("replaces the context on a second press", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });

      showAskInputWindow(
        { presetId: "ask", context: "a different selection" },
        { onSubmit: vi.fn(), onCancel: vi.fn() },
      );

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenLastCalledWith(
        String(WEB_CONTENTS_ID),
        { context: { text: "a different selection", source: "selection" } },
      );
    });

    /**
     * The press's directive block travels the same route and for the same
     * reasons — the renderer cannot resolve any of it, and a field on the wire
     * request would be renderer-controlled text going into a provider prompt.
     * Passed through VERBATIM, so the ghost text is written against the exact
     * bytes the submitted question will carry and the transparency row shows.
     */
    it("records the press's directives alongside the passage", async () => {
      const { showAskInputWindow } = await loadModule();

      showAskInputWindow(
        { ...PAYLOAD, contextDirectives: "App locale: en\nKeyboard input source: ABC" },
        { onSubmit: vi.fn(), onCancel: vi.fn() },
      );

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
        {
          context: { text: "selected text", source: "selection" },
          environment: "App locale: en\nKeyboard input source: ABC",
        },
      );
    });

    /**
     * The two halves are independent: a press with nothing selected still has an
     * environment worth suggesting against, and the record has to survive with
     * only that half — while still clearing the previous press's passage, which
     * is what the wholesale replacement buys.
     */
    it("keeps the directives when nothing was selected, and drops the previous passage", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      autocompleteServiceMocks.rememberAskSession.mockClear();

      showAskInputWindow(
        { ...PAYLOAD_WITHOUT_CONTEXT, contextDirectives: "App locale: en" },
        { onSubmit: vi.fn(), onCancel: vi.fn() },
      );

      expect(autocompleteServiceMocks.rememberAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
        { environment: "App locale: en" },
      );
      expect(autocompleteServiceMocks.forgetAskSession).not.toHaveBeenCalled();
    });

    /**
     * The window is a reused singleton under ONE `webContents.id`, so a press
     * with nothing selected has to clear rather than skip: skipping would leave
     * the previous press's passage in place and suggest against it, with no
     * context card on screen to say a passage was attached at all.
     */
    it("clears the context when the next press has nothing selected", async () => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      autocompleteServiceMocks.rememberAskSession.mockClear();

      showAskInputWindow(PAYLOAD_WITHOUT_CONTEXT, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(autocompleteServiceMocks.rememberAskSession).not.toHaveBeenCalled();
      expect(autocompleteServiceMocks.forgetAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    // Every path that ends an ask goes through `hideAskInputWindow`, dismissal
    // and submission alike — the same reason `abortAutocomplete` is read on both.
    const endTheAsk = {
      "a chrome dismissal (Cmd-W / red X)": () => {
        const closeCall = lastWindow?.on.mock.calls.find(
          ([eventName]) => eventName === "close",
        );
        closeCall?.[1]({ preventDefault: vi.fn() });
      },
      "ask-input-cancel (ESC)": () => getIpcHandler("ask-input-cancel")(undefined),
      "a submitted question": () =>
        getIpcHandler("ask-input-submit")(undefined, "What is a monad?"),
    };

    it.each(Object.entries(endTheAsk))("drops the context on %s", async (_description, end) => {
      const { showAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      autocompleteServiceMocks.forgetAskSession.mockClear();

      end();

      expect(autocompleteServiceMocks.forgetAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
    });

    it("drops the context when a profile switch dismisses a pending ask", async () => {
      const { showAskInputWindow, dismissAskInputWindow } = await loadModule();
      showAskInputWindow(PAYLOAD, { onSubmit: vi.fn(), onCancel: vi.fn() });
      autocompleteServiceMocks.forgetAskSession.mockClear();

      dismissAskInputWindow();

      expect(autocompleteServiceMocks.forgetAskSession).toHaveBeenCalledWith(
        String(WEB_CONTENTS_ID),
      );
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
