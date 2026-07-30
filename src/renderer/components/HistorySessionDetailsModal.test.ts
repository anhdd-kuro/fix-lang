import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HistorySessionDetailsModal from "./HistorySessionDetailsModal";
import { I18nProvider } from "../i18n/I18nProvider";

const sessionJson = JSON.stringify({
  messages: [
    { role: "system", content: "System prompt" },
    { role: "user", content: "User prompt" },
  ],
  model: "gpt-4.1-mini",
  provider: "openai",
  responses: ["Assistant response"],
  promptTokens: 10,
  completionTokens: 2,
});

describe("HistorySessionDetailsModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn(() => vi.fn()),
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(HistorySessionDetailsModal, {
            isOpen: true,
            sessionJson,
            onClose: vi.fn(),
          }),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("switches between JSON and chat views", async () => {
    await render();

    expect(container.textContent).toContain("View as JSON");
    expect(container.textContent).toContain("View as chat");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      '"messages"',
    );

    const chatTab = [...container.querySelectorAll('button[role="tab"]')].find(
      (button) => button.textContent === "View as chat",
    );
    await act(async () => {
      chatTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const chat = container.querySelector('[role="tabpanel"]')?.textContent;
    expect(chat).toContain("System");
    expect(chat).toContain("User");
    expect(chat).toContain("Assistant");
    expect(chat?.match(/System prompt/g)).toHaveLength(1);
  });

  it("moves between tabs with the arrow keys", async () => {
    await render();

    const tabList = container.querySelector('[role="tablist"]');
    await act(async () => {
      tabList?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    const chatTab = [...container.querySelectorAll('button[role="tab"]')].find(
      (button) => button.textContent === "View as chat",
    );
    expect(chatTab?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(chatTab);
  });
});
