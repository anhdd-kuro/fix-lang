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
 * nothing; Escape cancels; the context chip renders only when context is
 * non-empty, with the character count interpolated through `t()`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AskInputPayload } from "~/features/ask/shared/ask";
import { AskInputWindow } from "./index";

const tEn = createTranslator("en");

type ElectronApiMock = {
  onAskInputData: ReturnType<typeof vi.fn>;
  signalAskInputReady: ReturnType<typeof vi.fn>;
  submitAskInput: ReturnType<typeof vi.fn>;
  cancelAskInput: ReturnType<typeof vi.fn>;
  getTheme: ReturnType<typeof vi.fn>;
  onThemeChanged: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
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

describe("AskInputWindow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payloadListener: ((payload: AskInputPayload) => void) | undefined;
  let api: ElectronApiMock;

  const render = async () => {
    api = {
      onAskInputData: vi.fn((callback: (payload: AskInputPayload) => void) => {
        payloadListener = callback;
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

  const type = async (value: string) => {
    await act(async () => {
      const el = textarea();
      nativeTextareaValueSetter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
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

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    payloadListener = undefined;
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
});
