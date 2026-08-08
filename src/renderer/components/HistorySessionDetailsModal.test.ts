import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
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
  reasoningEffort: "medium",
});

describe("HistorySessionDetailsModal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: Mock<() => void>;

  const render = async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn(() => vi.fn()),
      },
    });
    onClose = vi.fn();
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
            onClose,
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
    expect(chat).toContain("Prompt tokens: 10");
    expect(chat).toContain("Completion tokens: 2");
    expect(chat).toContain("Reasoning effort: Medium");
  });

  it("keeps a stable 80vh box with the tabpanel as the only scroll region", async () => {
    await render();

    const card = container.firstElementChild?.firstElementChild;
    const cardClasses = card?.className.split(/\s+/) ?? [];
    expect(cardClasses).toEqual(expect.arrayContaining(["h-[80vh]", "max-h-[80vh]"]));
    expect(cardClasses).toEqual(expect.arrayContaining(["flex", "flex-col", "overflow-hidden"]));

    const panelClasses =
      container.querySelector('[role="tabpanel"]')?.className.split(/\s+/) ?? [];
    expect(panelClasses).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-auto"]),
    );
  });

  it("closes when the overlay is clicked", async () => {
    await render();

    const overlay = container.firstElementChild;
    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when the modal body is clicked", async () => {
    await render();

    const panel = container.querySelector('[role="tabpanel"]');
    await act(async () => {
      panel?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      panel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when a selection drag started inside is released on the overlay", async () => {
    await render();

    const overlay = container.firstElementChild;
    const panel = container.querySelector('[role="tabpanel"]');
    await act(async () => {
      panel?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when Escape is pressed", async () => {
    await render();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
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
