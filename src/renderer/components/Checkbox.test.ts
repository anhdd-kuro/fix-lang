/**
 * @file Checkbox.test.ts
 * @description Behaviour guard for the shared checkbox: the native input must
 * stay in the DOM (only visually hidden) so keyboard/form semantics survive
 * the custom `--primary` box, and `onChange` must report the next state.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders through `react-dom/client` + `act`, the
 * technique already used by `LogsPanel.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (
    props: Parameters<typeof Checkbox>[0],
  ): Promise<void> => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Checkbox, props));
    });
  };

  const input = (): HTMLInputElement => {
    const element = container.querySelector("input");
    if (element === null) {
      throw new Error("Checkbox rendered without a native input");
    }
    return element;
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

  it("renders a real checkbox input reflecting the checked prop", async () => {
    await render({ checked: true, onChange: vi.fn(), label: "Auto-scroll" });

    expect(input().type).toBe("checkbox");
    expect(input().checked).toBe(true);
    expect(container.textContent).toContain("Auto-scroll");
  });

  it("paints the box with the primary color only when checked", async () => {
    await render({ checked: false, onChange: vi.fn(), ariaLabel: "Debug" });

    const box = container.querySelector('span[aria-hidden="true"]');
    expect(box?.className).toContain("peer-checked:bg-primary");
    // The tick is present but transparent while unchecked.
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "opacity-0",
    );
  });

  it("reports the next checked state on toggle", async () => {
    const onChange = vi.fn();
    await render({ checked: false, onChange, label: "Auto-scroll" });

    await act(async () => {
      input().click();
    });

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("names the box via ariaLabel when there is no visible label", async () => {
    await render({ checked: false, onChange: vi.fn(), ariaLabel: "Warn" });

    expect(input().getAttribute("aria-label")).toBe("Warn");
  });

  it("does not fire onChange while disabled", async () => {
    const onChange = vi.fn();
    await render({ checked: false, onChange, label: "Warn", disabled: true });

    await act(async () => {
      input().click();
    });

    expect(input().disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
