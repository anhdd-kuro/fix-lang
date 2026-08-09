/**
 * @file index.test.ts
 * @description Drives `AskInputWindow` with `react-dom/client` + `act`,
 * following `CorrectionResultWindow/index.test.ts` — Vitest only collects
 * `.test.ts`, not `.test.tsx`.
 *
 * Covers: Enter submits the trimmed question; Shift+Enter does not submit and
 * leaves the browser's own newline-insertion default action alone (verified
 * via `event.defaultPrevented`, since jsdom does not actually mutate a
 * textarea's value on a synthetic keydown); empty/whitespace-only Enter calls
 * nothing; the context chip renders only when context is non-empty, with the
 * character count interpolated through `t()`; and the ghost-text keyboard
 * traps — Tab accepts and clears the ghost, the first Escape clears the ghost
 * (and, in the `foldable context preview` suite, the attached selection folding
 * open and shut without taking Tab away from the ghost-accept path)
 * and leaves the window open, a second Escape (with no ghost showing) cancels
 * it, Enter submits only the typed text even with an unaccepted suggestion up
 * and invalidates on the way out, and a caret move retires the ghost rather
 * than leaving it acceptable somewhere it no longer belongs.
 *
 * Two of the caret cases assert opposite things ON PURPOSE. `moveCaret` fires
 * the keyup React synthesises `onSelect` from, and pins that the ghost
 * disappears; the "silently left" case moves the caret with NO event at all,
 * and pins that Tab still refuses. The first is the UX rule, the second is
 * the backstop that survives an event never arriving — a suite with only the
 * first would go green again the day `onSelect` stops firing. That day is not
 * hypothetical: React dispatches no `onSelect` for the whole duration of a
 * mousedown, which is what the `mouse-driven caret changes` suite covers.
 *
 * Tab's two outcomes are distinguished by `defaultPrevented`, and the
 * distinction is load-bearing in both directions. With NO suggestion up, Tab
 * keeps its normal focus-moving default. With a suggestion up but the caret
 * drifted, the press is consumed (02/f16): the press was aimed at the ghost,
 * and this window has exactly one textarea, so letting focus leave it drops
 * every keystroke that follows.
 *
 * Ghost PRESENCE is asserted against the overlay's own `data-ghost-suggestion`
 * seam, never against the footer's "Tab to accept" hint. The hint is a
 * sibling of the overlay, so a suite that reads it alone stays fully green
 * with `<GhostTextOverlay>` deleted outright — the card's headline
 * deliverable, unpinned. The hint has its own assertions where the hint is
 * what is under test.
 *
 * Fake timers throughout: `useGhostText`'s debounce must never fire on its
 * own wall-clock schedule mid-assertion, only when a test explicitly
 * advances it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { GHOST_TEXT_DEBOUNCE_MS } from "../hooks/useGhostText";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AskInputPayload } from "~/features/ask/shared/ask";
import type { AutocompleteSuggestReply } from "~/features/autocomplete/shared/autocompleteWire";
import { AskInputWindow } from "./index";

const tEn = createTranslator("en");

type ElectronApiMock = {
  onAskInputData: ReturnType<typeof vi.fn>;
  onAskInputDismissed: ReturnType<typeof vi.fn>;
  signalAskInputReady: ReturnType<typeof vi.fn>;
  submitAskInput: ReturnType<typeof vi.fn>;
  cancelAskInput: ReturnType<typeof vi.fn>;
  getTheme: ReturnType<typeof vi.fn>;
  onThemeChanged: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
  requestAutocompleteSuggestion: ReturnType<typeof vi.fn>;
};

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)?.set;

class StubResizeObserver {
  // `ContextPreview` observes its body to re-measure the clamp on resize;
  // jsdom provides no `ResizeObserver`, and these tests drive the measurement
  // through the stubbed heights below rather than through resize events.
  observe(): void {
    // no-op stub
  }
  unobserve(): void {
    // no-op stub
  }
  disconnect(): void {
    // no-op stub
  }
}

/**
 * jsdom lays nothing out, so every element reports `scrollHeight === 0` and
 * `clientHeight === 0` — overflow would never be detected and the fold control
 * would never render. These getters model the one thing `ContextPreview`
 * reads: a `[data-ask-context-text]` body whose full height is
 * `stubbedContextLines`, cropped to one line while the clamp class is on it.
 * Because `clientHeight` tracks the clamp class, expanding really does report
 * "no overflow" here, exactly as in a browser — which is what makes the
 * measure-while-expanded trap observable from a test at all.
 */
const LINE_HEIGHT_PX = 16;
const CLAMPED_LINES = 1;
let stubbedContextLines = 4;

const isContextText = (element: HTMLElement) =>
  typeof element.hasAttribute === "function" &&
  element.hasAttribute("data-ask-context-text");

const originalHeightDescriptors = {
  scrollHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  ),
  clientHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  ),
} as const;

const installTextMetrics = () => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isContextText(this) ? stubbedContextLines * LINE_HEIGHT_PX : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!isContextText(this)) return 0;
      const visibleLines = this.className.includes("line-clamp-1")
        ? Math.min(CLAMPED_LINES, stubbedContextLines)
        : stubbedContextLines;
      return visibleLines * LINE_HEIGHT_PX;
    },
  });
};

