/**
 * @file SegmentedControl.test.ts
 * @description Behaviour of the shared segmented-control pill group.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

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

const buttons = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll("button"));

const group = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[role="group"]');
  if (!el) throw new Error("no role=group container rendered");
  return el;
};

describe("SegmentedControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onChange: ReturnType<typeof vi.fn>;

  const mount = async (value: "a" | "b" = "a") => {
    onChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(SegmentedControl, {
          value,
          onChange,
          ariaLabel: "Example group",
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ],
        }),
      );
    });
    await waitForUi();
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders one button per option inside a labelled group", async () => {
    await mount("a");

    expect(group(container).getAttribute("aria-label")).toBe("Example group");
    expect(buttons(container).map((b) => b.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("marks only the active option as pressed", async () => {
    await mount("b");

    const pressed = buttons(container)
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);

    expect(pressed).toEqual(["Beta"]);
  });

  it("requests a change when an inactive option is clicked", async () => {
    await mount("a");

    const beta = buttons(container).find((b) => b.textContent === "Beta");
    if (!beta) throw new Error("Beta button not rendered");
    await click(beta);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("does not re-request the value already active", async () => {
    await mount("a");

    const alpha = buttons(container).find((b) => b.textContent === "Alpha");
    if (!alpha) throw new Error("Alpha button not rendered");
    await click(alpha);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("forwards lang to option buttons when provided", async () => {
    await act(async () => {
      root.render(
        createElement(SegmentedControl, {
          value: "en",
          onChange: vi.fn(),
          ariaLabel: "Language",
          options: [
            { value: "en", label: "English", lang: "en" },
            { value: "ja", label: "日本語", lang: "ja" },
          ],
        }),
      );
    });
    await waitForUi();

    expect(buttons(container).map((b) => b.getAttribute("lang"))).toEqual([
      "en",
      "ja",
    ]);
  });
});
