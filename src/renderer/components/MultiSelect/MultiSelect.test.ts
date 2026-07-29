/**
 * @file MultiSelect/MultiSelect.test.ts
 * @description Guards the checkbox-dropdown contract: toggling adds/removes a
 * value without closing the popover (multi-select would be unusable otherwise),
 * the next selection keeps `options` order, and outside pointerdown / Escape
 * both dismiss it.
 *
 * Rendered via `react-dom/client` + `act` — no `@testing-library/react` is
 * installed (Vitest only collects `**\/*.test.ts`).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelect, toggleSelection } from ".";

const OPTIONS = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];

describe("toggleSelection", () => {
  it("adds a value in options order, not click order", () => {
    expect(toggleSelection(OPTIONS, ["error"], "info")).toEqual([
      "info",
      "error",
    ]);
  });

  it("removes an already-selected value", () => {
    expect(toggleSelection(OPTIONS, ["info", "error"], "info")).toEqual([
      "error",
    ]);
  });
});

describe("MultiSelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (
    props: Partial<Parameters<typeof MultiSelect>[0]> = {},
  ): Promise<ReturnType<typeof vi.fn>> => {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(MultiSelect, {
          options: OPTIONS,
          selected: [],
          onChange,
          triggerLabel: "All levels",
          ariaLabel: "Log level",
          ...props,
        }),
      );
    });
    return onChange;
  };

  const trigger = (): HTMLButtonElement => {
    const element = container.querySelector("button");
    if (element === null) {
      throw new Error("MultiSelect rendered without a trigger");
    }
    return element;
  };

  const optionInputs = (): HTMLInputElement[] => [
    ...container.querySelectorAll<HTMLInputElement>('[role="group"] input'),
  ];

  const openMenu = async (): Promise<void> => {
    await act(async () => {
      trigger().click();
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

  it("renders the summary label and no popover until opened", async () => {
    await render();

    expect(trigger().textContent).toContain("All levels");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-haspopup")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();

    await openMenu();

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const popup = container.querySelector<HTMLElement>('[role="group"]');
    expect(popup).not.toBeNull();
    expect(trigger().getAttribute("aria-controls")).toBe(popup?.id);
    expect(popup?.getAttribute("aria-label")).toBe("Log level");
    expect(optionInputs()).toHaveLength(OPTIONS.length);
  });

  it("checks the boxes matching the current selection", async () => {
    await render({ selected: ["warn", "error"] });
    await openMenu();

    expect(optionInputs().map((input) => input.checked)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("reports the next selection and stays open across toggles", async () => {
    const onChange = await render({ selected: ["error"] });
    await openMenu();

    await act(async () => {
      optionInputs()[1]?.click();
    });

    expect(onChange).toHaveBeenCalledWith(["info", "error"]);
    // A closing popover would make picking a second level impossible.
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });

  it("closes on outside pointerdown", async () => {
    await render();
    await openMenu();

    await act(async () => {
      document.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it("keeps the popover open when the pointerdown lands inside", async () => {
    await render();
    await openMenu();

    await act(async () => {
      trigger().dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await render();
    await openMenu();

    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps the shared select semantics alongside trigger geometry", async () => {
    await render();

    const classes = [
      "border",
      "border-card-control-border",
      "bg-input",
      "text-foreground",
      "flex",
      "w-full",
      "items-center",
      "justify-between",
      "gap-2",
      "rounded-md",
      "px-2",
      "py-1.5",
      "text-sm",
      "hover:border-ring",
    ];
    for (const className of classes) {
      expect(trigger().classList).toContain(className);
    }
    expect(trigger().classList).not.toContain("border-current");
  });
});
