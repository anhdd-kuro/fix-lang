/**
 * @file index.test.ts
 * @description Drives `AskResultWindow` with `react-dom/client` + `act`,
 * following `CorrectionResultWindow/index.test.ts`. Covers: GFM (a table and
 * a fenced code block) reaching the DOM as real `<table>` / `<pre><code>`
 * elements; Copy carrying the raw markdown string (never the rendered text);
 * Close invoking the close bridge; and the snapshotted `markdown` flag being
 * honoured (plain text renders literally, without going through
 * `react-markdown`, when `markdown` is `false`). Also covers the layout
 * contract: the footer copy control carries no icon, the sections render in
 * input > question > answer order with the input block absent entirely on an
 * empty selection, and input/question clamp to 3 lines until folded open while
 * the answer never clamps.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AskResultPayload } from "~/shared/ask";
import { AskResultWindow } from "./index";

const tEn = createTranslator("en");

type ElectronApiMock = {
  onAskResultData: ReturnType<typeof vi.fn>;
  signalAskResultReady: ReturnType<typeof vi.fn>;
  closeAskResultWindow: ReturnType<typeof vi.fn>;
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

const GFM_MARKDOWN = [
  "| Col A | Col B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```ts",
  "const x = 1;",
  "```",
].join("\n");

describe("AskResultWindow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payloadListener: ((payload: AskResultPayload) => void) | undefined;
  let api: ElectronApiMock;

  const render = async () => {
    api = {
      onAskResultData: vi.fn(
        (callback: (payload: AskResultPayload) => void) => {
          payloadListener = callback;
          return vi.fn();
        },
      ),
      signalAskResultReady: vi.fn(),
      closeAskResultWindow: vi.fn(),
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
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(AskResultWindow)),
      );
    });
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
    payloadListener = undefined;
    vi.restoreAllMocks();
  });

  it("renders nothing until an ask-result payload arrives", async () => {
    await render();

    expect(container.textContent).toBe("");
    expect(api.signalAskResultReady).toHaveBeenCalledTimes(1);
  });

  it("renders a GFM table and fenced code block as real <table> / <pre><code> elements", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "Show me a table and code",
        answer: GFM_MARKDOWN,
        markdown: true,
      });
    });

    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelectorAll("td")).toHaveLength(2);

    const codeBlock = container.querySelector("pre > code");
    expect(codeBlock).toBeTruthy();
    expect(codeBlock?.textContent).toContain("const x = 1;");
  });

  it("renders plain text without markdown rendering when markdown is false", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "What is 2+2?",
        answer: "**4**",
        markdown: false,
      });
    });

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**4**");
  });

  it("shows the asked question under the question label", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "What does this mean?",
        answer: "It means...",
        markdown: false,
      });
    });

    expect(container.textContent).toContain(
      tEn("notifications.window.askResult.questionLabel"),
    );
    expect(container.textContent).toContain("What does this mean?");
  });

  it("Copy carries the raw markdown string, not the rendered text", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "Show me a table and code",
        answer: GFM_MARKDOWN,
        markdown: true,
      });
    });

    const copyButton = container.querySelector(
      `[aria-label="${tEn("common.copy")}"]`,
    ) as HTMLButtonElement;
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GFM_MARKDOWN);
  });

  it("Escape closes the window regardless of which element has focus (06/f2)", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "q",
        answer: "a",
        markdown: false,
      });
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

    expect(api.closeAskResultWindow).toHaveBeenCalledTimes(1);
  });

  it("does not leak react-markdown's node prop onto the DOM (06/f4)", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "Show me a link",
        answer: "[text](http://example.com) and `code`",
        markdown: true,
      });
    });

    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.hasAttribute("node")).toBe(false);

    const inlineCode = container.querySelector("code");
    expect(inlineCode).toBeTruthy();
    expect(inlineCode?.hasAttribute("node")).toBe(false);
  });

  it("the footer copy control renders no icon while keeping its label", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "q",
        answer: "a",
        markdown: false,
      });
    });

    const copyButton = container.querySelector(
      `[aria-label="${tEn("common.copy")}"]`,
    ) as HTMLButtonElement;
    expect(copyButton).toBeTruthy();
    expect(copyButton.querySelector("svg")).toBeNull();
    expect(copyButton.textContent).toContain(tEn("common.copy"));
  });

  it("renders the sections in order input, question, answer", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "What does this mean?",
        answer: "It means...",
        markdown: false,
        input: "the selected passage",
      });
    });

    expect(
      [...container.querySelectorAll("[data-ask-section]")].map((element) =>
        element.getAttribute("data-ask-section"),
      ),
    ).toEqual(["input", "question", "answer"]);
    expect(container.textContent).toContain(
      tEn("notifications.window.askResult.inputLabel"),
    );
    expect(container.textContent).toContain("the selected passage");
  });

  it("omits the input section entirely when the selection was empty", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "Just a question",
        answer: "The answer",
        markdown: false,
        input: "",
      });
    });

    expect(container.querySelector('[data-ask-section="input"]')).toBeNull();
    expect(container.textContent).not.toContain(
      tEn("notifications.window.askResult.inputLabel"),
    );
    expect(
      [...container.querySelectorAll("[data-ask-section]")].map((element) =>
        element.getAttribute("data-ask-section"),
      ),
    ).toEqual(["question", "answer"]);
  });

  it.each(["   ", "\n\n"])(
    "omits the input section when the selection is whitespace only: %j",
    async (input) => {
      await render();
      await act(async () => {
        payloadListener?.({
          question: "Just a question",
          answer: "The answer",
          markdown: false,
          input,
        });
      });

      expect(container.querySelector('[data-ask-section="input"]')).toBeNull();
      expect(container.textContent).not.toContain(
        tEn("notifications.window.askResult.inputLabel"),
      );
      expect(
        [...container.querySelectorAll("[data-ask-section]")].map((element) =>
          element.getAttribute("data-ask-section"),
        ),
      ).toEqual(["question", "answer"]);
    },
  );

  it("omits the input section when the payload carries no input at all", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "Just a question",
        answer: "The answer",
        markdown: false,
      });
    });

    expect(container.querySelector('[data-ask-section="input"]')).toBeNull();
  });

  it("clamps the input and question to 3 lines and unclamps them on the fold control", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "What does this mean?",
        answer: "It means...",
        markdown: false,
        input: "the selected passage",
      });
    });

    for (const sectionId of ["input", "question"]) {
      const section = container.querySelector(
        `[data-ask-section="${sectionId}"]`,
      ) as HTMLElement;
      const body = section.querySelector("[data-ask-text]") as HTMLElement;
      expect(body.className).toContain("line-clamp-3");

      const toggle = [...section.querySelectorAll("button")].find(
        (button) =>
          button.textContent ===
          tEn("notifications.window.askResult.expand"),
      );
      expect(toggle).toBeTruthy();

      await act(async () => {
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(body.className).not.toContain("line-clamp-3");
      expect(
        [...section.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
      ).toContain(tEn("notifications.window.askResult.collapse"));
    }
  });

  it("never clamps the answer", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "q",
        answer: "a",
        markdown: false,
        input: "selection",
      });
    });

    const answerSection = container.querySelector(
      '[data-ask-section="answer"]',
    ) as HTMLElement;
    expect(answerSection.className).not.toContain("line-clamp");
    expect(answerSection.querySelector(".line-clamp-3")).toBeNull();
  });

  it("Close invokes the close bridge", async () => {
    await render();
    await act(async () => {
      payloadListener?.({
        question: "q",
        answer: "a",
        markdown: false,
      });
    });

    const closeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("common.close"),
    );
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.closeAskResultWindow).toHaveBeenCalledTimes(1);
  });
});