const restoreTextMetrics = () => {
  for (const property of ["scrollHeight", "clientHeight"] as const) {
    const original = originalHeightDescriptors[property];
    if (original) {
      Object.defineProperty(HTMLElement.prototype, property, original);
    } else {
      // jsdom defines these on `Element.prototype`, so there is normally no own
      // descriptor here to restore — the stub has to be removed outright.
      Reflect.deleteProperty(HTMLElement.prototype, property);
    }
  }
};

describe("AskInputWindow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payloadListener: ((payload: AskInputPayload) => void) | undefined;
  let dismissListener: (() => void) | undefined;
  let api: ElectronApiMock;
  const originalResizeObserver = globalThis.ResizeObserver;

  const render = async () => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      StubResizeObserver;
    installTextMetrics();

    api = {
      onAskInputData: vi.fn((callback: (payload: AskInputPayload) => void) => {
        payloadListener = callback;
        return vi.fn();
      }),
      onAskInputDismissed: vi.fn((callback: () => void) => {
        dismissListener = callback;
        return vi.fn();
      }),
      signalAskInputReady: vi.fn(),
      submitAskInput: vi.fn(),
      cancelAskInput: vi.fn(),
      getTheme: vi.fn().mockResolvedValue({ themeId: "brand-codex-dark" }),
      onThemeChanged: vi.fn().mockReturnValue(vi.fn()),
      setTheme: vi.fn().mockResolvedValue({ success: true }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
      requestAutocompleteSuggestion: vi
        .fn()
        .mockResolvedValue({ requestId: -1, suggestion: null } satisfies AutocompleteSuggestReply),
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
        createElement(I18nProvider, null, createElement(AskInputWindow)),
      );
    });
    await waitForUi();
    await waitForUi();
  };

  const textarea = (): HTMLTextAreaElement =>
    container.querySelector("textarea") as HTMLTextAreaElement;

  /** The suggestion actually painted by the overlay, or null when none is. */
  const paintedGhost = (): string | null =>
    container.querySelector("[data-ghost-suggestion]")?.textContent ?? null;

  const ghostMirror = (): HTMLElement | null =>
    container.querySelector("[data-ghost-mirror]");

  const contextSection = (): HTMLElement | null =>
    container.querySelector("[data-ask-context]");

  const contextBody = (): HTMLElement =>
    container.querySelector("[data-ask-context-text]") as HTMLElement;

  const foldControl = (): HTMLButtonElement | undefined =>
    [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent ===
          tEn("notifications.window.askInput.contextExpand") ||
        button.textContent ===
          tEn("notifications.window.askInput.contextCollapse"),
    );

  const clickFold = async () => {
    await act(async () => {
      foldControl()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  const acceptHintShown = (): boolean =>
    (container.textContent ?? "").includes(
      tEn("notifications.window.askInput.acceptHint"),
    );

  // Advances the ghost-text debounce and flushes the microtasks its resolved
  // `invoke` promise needs to commit `setSuggestion`.
  const settleGhostDebounce = async () => {
    await act(async () => {
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const type = async (value: string) => {
    await act(async () => {
      const el = textarea();
      nativeTextareaValueSetter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  /**
   * Types with the caret left mid-text. The order matters: jsdom's value
   * setter collapses the selection to the end of the new value, so the caret
   * has to be placed after the value and before the `input` event the
   * component reads `selectionStart` from.
   */
  const typeWithCaretAt = async (value: string, caret: number) => {
    await act(async () => {
      const el = textarea();
      nativeTextareaValueSetter?.call(el, value);
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  /**
   * Moves the caret the way the browser would and then fires the native event
   * React synthesises `onSelect` from. jsdom emits no `selectionchange` for a
   * textarea, so the keyup an arrow key really sends is what stands in for it
   * — React itself does the selection diffing from there.
   */
  const moveCaret = async (start: number, end = start) => {
    await act(async () => {
      const el = textarea();
      el.setSelectionRange(start, end);
      el.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
    });
  };

  /**
   * Moves the caret with NO event whatsoever. This is not an artificial case:
   * React's `SelectEventPlugin` sets an internal `mouseDown` flag on `mousedown`
   * and `constructSelectEvent` returns early while it is set, which kills the
   * `keyup`, `keydown` AND `selectionchange` legs too — so for the whole
   * duration of a click or a drag this is exactly what the component sees.
   */
  const moveCaretSilently = async (start: number, end = start) => {
    await act(async () => {
      textarea().setSelectionRange(start, end);
    });
  };

  /**
   * A drag-selection as the browser really produces one: `mousedown`, the caret
   * moving, then the legs React would normally synthesise `onSelect` from —
   * every one of which is suppressed until `mouseup`. Verified against this
   * repo's react-dom 19.2.8: the same sequence produces zero `onSelect` calls
   * while the button is held, and only the `mouseup` reports (3, 9).
   */
  const dragSelectWhileHeld = async (start: number, end: number) => {
    await act(async () => {
      const el = textarea();
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.setSelectionRange(start, end);
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      el.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
  };

  const keydown = async (init: KeyboardEventInit): Promise<KeyboardEvent> => {
    let event!: KeyboardEvent;
    await act(async () => {
      event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      textarea().dispatchEvent(event);
    });
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    payloadListener = undefined;
    dismissListener = undefined;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalResizeObserver;
    restoreTextMetrics();
    stubbedContextLines = 4;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signals readiness once mounted", async () => {
    await render();
    expect(api.signalAskInputReady).toHaveBeenCalledTimes(1);
  });

  it("renders no context chip when context is empty", async () => {
    await render();
    await act(async () => {
      payloadListener?.({ presetId: "ask", context: "" });
    });

    expect(container.textContent).not.toContain("Context attached");
  });

  it("renders the context chip with the interpolated character count when context is non-empty", async () => {
    await render();
    await act(async () => {
      payloadListener?.({ presetId: "ask", context: "hello" });
    });

    expect(container.textContent).toContain(
      tEn("notifications.window.askInput.contextChip", { count: 5 }),
    );
  });

  it("Enter submits the trimmed question", async () => {
    await render();
    await type("  hello there  ");

    const event = await keydown({ key: "Enter" });

    expect(api.submitAskInput).toHaveBeenCalledWith("hello there");
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+Enter does not submit and leaves the newline-insertion default alone", async () => {
    await render();
    await type("hello");

    const event = await keydown({ key: "Enter", shiftKey: true });

    expect(api.submitAskInput).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("empty/whitespace-only Enter calls nothing", async () => {
    await render();
    await type("    ");

    await keydown({ key: "Enter" });

    expect(api.submitAskInput).not.toHaveBeenCalled();
  });

  it("Escape cancels", async () => {
    await render();

    await keydown({ key: "Escape" });

    expect(api.cancelAskInput).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels even when focus is not on the textarea (06/f3)", async () => {
    await render();
    await act(async () => {
      payloadListener?.({ presetId: "ask", context: "hi" });
    });

    // Simulate focus having moved off the textarea onto a non-focusable
    // element (e.g. the footer hint) by blurring it before dispatching.
    await act(async () => {
      textarea().blur();
    });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(api.cancelAskInput).toHaveBeenCalledTimes(1);
  });

  it("resets the stale question and refocuses when a fresh payload arrives (06/f1)", async () => {
    await render();
    await act(async () => {
      payloadListener?.({ presetId: "ask", context: "Slack thread" });
    });
    await type("summarise this thread");
    expect(textarea().value).toBe("summarise this thread");

    await act(async () => {
      payloadListener?.({ presetId: "ask", context: "Mail paragraph" });
    });

    expect(textarea().value).toBe("");
    expect(document.activeElement).toBe(textarea());
  });

  it("does not submit while an IME composition is in progress (06/f5)", async () => {
    await render();
    await type("にほんご");

    const event = await keydown({ key: "Enter", isComposing: true });

    expect(api.submitAskInput).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not submit on the legacy composition keyCode 229 (06/f5)", async () => {
    await render();
    await type("にほんご");

    await keydown({ key: "Enter", keyCode: 229 });

    expect(api.submitAskInput).not.toHaveBeenCalled();
  });

  describe("ghost text keyboard traps", () => {
    const mockSuggestion = (suggestion: string) => {
      api.requestAutocompleteSuggestion.mockImplementation(
        async (request: { requestId: number }) => ({
          requestId: request.requestId,
          suggestion,
        }),
      );
    };

    /**
     * Holds the reply open so a test can decide exactly when it lands —
     * required for the "a request was still in flight when the user gave up"
     * cases, which cannot be expressed with an already-resolved mock.
     */
    const mockPendingSuggestion = (): {
      resolve: (suggestion: string) => void;
    } => {
      let settle!: (reply: AutocompleteSuggestReply) => void;
      let requestId = -1;
      api.requestAutocompleteSuggestion.mockImplementation(
        (request: { requestId: number }) => {
          requestId = request.requestId;
          return new Promise<AutocompleteSuggestReply>((resolve) => {
            settle = resolve;
          });
        },
      );
      return {
        resolve: (suggestion: string) => settle({ requestId, suggestion }),
      };
    };

    /** Types a long-enough question and lets one suggestion land. */
    const typeAndShowGhost = async (typed: string, suggestion: string) => {
      mockSuggestion(suggestion);
      await type(typed);
      await settleGhostDebounce();
    };

    it("paints the suggestion into the overlay once a reply lands", async () => {
      await render();
      await typeAndShowGhost("Hello there my friend", " world");

      expect(paintedGhost()).toBe(" world");
      expect(acceptHintShown()).toBe(true);
    });

    it("Tab accepts the suggestion into the textarea and clears the ghost", async () => {
      await render();
      const typed = "Hello there my friend";
      await typeAndShowGhost(typed, " world");
      expect(paintedGhost()).toBe(" world");

      const event = await keydown({ key: "Tab" });

      expect(event.defaultPrevented).toBe(true);
      expect(textarea().value).toBe(`${typed} world`);
      expect(paintedGhost()).toBeNull();
      expect(acceptHintShown()).toBe(false);
    });

    it("Tab splices at the caret rather than appending, and leaves the caret after the insertion (02/f10)", async () => {
      await render();
      // The caret has to be mid-text at REQUEST time for the suggestion to
      // belong there. Moving it afterwards is the f12 case below, and is now
      // a refusal rather than a mid-sentence splice.
      mockSuggestion("SUGGEST");
      await typeWithCaretAt("The quick brown fox jumps over", 15);
      await settleGhostDebounce();
      expect(paintedGhost()).toBe("SUGGEST");

      await keydown({ key: "Tab" });

      expect(textarea().value).toBe("The quick brownSUGGEST fox jumps over");
      expect(textarea().selectionStart).toBe(22);
      expect(textarea().selectionEnd).toBe(22);
    });

    // Inverted from "Tab over a selection replaces the selected text": under
    // the anchor rule a selection is not the state the suggestion was
    // computed for, so Tab refuses rather than overwriting the selected run
    // with model output the user never asked to replace. The earlier splice
    // arithmetic answered "where do we insert it"; the right answer is that
    // we do not.
    it("Tab refuses over a selection instead of overwriting the selected run (02/f7, 02/f12)", async () => {
      await render();
      await typeAndShowGhost("The quick brown fox", "SUGGEST");

      await moveCaret(4, 9);
      const event = await keydown({ key: "Tab" });

      expect(textarea().value).toBe("The quick brown fox");
      expect(event.defaultPrevented).toBe(false);
      expect(paintedGhost()).toBeNull();
    });

    // Inverted from "Tab splices at the caret": the caret moving AFTER the
    // request is the f12 bug, and the old assertion pinned its output
    // ("The SUGGESTquick brown fox") as correct. The suggestion continues the
    // prefix it was computed for; once the caret leaves, there is no place
    // where inserting it is right.
    it("an arrow-key caret move clears the ghost, so Tab cannot insert it elsewhere (02/f12)", async () => {
      await render();
      await typeAndShowGhost("The quick brown fox jum", "ps over the lazy dog");
      expect(paintedGhost()).toBe("ps over the lazy dog");

      await moveCaret(3);

      expect(paintedGhost()).toBeNull();
      expect(acceptHintShown()).toBe(false);

      const event = await keydown({ key: "Tab" });

      expect(textarea().value).toBe("The quick brown fox jum");
      expect(event.defaultPrevented).toBe(false);
    });

    // The event-independent half of the same rule. `onSelect` is what hides
    // the ghost; this is what stops a ghost that outlived its anchor for any
    // reason from being spliced in at the wrong offset.
    it("Tab refuses a ghost whose anchor the caret has silently left, with no caret-move event at all (02/f12)", async () => {
      await render();
      await typeAndShowGhost("The quick brown fox jum", "ps over the lazy dog");

      await moveCaretSilently(3);
      const event = await keydown({ key: "Tab" });

      expect(textarea().value).toBe("The quick brown fox jum");
      expect(paintedGhost()).toBeNull();
      // 02/f16: the refusal consumes the press. Without this the browser runs
      // Tab's default action and focus leaves the only textarea in the window,
      // so every following keystroke is silently dropped until the user clicks
      // back in. jsdom implements no focus traversal at all, so
      // `defaultPrevented` — the exact signal that suppresses it in a real
      // browser — is the only faithful assertion available here; an
      // `activeElement` check would pass with the bug present.
      expect(event.defaultPrevented).toBe(true);
    });

    it("a drag-selection forward from the anchor clears the ghost (02/f12)", async () => {
      await render();
      mockSuggestion("SUGGEST");
      await typeWithCaretAt("The quick brown fox jumps over", 15);
      await settleGhostDebounce();
      expect(paintedGhost()).toBe("SUGGEST");

      // `selectionStart` never leaves the anchor here — only the end moves.
      // A handler that forwards the start as both bounds sees no change.
      await moveCaret(15, 19);

      expect(paintedGhost()).toBeNull();
    });

    it("Tab refuses a selection that starts exactly on the anchor, with no caret-move event at all (02/f12)", async () => {
      await render();
      mockSuggestion("SUGGEST");
      await typeWithCaretAt("The quick brown fox jumps over", 15);
      await settleGhostDebounce();
      expect(paintedGhost()).toBe("SUGGEST");

      // `selectionStart` still reports the anchor; only `selectionEnd` says
      // four characters are about to be overwritten. Checking the start alone
      // would splice the suggestion in and delete " fox" with it.
      await moveCaretSilently(15, 19);
      const event = await keydown({ key: "Tab" });

      expect(textarea().value).toBe("The quick brown fox jumps over");
      // 02/f16 again: refusing to insert must not also cost the user focus.
      expect(event.defaultPrevented).toBe(true);
    });

    it("a caret move that lands back on the anchor leaves the ghost acceptable (02/f12)", async () => {
      await render();
      const typed = "Hello there my friend";
      await typeAndShowGhost(typed, " world");

      // Every ordinary keystroke ends in a keyup at the same caret the
      // request was made for. Invalidating there would delete the ghost the
      // instant it appeared.
      await moveCaret(typed.length);

      expect(paintedGhost()).toBe(" world");

      await keydown({ key: "Tab" });
      expect(textarea().value).toBe(`${typed} world`);
    });

    it("Tab is left alone (no preventDefault, no state change) when there is no suggestion", async () => {
      await render();
      await type("too short");

      const event = await keydown({ key: "Tab" });

      expect(event.defaultPrevented).toBe(false);
      expect(textarea().value).toBe("too short");
    });

    it("the first Esc clears the ghost and leaves the window open; a second Esc cancels it", async () => {
      await render();
      const typed = "Hello there my friend";
      await typeAndShowGhost(typed, " world");
      expect(paintedGhost()).toBe(" world");

      await keydown({ key: "Escape" });
      // Dispatched at the textarea, but the handler is document-level and
      // bubbles reach it either way — matches the existing "Escape cancels"
      // coverage above.

      expect(api.cancelAskInput).not.toHaveBeenCalled();
      expect(paintedGhost()).toBeNull();
      // The typed text itself must survive the first Esc.
      expect(textarea().value).toBe(typed);

      await keydown({ key: "Escape" });

      expect(api.cancelAskInput).toHaveBeenCalledTimes(1);
    });

    it("Enter submits only the typed text, never an unaccepted ghost suggestion", async () => {
      await render();
      const typed = "Hello there my friend";
      await typeAndShowGhost(typed, " world");
      expect(paintedGhost()).toBe(" world");

      await keydown({ key: "Enter" });

      expect(api.submitAskInput).toHaveBeenCalledWith(typed);
    });

    it("no request is issued while an IME is composing, and typing after it resumes requests", async () => {
      await render();
      mockSuggestion(" world");

      await act(async () => {
        textarea().dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
      });
      await type("にほんごにほんごにほんご");
      await settleGhostDebounce();

      expect(api.requestAutocompleteSuggestion).not.toHaveBeenCalled();

      await act(async () => {
        textarea().dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
      });
      // A DIFFERENT string than the composing phase used — React's input
      // value tracker treats re-setting the identical value as a no-op
      // event, which would make this assertion pass for the wrong reason.
      await type("にほんごにほんごにほんごです");
      await settleGhostDebounce();

      expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
    });

    it("the ghost clears on blur", async () => {
      await render();
      await typeAndShowGhost("Hello there my friend", " world");
      expect(paintedGhost()).toBe(" world");

      await act(async () => {
        textarea().blur();
      });

      expect(paintedGhost()).toBeNull();
      expect(acceptHintShown()).toBe(false);
    });

    it("a reply that lands after blur does not repaint the ghost, and the next Esc still cancels (02/f5)", async () => {
      await render();
      const pending = mockPendingSuggestion();

      await type("Hello there my friend");
      await settleGhostDebounce();
      expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

      await act(async () => {
        textarea().blur();
      });
      await act(async () => {
        pending.resolve(" world");
        await Promise.resolve();
      });

      expect(paintedGhost()).toBeNull();

      // The whole point: a ghost resurrected after blur would eat this Esc
      // as a dismissal, and the window would refuse to close on first press.
      await keydown({ key: "Escape" });
      expect(api.cancelAskInput).toHaveBeenCalledTimes(1);
    });

    it("a reply for a cancelled question never reaches the next Ask session (02/f2)", async () => {
      await render();
      const pending = mockPendingSuggestion();

      await type("Hello there my friend");
      await settleGhostDebounce();
      expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

      // No ghost showing yet, so this Esc goes straight to cancel.
      await keydown({ key: "Escape" });
      expect(api.cancelAskInput).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(" world");
        await Promise.resolve();
      });
      expect(paintedGhost()).toBeNull();

      // The window is hidden, not destroyed: main pushes a fresh payload on
      // the next open and the same React tree serves it.
      await act(async () => {
        payloadListener?.({ presetId: "ask", context: "a new selection" });
      });

      expect(textarea().value).toBe("");
      expect(paintedGhost()).toBeNull();
      expect(acceptHintShown()).toBe(false);
    });

    it("scrolling the textarea moves the ghost mirror with it (02/f1)", async () => {
      await render();
      await typeAndShowGhost("Hello there my friend", " world");
      expect(ghostMirror()?.style.transform).toBe("translateY(0px)");

      // jsdom performs no layout, so `scrollTop` never becomes non-zero on
      // its own; stubbing the property is the only way to state "the user
      // has scrolled" here.
      Object.defineProperty(textarea(), "scrollTop", {
        configurable: true,
        value: 72,
      });
      await act(async () => {
        textarea().dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      expect(ghostMirror()?.style.transform).toBe("translateY(-72px)");
    });

    // 02/f13. The mirror exists to push the ghost to the caret. Fed the whole
    // question it painted at the end of the text while Tab inserted
    // mid-sentence — and it voided f1's scroll-sync guarantee, which is only
    // sound while "the ghost is drawn at the caret" is true.
    it("the ghost mirror spaces the suggestion with the text BEFORE the caret, not the whole question", async () => {
      await render();
      mockSuggestion(" the meeting notes");
      await typeWithCaretAt("Please review x urgently", 13);
      await settleGhostDebounce();

      expect(paintedGhost()).toBe(" the meeting notes");
      expect(ghostMirror()?.textContent).toBe(
        "Please review the meeting notes",
      );
    });

    it("the mirror's spacing text matches what Tab actually produces (02/f13)", async () => {
      await render();
      mockSuggestion(" the meeting notes");
      await typeWithCaretAt("Please review x urgently", 13);
      await settleGhostDebounce();
      const mirrored = ghostMirror()?.textContent;

      await keydown({ key: "Tab" });

      // The mirror painted "Please review the meeting notes"; the accepted
      // text must begin with exactly that, or the ghost was drawn somewhere
      // the text does not land.
      expect(textarea().value).toBe(
        "Please review the meeting notes x urgently",
      );
      expect(textarea().value.startsWith(mirrored ?? "")).toBe(true);
    });

    // 02/f14. The window hides on submit but the tree survives, and
    // `revealWindow` shows the reopened window right after pushing the new
    // payload — so an unclaimed reply can flash the abandoned question's
    // ghost over a fresh, empty input.
    it("submitting drops a reply still in flight, so no ghost survives into the next Ask session", async () => {
      await render();
      const pending = mockPendingSuggestion();

      await type("Hello there my friend");
      await settleGhostDebounce();
      expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

      await keydown({ key: "Enter" });
      expect(api.submitAskInput).toHaveBeenCalledWith("Hello there my friend");

      await act(async () => {
        pending.resolve(" world");
        await Promise.resolve();
      });

      expect(paintedGhost()).toBeNull();
      expect(acceptHintShown()).toBe(false);
    });

    it("submitting hides a ghost that is already painted (02/f14)", async () => {
      await render();
      const typed = "Hello there my friend";
      await typeAndShowGhost(typed, " world");
      expect(paintedGhost()).toBe(" world");

      await keydown({ key: "Enter" });

      expect(api.submitAskInput).toHaveBeenCalledWith(typed);
      expect(paintedGhost()).toBeNull();
    });

    // 02/f15. `onSelect` is not a caret guarantee. React's `SelectEventPlugin`
    // sets an internal `mouseDown` flag on `mousedown`
    // (`react-dom-client.development.js:19662`) and `constructSelectEvent`
    // returns early while it is set (`:3707`), clearing it only on
    // `mouseup`/`dragend`/`contextmenu` — and the early return kills the
    // `keyup`, `keydown` and `selectionchange` legs along with the mouse one.
    // Measured against the installed 19.2.8: during a held mousedown, a caret
    // moved to (3, 9) plus `mousemove`, `keyup` and `selectionchange` produced
    // ZERO `onSelect` calls, and only the `mouseup` reported (3, 9).
    //
    // Two of these tests fire the real mouse sequence; the rest fire NO event
    // at all, which is the same thing from the component's side and is what
    // pins the gates that hold regardless of what the DOM chooses to dispatch.
    describe("mouse-driven caret changes, which fire no onSelect (02/f15)", () => {
      it("the mousedown that opens a click retires the ghost, before the caret has even moved", async () => {
        await render();
        await typeAndShowGhost("The quick brown fox", "SUGGEST");
        expect(paintedGhost()).toBe("SUGGEST");

        // A bare press. The browser repositions the caret as the DEFAULT action
        // of this event, so nothing has moved yet and there is nothing to
        // compare — which is why the press invalidates unconditionally instead.
        await act(async () => {
          textarea().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        expect(paintedGhost()).toBeNull();
        expect(acceptHintShown()).toBe(false);
      });

      it("a drag-selection does not survive with the mirror spaced by an abandoned prefix", async () => {
        await render();
        await typeAndShowGhost("The quick brown fox", "SUGGEST");
        expect(paintedGhost()).toBe("SUGGEST");

        await dragSelectWhileHeld(3, 9);

        // The finding's literal repro: a painted ghost, its mirror still spaced
        // by the abandoned prefix, and "Tab to accept" still lit, all the way
        // through a drag the component was never told about.
        expect(paintedGhost()).toBeNull();
        expect(ghostMirror()).toBeNull();
        expect(acceptHintShown()).toBe(false);
      });

      it("dispatches no request when a mousedown inside the debounce window abandons the caret", async () => {
        await render();
        mockSuggestion("SUGGEST");
        await type("The quick brown fox jumps");

        await act(async () => {
          const el = textarea();
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          el.setSelectionRange(3, 3);
        });
        await settleGhostDebounce();

        // A billed request for a caret the user had already left.
        expect(api.requestAutocompleteSuggestion).not.toHaveBeenCalled();
      });

      it("dispatches no request for a caret the surface has silently left, with no event at all", async () => {
        await render();
        mockSuggestion("SUGGEST");
        await type("The quick brown fox jumps");

        // No mousedown either — this passes only because the debounce re-reads
        // the live surface before spending anything.
        await moveCaretSilently(3);
        await settleGhostDebounce();

        expect(api.requestAutocompleteSuggestion).not.toHaveBeenCalled();
      });

      it("still dispatches when the surface has not moved, so the gate is not a blanket refusal", async () => {
        await render();
        mockSuggestion("SUGGEST");
        await type("The quick brown fox jumps");

        await settleGhostDebounce();

        expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
        expect(paintedGhost()).toBe("SUGGEST");
      });

      it("paints no reply that lands after the caret has silently left the anchor", async () => {
        await render();
        const pending = mockPendingSuggestion();

        await type("Hello there my friend");
        await settleGhostDebounce();
        expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

        // The press landed after the request went out, so the reply is still
        // the newest ever sent and no id-based defence is challenged.
        await moveCaretSilently(3);
        await act(async () => {
          pending.resolve(" world");
          await Promise.resolve();
        });

        expect(paintedGhost()).toBeNull();
        expect(acceptHintShown()).toBe(false);
      });
    });

    // 02/f17. Only ESC originates in this window. Cmd-W, the red close button
    // and a profile switch all reach `dismissAskInputWindow()` in main, which
    // now tells the renderer — otherwise this tree keeps the abandoned question
    // and its ghost, and `revealWindow` shows the reopened window right after
    // pushing the fresh payload, so both get a frame to paint over it.
    describe("dismissal reported by main (02/f17)", () => {
      it("drops the abandoned question and its painted ghost", async () => {
        await render();
        await typeAndShowGhost("Hello there my friend", " world");
        expect(paintedGhost()).toBe(" world");

        await act(async () => {
          dismissListener?.();
        });

        expect(textarea().value).toBe("");
        expect(paintedGhost()).toBeNull();
        expect(acceptHintShown()).toBe(false);
      });

      it("drops a reply still in flight, so it cannot flash over the next ask", async () => {
        await render();
        const pending = mockPendingSuggestion();

        await type("Hello there my friend");
        await settleGhostDebounce();
        expect(api.requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

        await act(async () => {
          dismissListener?.();
        });
        await act(async () => {
          pending.resolve(" world");
          await Promise.resolve();
        });

        expect(textarea().value).toBe("");
        expect(paintedGhost()).toBeNull();
      });
    });
  });

  /**
   * The attached selection itself, foldable. Mirrors `FoldableTextBlock` in
   * `AskResultWindow`, so the same two traps are pinned here: the control must
   * be gated on a MEASURED overflow (never on string length, which cannot know
   * the window width), and the measurement must run only while collapsed — an
   * expanded body reports "it fits", so re-measuring there unmounts the only
   * control that gets the user back to collapsed.
   */
  describe("foldable context preview", () => {
    const LONG_CONTEXT =
      "The quarterly report needs a rewrite before Friday, and the numbers in section three do not agree with the appendix.";

    const showContext = async (context = LONG_CONTEXT) => {
      await act(async () => {
        payloadListener?.({ presetId: "ask", context });
      });
    };

    it("renders no context preview when nothing was selected", async () => {
      await render();
      await showContext("");

      expect(contextSection()).toBeNull();
      expect(foldControl()).toBeUndefined();
    });

    it("shows the attached context collapsed to a single line by default", async () => {
      await render();
      await showContext();

      expect(contextBody().className).toContain("line-clamp-1");
      expect(contextBody().className).not.toContain("overflow-y-auto");
      expect(contextBody().textContent).toBe(LONG_CONTEXT);
      expect(foldControl()?.textContent).toBe(
        tEn("notifications.window.askInput.contextExpand"),
      );
      expect(foldControl()?.getAttribute("aria-expanded")).toBe("false");
    });

    it("omits the fold control entirely when the context fits on one line", async () => {
      stubbedContextLines = 1;
      await render();
      await showContext("short selection");

      expect(contextBody().textContent).toBe("short selection");
      expect(foldControl()).toBeUndefined();
      expect(container.textContent).not.toContain(
        tEn("notifications.window.askInput.contextExpand"),
      );
    });

    it("expanding reveals the full context under a capped scroll, and collapsing returns", async () => {
      await render();
      await showContext();

      await clickFold();

      expect(contextBody().className).not.toContain("line-clamp-1");
      // Capped rather than unbounded: the window never grows, so an expanded
      // selection scrolls inside its own box instead of eating the textarea.
      expect(contextBody().className).toContain("max-h-16");
      expect(contextBody().className).toContain("overflow-y-auto");
      expect(contextBody().textContent).toBe(LONG_CONTEXT);
      expect(foldControl()?.textContent).toBe(
        tEn("notifications.window.askInput.contextCollapse"),
      );
      expect(foldControl()?.getAttribute("aria-expanded")).toBe("true");

      await clickFold();

      expect(contextBody().className).toContain("line-clamp-1");
      expect(foldControl()?.textContent).toBe(
        tEn("notifications.window.askInput.contextExpand"),
      );
    });

    it("keeps the fold control mounted once expanded, though the unclamped context reports no overflow", async () => {
      await render();
      await showContext();

      await clickFold();

      const body = contextBody();
      expect(body.className).not.toContain("line-clamp-1");
      // Unclamped, the body's scrollHeight equals its clientHeight: measuring
      // here would report "fits" and unmount the only way back to collapsed.
      expect(body.scrollHeight).toBe(body.clientHeight);
      expect(foldControl()?.textContent).toBe(
        tEn("notifications.window.askInput.contextCollapse"),
      );
    });

    it("labels a clipboard-sourced context as such, not as the user's selection", async () => {
      // The label is what makes attaching the clipboard acceptable: when the
      // hotkey's own copy produced nothing, this text may be minutes old and
      // unrelated. Told which it is, the user can send it or press Esc.
      await render();
      await act(async () => {
        payloadListener?.({
          presetId: "ask",
          context: LONG_CONTEXT,
          contextSource: "clipboard",
        });
      });

      const label = contextSection()?.querySelector(
        "[data-ask-context-label]",
      ) as HTMLElement;
      expect(label.textContent).toBe(
        tEn("notifications.window.askInput.contextLabelClipboard"),
      );
      expect(label.getAttribute("data-ask-context-source")).toBe("clipboard");
    });

    it("falls back to the selection label when the payload names no source", async () => {
      await render();
      await showContext();

      const label = contextSection()?.querySelector(
        "[data-ask-context-label]",
      ) as HTMLElement;
      expect(label.textContent).toBe(
        tEn("notifications.window.askInput.contextLabel"),
      );
      expect(label.getAttribute("data-ask-context-source")).toBe("selection");
    });

    it("renders the context as plain text, never as markdown or HTML", async () => {
      const hostile = "**bold** <b>tag</b> [link](http://example.com)";
      await render();
      await showContext(hostile);

      const section = contextSection() as HTMLElement;
      expect(section.querySelector("b")).toBeNull();
      expect(section.querySelector("strong")).toBeNull();
      expect(section.querySelector("a")).toBeNull();
      expect(contextBody().textContent).toBe(hostile);
    });

    it("opens collapsed again when a fresh payload brings a different selection", async () => {
      await render();
      await showContext();
      await clickFold();
      expect(contextBody().className).not.toContain("line-clamp-1");

      await showContext("An entirely different passage from another app.");

      expect(contextBody().className).toContain("line-clamp-1");
      expect(foldControl()?.textContent).toBe(
        tEn("notifications.window.askInput.contextExpand"),
      );
    });

    it("puts the fold control after the context text and ahead of the textarea in the tab order", async () => {
      await render();
      await showContext();

      const section = contextSection() as HTMLElement;
      const body = contextBody();
      const control = foldControl() as HTMLButtonElement;

      const label = section.querySelector(
        "[data-ask-context-label]",
      ) as HTMLElement;
      expect(label.textContent).toBe(
        tEn("notifications.window.askInput.contextLabel"),
      );
      // Label, then the text it labels, then the control — the card reads top
      // to bottom in the same order as the session-detail system-prompt block
      // it is modelled on.
      expect([...section.children].indexOf(label)).toBe(0);
      expect([...section.children].indexOf(body)).toBe(1);
      expect(section.lastElementChild).toBe(control);
      // The control precedes the textarea in document order, so a FORWARD Tab
      // from the input can never land on it — the only Tab the textarea sees
      // stays the ghost's. Shift+Tab is what reaches the control.
      expect(
        control.compareDocumentPosition(textarea()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("returns focus to the textarea after toggling, so the next keystroke is not dropped", async () => {
      await render();
      await showContext();

      await act(async () => {
        foldControl()?.focus();
      });
      expect(document.activeElement).toBe(foldControl());

      await clickFold();

      expect(document.activeElement).toBe(textarea());
    });

    describe("the existing keyboard contract still holds with context attached", () => {
      const mockSuggestion = (suggestion: string) => {
        api.requestAutocompleteSuggestion.mockImplementation(
          async (request: { requestId: number }) => ({
            requestId: request.requestId,
            suggestion,
          }),
        );
      };

      it("Tab still accepts the ghost suggestion", async () => {
        await render();
        await showContext();
        mockSuggestion(" world");
        const typed = "Hello there my friend";
        await type(typed);
        await settleGhostDebounce();
        expect(paintedGhost()).toBe(" world");

        const event = await keydown({ key: "Tab" });

        expect(event.defaultPrevented).toBe(true);
        expect(textarea().value).toBe(`${typed} world`);
        expect(paintedGhost()).toBeNull();
      });

      it("Tab still accepts the ghost while the context is expanded", async () => {
        await render();
        await showContext();
        await clickFold();
        mockSuggestion(" world");
        const typed = "Hello there my friend";
        await type(typed);
        await settleGhostDebounce();
        expect(paintedGhost()).toBe(" world");

        await keydown({ key: "Tab" });

        expect(textarea().value).toBe(`${typed} world`);
      });

      it("the first Esc still clears the ghost and the second still cancels", async () => {
        await render();
        await showContext();
        mockSuggestion(" world");
        await type("Hello there my friend");
        await settleGhostDebounce();
        expect(paintedGhost()).toBe(" world");

        await keydown({ key: "Escape" });

        expect(api.cancelAskInput).not.toHaveBeenCalled();
        expect(paintedGhost()).toBeNull();

        await keydown({ key: "Escape" });

        expect(api.cancelAskInput).toHaveBeenCalledTimes(1);
      });

      it("Enter still submits the trimmed question with the context expanded", async () => {
        await render();
        await showContext();
        await clickFold();
        await type("  what changed?  ");

        const event = await keydown({ key: "Enter" });

        expect(api.submitAskInput).toHaveBeenCalledWith("what changed?");
        expect(event.defaultPrevented).toBe(true);
      });
    });
  });
});
