/**
 * @file useGhostText.test.ts
 * @description Drives `useGhostText` through a bare harness component
 * (`createElement` + `react-dom/client` + `act`, no JSX, no RTL — matches
 * `AskInputWindow/index.test.ts`) since there is no `renderHook` utility
 * installed.
 *
 * Covers: exactly one request per idle burst; a reply whose `requestId` is
 * not the latest is dropped even when it resolves after a newer one; no
 * request while composing; the ghost clears on blur.
 *
 * The invalidation suite below is deliberately sharper than the out-of-order
 * test it sits next to. Out-of-order delivery needs TWO dispatched requests
 * and only proves the later one wins; in-flight invalidation needs exactly
 * ONE, and proves a reply that is still "the newest request ever sent" is
 * dropped anyway because the user moved on before it landed. A suite that
 * dispatches both requests before resolving either can never tell those two
 * apart, which is how a reply for a prefix the user had already typed past
 * used to paint a ghost with every assertion green.
 *
 * The caret suite is sharper again, and for a reason worth stating: a caret
 * move changes no text, so `notifyChange` never runs and NO id-based defence
 * is even challenged — the reply really is the newest request ever sent. It
 * is the anchor, and only the anchor, that can report the surface has left
 * the state the suggestion continues from. Its no-op case is load-bearing
 * too: every ordinary keystroke ends in a caret report at the anchor, so a
 * `notifyCaretMove` that invalidated unconditionally would erase each ghost
 * the instant it appeared — hence a test for the ghost SURVIVING.
 *
 * The harness models a real surface (`liveSurface`) rather than passing a stub
 * reader, because the hook's two strongest defences are event-independent: it
 * re-reads the surface at DISPATCH time and at PAINT time. The `mouse-driven
 * caret change` suite exercises exactly those by moving `liveSurface` and
 * calling NO notifier at all — which is what a click or drag really looks like
 * from here, since React reports no selection event for the duration of a
 * mousedown (see the hook's header for the verified mechanism). Every notifier
 * in this file therefore goes through `change` / `caretMove`, which move the
 * surface the way the DOM would before telling the hook; a test that told the
 * hook one thing while the surface said another would be testing a browser
 * that does not exist.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSurfaceOnAnchor,
  useGhostText,
  GHOST_TEXT_DEBOUNCE_MS,
  MAX_PREFIX_CHARS_SENT,
  MAX_SUFFIX_CHARS_SENT,
  type GhostTextSurfaceState,
  type UseGhostText,
} from "./useGhostText";
import type {
  AutocompleteSuggestReply,
  AutocompleteSuggestRequest,
} from "~/features/autocomplete/shared/autocompleteWire";

type DeferredReply = {
  promise: Promise<AutocompleteSuggestReply>;
  resolve: (reply: AutocompleteSuggestReply) => void;
};

const deferReply = (): DeferredReply => {
  let resolve!: (reply: AutocompleteSuggestReply) => void;
  const promise = new Promise<AutocompleteSuggestReply>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("useGhostText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: UseGhostText | undefined;
  let requestAutocompleteSuggestion: ReturnType<typeof vi.fn>;
  /** Stands in for the textarea: what a live DOM read would report right now. */
  let liveSurface: GhostTextSurfaceState | null = null;

  const Harness = () => {
    hook = useGhostText({ readSurface: () => liveSurface });
    return null;
  };

  /** Moves the surface, then tells the hook — the order the DOM produces. */
  const change = (text: string, caret: number): void => {
    liveSurface = { text, selectionStart: caret, selectionEnd: caret };
    hook?.notifyChange(text, caret);
  };

  const caretMove = (
    text: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): void => {
    liveSurface = { text, selectionStart, selectionEnd };
    hook?.notifyCaretMove(text, selectionStart, selectionEnd);
  };

  /**
   * A caret change with NO notifier — what a click or drag really looks like
   * from this hook's side, since React dispatches no selection event for the
   * duration of a mousedown.
   */
  const moveSurfaceSilently = (
    text: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): void => {
    liveSurface = { text, selectionStart, selectionEnd };
  };

  const mount = async (): Promise<void> => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });
  };

  const flushMicrotasks = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /** The `requestId` the hook actually put on the wire for a given call. */
  const sentRequest = (callIndex = 0): AutocompleteSuggestRequest =>
    requestAutocompleteSuggestion.mock.calls[callIndex]?.[0] as AutocompleteSuggestRequest;

  /** Types `text` (caret at the end) and lets the debounce dispatch. */
  const typeAndSettle = async (text: string): Promise<void> => {
    await act(async () => {
      change(text, text.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    liveSurface = null;
    requestAutocompleteSuggestion = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { requestAutocompleteSuggestion },
    });
    await mount();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    hook = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires exactly one request after a burst of keystrokes settles", async () => {
    requestAutocompleteSuggestion.mockResolvedValue({
      requestId: 1,
      suggestion: null,
    } satisfies AutocompleteSuggestReply);

    const prefix = "The quick brown";
    for (let i = 1; i <= prefix.length; i += 1) {
      const partial = prefix.slice(0, i);
      await act(async () => {
        change(partial, partial.length);
        // Stay well under the debounce so each keystroke cancels the last.
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS / 3);
      });
    }

    await act(async () => {
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();

    expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
    expect(requestAutocompleteSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ prefix }),
    );
  });

  it("drops a reply whose requestId is not the latest, even when it resolves after a newer one", async () => {
    let resolveFirst!: (reply: AutocompleteSuggestReply) => void;
    let resolveSecond!: (reply: AutocompleteSuggestReply) => void;
    requestAutocompleteSuggestion
      .mockImplementationOnce(
        () => new Promise<AutocompleteSuggestReply>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<AutocompleteSuggestReply>((resolve) => (resolveSecond = resolve)),
      );

    const first = "abcdefghijkl";
    await act(async () => {
      change(first, first.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();

    const second = "abcdefghijklmnop";
    await act(async () => {
      change(second, second.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();

    expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(2);

    // The newer reply lands first...
    await act(async () => {
      resolveSecond({ requestId: 2, suggestion: "second" });
    });
    await flushMicrotasks();
    expect(hook?.suggestion).toBe("second");

    // ...and the older, now-stale reply lands after it. It must not overwrite.
    await act(async () => {
      resolveFirst({ requestId: 1, suggestion: "first" });
    });
    await flushMicrotasks();
    expect(hook?.suggestion).toBe("second");
  });

  it("never requests while an IME is composing", async () => {
    requestAutocompleteSuggestion.mockResolvedValue({
      requestId: 1,
      suggestion: "should not appear",
    } satisfies AutocompleteSuggestReply);

    const composingText = "にほんごにほんごにほんご";
    await act(async () => {
      hook?.notifyCompositionStart();
      change(composingText, composingText.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
    });
    await flushMicrotasks();

    expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    expect(hook?.suggestion).toBeNull();

    await act(async () => {
      hook?.notifyCompositionEnd();
      change(composingText, composingText.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();

    expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
  });

  it("clears the ghost on blur and cancels any pending debounce", async () => {
    requestAutocompleteSuggestion.mockResolvedValue({
      requestId: 1,
      suggestion: "ghost text",
    } satisfies AutocompleteSuggestReply);

    const text = "some long enough prefix";
    await act(async () => {
      change(text, text.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
    });
    await flushMicrotasks();
    expect(hook?.suggestion).toBe("ghost text");

    await act(async () => {
      hook?.notifyBlur();
    });
    expect(hook?.suggestion).toBeNull();

    // A debounce queued right before blur must not fire afterward either.
    requestAutocompleteSuggestion.mockClear();
    await act(async () => {
      change(text, text.length);
    });
    await act(async () => {
      hook?.notifyBlur();
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
    });
    await flushMicrotasks();
    expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
  });

  it("does not request below MIN_PREFIX_CHARS", async () => {
    const short = "too short";
    await act(async () => {
      change(short, short.length);
      vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
    });
    await flushMicrotasks();

    expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
  });

  // Every one of these resolves a reply that IS the newest request ever sent,
  // so the out-of-order test above cannot cover any of them: the only thing
  // that can drop these replies is the surface having been invalidated while
  // they were in flight.
  describe("in-flight invalidation", () => {
    it("drops a reply for a prefix the user has already typed past (02/f4)", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
      const inFlight = sentRequest();

      // The user keeps typing. This re-arms the debounce but dispatches
      // nothing yet, so `inFlight.requestId` is still the highest id ever put
      // on the wire — an id comparison alone would accept the reply.
      await act(async () => {
        change("abcdefghijklmno", 15);
      });
      expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve({ requestId: inFlight.requestId, suggestion: "stale ghost" });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });

    it("drops a reply after the text shrinks below MIN_PREFIX_CHARS, where nothing later would clear it (02/f4)", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      // Below the threshold `notifyChange` returns before arming a timer, so
      // no future request exists to overwrite a ghost painted here.
      await act(async () => {
        change("abc", 3);
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await act(async () => {
        pending.resolve({ requestId: inFlight.requestId, suggestion: "orphan ghost" });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
      expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
    });

    it("drops a reply that lands after blur, so the ghost cannot return once focus has left (02/f5)", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      await act(async () => {
        hook?.notifyBlur();
      });
      await act(async () => {
        pending.resolve({ requestId: inFlight.requestId, suggestion: "post-blur ghost" });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });

    it("drops a reply that lands after clear(), so a dismissed or accepted ghost cannot repaint (02/f6)", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      await act(async () => {
        hook?.clear();
      });
      await act(async () => {
        pending.resolve({ requestId: inFlight.requestId, suggestion: "revenant ghost" });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });

    it("drops a reply that lands after an IME composition starts (02/f4)", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      await act(async () => {
        hook?.notifyCompositionStart();
      });
      await act(async () => {
        pending.resolve({ requestId: inFlight.requestId, suggestion: "mid-composition ghost" });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });

    it("clear() cancels the pending debounce, so no request is issued for a prefix already accepted or dismissed (02/f6)", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: -1,
        suggestion: null,
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      await act(async () => {
        hook?.clear();
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    });

    it("shows no ghost and raises nothing when the invoke rejects (02/f8)", async () => {
      requestAutocompleteSuggestion.mockRejectedValue(new Error("main threw"));

      await typeAndSettle("abcdefghijkl");
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
      expect(hook?.suggestion).toBeNull();
    });
  });

  // A caret move changes nothing about the text, so `notifyChange` never runs
  // and every id-based defence stays satisfied — the reply IS the newest
  // request ever sent. Only the anchor can tell that the surface has left the
  // state the suggestion continues from.
  describe("caret movement (02/f12)", () => {
    it("drops a reply in flight once the caret leaves the anchor", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      await act(async () => {
        caretMove("abcdefghijkl", 3, 3);
      });
      await act(async () => {
        pending.resolve({
          requestId: inFlight.requestId,
          suggestion: "displaced ghost",
        });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
      expect(hook?.anchor).toBeNull();
    });

    it("hides a painted ghost once the caret leaves the anchor", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await typeAndSettle("abcdefghijkl");
      expect(hook?.suggestion).toBe("ghost text");

      await act(async () => {
        caretMove("abcdefghijkl", 3, 3);
      });

      expect(hook?.suggestion).toBeNull();
    });

    it("cancels a debounce armed for a caret the user has since left, so no request goes out at all", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: null,
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      await act(async () => {
        caretMove("abcdefghijkl", 4, 4);
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    });

    it("leaves a suggestion alone when the caret is still collapsed on the anchor", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await typeAndSettle("abcdefghijkl");

      // The keyup that ends every ordinary keystroke reports exactly the
      // anchor. Invalidating here would erase the ghost the moment it lands.
      await act(async () => {
        caretMove("abcdefghijkl", 12, 12);
      });

      expect(hook?.suggestion).toBe("ghost text");
    });

    it("treats a selection that merely starts at the anchor as off it", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await typeAndSettle("abcdefghijklmnop");
      expect(hook?.suggestion).toBe("ghost text");

      // Anchor caret is 16; a backwards drag-selection ending there leaves
      // `selectionStart` at 10, but a forwards one leaves it AT the anchor
      // with `selectionEnd` past it. Accepting either would overwrite text.
      await act(async () => {
        caretMove("abcdefghijklmnop", 16, 16);
      });
      expect(hook?.suggestion).toBe("ghost text");

      await act(async () => {
        caretMove("abcdefghijklmnop", 16, 20);
      });
      expect(hook?.suggestion).toBeNull();
    });

    it("treats the same caret over different text as off the anchor", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await typeAndSettle("abcdefghijkl");
      expect(hook?.suggestion).toBe("ghost text");

      // The caret offset alone is not the anchor. A same-length replacement
      // under an unmoved caret leaves the offset identical while the prefix
      // the suggestion continues is gone.
      await act(async () => {
        caretMove("ABCDEFGHIJKL", 12, 12);
      });

      expect(hook?.suggestion).toBeNull();
    });

    it("does nothing when nothing is anchored, so it cannot cancel a debounce it does not own", async () => {
      // Echoes the id rather than pinning it: this test drives more than one
      // invalidation before the request that matters, so the live id is not 1.
      requestAutocompleteSuggestion.mockImplementation(
        async (request: AutocompleteSuggestRequest) => ({
          requestId: request.requestId,
          suggestion: "ghost text",
        } satisfies AutocompleteSuggestReply),
      );

      // Below MIN_PREFIX_CHARS nothing is armed and nothing is anchored.
      await act(async () => {
        change("abc", 3);
        caretMove("abc", 1, 1);
      });

      // A real request armed straight afterwards must still reach the wire.
      await typeAndSettle("abcdefghijkl");

      expect(requestAutocompleteSuggestion).toHaveBeenCalledTimes(1);
      expect(hook?.suggestion).toBe("ghost text");
    });
  });

  // Every test here moves the surface and calls NO notifier, because that is
  // what a click or a drag-selection actually looks like from this hook: React's
  // `SelectEventPlugin` sets an internal `mouseDown` flag on `mousedown` and
  // `constructSelectEvent` returns early while it is set, which kills the
  // `keyup`, `keydown` AND `selectionchange` legs too — verified against the
  // installed 19.2.8, where a caret moved to (3,9) mid-drag plus `mousemove`,
  // `keyup` and `selectionchange` produced zero `onSelect` calls.
  //
  // So `notifyCaretMove` is not reachable during that window and cannot be
  // what protects the user. These pin the two gates that need no event at all.
  describe("mouse-driven caret change, with no event to observe (02/f15)", () => {
    it("dispatches no request for a caret the surface has silently left", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      // The mousedown that repositioned the caret. Nothing told the hook.
      moveSurfaceSilently("abcdefghijkl", 3);
      await act(async () => {
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      // A billed request for a caret the user had already left.
      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
      expect(hook?.suggestion).toBeNull();
      expect(hook?.anchor).toBeNull();
    });

    it("dispatches no request while a silent selection is open on the anchor", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      // A drag backwards from the anchor: `selectionStart` still reports 12.
      // Checking the start alone would bill this one.
      moveSurfaceSilently("abcdefghijkl", 8, 12);
      await act(async () => {
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    });

    it("dispatches no request when there is no surface left to read", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      liveSurface = null;
      await act(async () => {
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    });

    it("paints no reply that lands after the surface has silently left the anchor", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      // The press happened after the request went out, so the id is still the
      // newest ever sent and no id-based defence is challenged.
      moveSurfaceSilently("abcdefghijkl", 3);
      await act(async () => {
        pending.resolve({
          requestId: inFlight.requestId,
          suggestion: "mid-drag ghost",
        });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
      expect(hook?.anchor).toBeNull();
    });

    it("paints no reply that lands while a silent selection is open on the anchor", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      // Forwards drag from the anchor: only `selectionEnd` moved.
      moveSurfaceSilently("abcdefghijkl", 12, 12);
      moveSurfaceSilently("abcdefghijkl", 12, 4);
      await act(async () => {
        pending.resolve({
          requestId: inFlight.requestId,
          suggestion: "mid-drag ghost",
        });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });

    it("still paints a reply that lands with the surface untouched", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      // The load-bearing no-op: the gates above must not be a blanket refusal,
      // or the feature would never paint anything and every test around it
      // would still be green.
      await act(async () => {
        pending.resolve({
          requestId: inFlight.requestId,
          suggestion: "ghost text",
        });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBe("ghost text");
    });

    it("notifyPointerDown retires a painted ghost at the edge React goes silent", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await typeAndSettle("abcdefghijkl");
      expect(hook?.suggestion).toBe("ghost text");

      // Unconditional: the caret has NOT moved yet when a mousedown handler
      // runs (repositioning is the default action), so passing it the live
      // surface would read the old caret and conclude nothing changed.
      await act(async () => {
        hook?.notifyPointerDown();
      });

      expect(hook?.suggestion).toBeNull();
      expect(hook?.anchor).toBeNull();
    });

    it("notifyPointerDown cancels a debounce armed before the press", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: "ghost text",
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl", 12);
      });
      await act(async () => {
        hook?.notifyPointerDown();
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS * 2);
      });
      await flushMicrotasks();

      expect(requestAutocompleteSuggestion).not.toHaveBeenCalled();
    });

    it("notifyPointerDown drops a reply already in flight", async () => {
      const pending = deferReply();
      requestAutocompleteSuggestion.mockReturnValueOnce(pending.promise);

      await typeAndSettle("abcdefghijkl");
      const inFlight = sentRequest();

      await act(async () => {
        hook?.notifyPointerDown();
      });
      await act(async () => {
        pending.resolve({
          requestId: inFlight.requestId,
          suggestion: "post-press ghost",
        });
      });
      await flushMicrotasks();

      expect(hook?.suggestion).toBeNull();
    });
  });

  // The one rule the dispatch, paint and accept gates all defer to. Tested
  // directly as well as through them, because `AskInputWindow` imports it for
  // its Tab check and a drift here would let a ghost be inserted at an offset
  // it was never computed for.
  describe("isSurfaceOnAnchor", () => {
    const anchor = { text: "abcdefghijkl", caret: 12 } as const;

    it("accepts a collapsed caret exactly on the anchor", () => {
      expect(
        isSurfaceOnAnchor(
          { text: "abcdefghijkl", selectionStart: 12, selectionEnd: 12 },
          anchor,
        ),
      ).toBe(true);
    });

    it("rejects a caret that has moved", () => {
      expect(
        isSurfaceOnAnchor(
          { text: "abcdefghijkl", selectionStart: 3, selectionEnd: 3 },
          anchor,
        ),
      ).toBe(false);
    });

    it("rejects a selection that merely starts at the anchor", () => {
      expect(
        isSurfaceOnAnchor(
          { text: "abcdefghijkl", selectionStart: 12, selectionEnd: 4 },
          anchor,
        ),
      ).toBe(false);
    });

    it("rejects the same caret over different text", () => {
      expect(
        isSurfaceOnAnchor(
          { text: "ABCDEFGHIJKL", selectionStart: 12, selectionEnd: 12 },
          anchor,
        ),
      ).toBe(false);
    });

    it("rejects a missing surface and a missing anchor", () => {
      expect(isSurfaceOnAnchor(null, anchor)).toBe(false);
      expect(
        isSurfaceOnAnchor(
          { text: "abcdefghijkl", selectionStart: 12, selectionEnd: 12 },
          null,
        ),
      ).toBe(false);
    });
  });

  describe("the anchor travelling with the suggestion (02/f13)", () => {
    it("reports the text and caret the painted suggestion continues from", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: " continues here",
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl and then some trailing text", 12);
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
      });
      await flushMicrotasks();

      // Not the whole text and not the live caret: the state the request was
      // issued for, which is where a caller must draw and accept the ghost.
      expect(hook?.anchor).toEqual({
        text: "abcdefghijkl and then some trailing text",
        caret: 12,
      });
    });

    it("reports no anchor while no suggestion is painted", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: 1,
        suggestion: null,
      } satisfies AutocompleteSuggestReply);

      expect(hook?.anchor).toBeNull();

      await typeAndSettle("abcdefghijkl");

      expect(hook?.suggestion).toBeNull();
      expect(hook?.anchor).toBeNull();
    });
  });

  describe("what goes on the wire", () => {
    it("sends the text after the caret as the suffix (02/f11)", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: -1,
        suggestion: null,
      } satisfies AutocompleteSuggestReply);

      await act(async () => {
        change("abcdefghijkl and then some trailing text", 12);
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
      });
      await flushMicrotasks();

      expect(sentRequest()).toMatchObject({
        prefix: "abcdefghijkl",
        suffix: " and then some trailing text",
      });
    });

    it("keeps the prefix's tail and the suffix's head when both exceed their caps (02/f11)", async () => {
      requestAutocompleteSuggestion.mockResolvedValue({
        requestId: -1,
        suggestion: null,
      } satisfies AutocompleteSuggestReply);

      // Distinct fill characters on each side of both caps, so a slice taken
      // from the wrong end produces the wrong character rather than merely
      // the wrong length.
      const droppedPrefixHead = "D".repeat(50);
      const keptPrefixTail = "P".repeat(MAX_PREFIX_CHARS_SENT);
      const keptSuffixHead = "S".repeat(MAX_SUFFIX_CHARS_SENT);
      const droppedSuffixTail = "X".repeat(50);
      const caret = droppedPrefixHead.length + keptPrefixTail.length;

      await act(async () => {
        change(
          droppedPrefixHead + keptPrefixTail + keptSuffixHead + droppedSuffixTail,
          caret,
        );
        vi.advanceTimersByTime(GHOST_TEXT_DEBOUNCE_MS);
      });
      await flushMicrotasks();

      expect(sentRequest()).toMatchObject({
        prefix: keptPrefixTail,
        suffix: keptSuffixHead,
      });
    });
  });
});
