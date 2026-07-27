import {
  act,
  createElement,
  createRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  type ButtonProps,
  type ButtonVariant,
} from "./Button";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Value extends true> = Value;
type _ButtonVariantsAreExact = Assert<
  Equal<
    ButtonVariant,
    "primary" | "secondary" | "outline" | "ghost" | "destructive"
  >
>;
type _ButtonPropsAreExact = Assert<
  Equal<
    ButtonProps,
    ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: ButtonVariant;
    }
  >
>;
type _ButtonHasNoSizeApi = Assert<
  Equal<Extract<"size", keyof ButtonProps>, never>
>;

const sharedBaseClasses = [
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
  "disabled:cursor-not-allowed",
  "disabled:opacity-50",
  "transition-colors",
  "motion-reduce:transition-none",
] as const;

const variantClasses = {
  primary: [
    "bg-primary",
    "text-primary-foreground",
    "[&:where(:enabled:hover)]:bg-primary-hover",
    "[&:where(:enabled:active)]:bg-primary-active",
  ],
  secondary: [
    "bg-secondary",
    "text-secondary-foreground",
    "[&:where(:enabled:hover)]:bg-secondary-hover",
    "[&:where(:enabled:active)]:bg-secondary-active",
  ],
  outline: ["border", "border-current", "bg-transparent", "text-inherit"],
  ghost: [
    "bg-transparent",
    "text-inherit",
    "[&:where(:enabled:hover)]:bg-secondary-hover",
    "[&:where(:enabled:active)]:bg-secondary-active",
  ],
  destructive: [
    "bg-destructive",
    "text-destructive-foreground",
    "[&:where(:enabled:hover)]:bg-destructive-hover",
    "[&:where(:enabled:active)]:bg-destructive-active",
  ],
} as const satisfies Record<ButtonVariant, readonly string[]>;

const variants = Object.keys(variantClasses) as ButtonVariant[];
const interactionClasses = {
  primary: [
    "[&:where(:enabled:hover)]:bg-primary-hover",
    "[&:where(:enabled:active)]:bg-primary-active",
  ],
  secondary: [
    "[&:where(:enabled:hover)]:bg-secondary-hover",
    "[&:where(:enabled:active)]:bg-secondary-active",
  ],
  outline: [],
  ghost: [
    "[&:where(:enabled:hover)]:bg-secondary-hover",
    "[&:where(:enabled:active)]:bg-secondary-active",
  ],
  destructive: [
    "[&:where(:enabled:hover)]:bg-destructive-hover",
    "[&:where(:enabled:active)]:bg-destructive-active",
  ],
} as const satisfies Record<ButtonVariant, readonly string[]>;

describe("Button", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  const render = async (
    props: ComponentProps<typeof Button>,
  ): Promise<HTMLButtonElement> => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Button, props, "Continue"));
    });

    const button = container.querySelector("button");
    if (button === null) {
      throw new Error("Button rendered without a native button");
    }
    return button;
  };

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("defaults to the primary non-submitting button", async () => {
    const button = await render({});

    expect(button.type).toBe("button");
    expect(button.className.split(/\s+/)).toEqual([
      ...sharedBaseClasses,
      ...variantClasses.primary,
    ]);
  });

  it.each(variants)(
    "uses the exact opaque or transparent class contract for %s",
    async (variant) => {
      const button = await render({ variant });

      expect(button.className.split(/\s+/)).toEqual([
        ...sharedBaseClasses,
        ...variantClasses[variant],
      ]);
    },
  );

  it("keeps the exact layout-neutral shared state contract on all five variants", async () => {
    const renderedClassSets: Set<string>[] = [];

    for (const variant of variants) {
      const button = await render({ variant });
      const classSet = new Set(button.classList);
      renderedClassSets.push(classSet);

      for (const className of sharedBaseClasses) {
        expect(classSet.has(className)).toBe(true);
      }

      await act(async () => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
    }

    const sharedClasses = [...renderedClassSets[0]].filter((className) =>
      renderedClassSets.every((classSet) => classSet.has(className)),
    );
    expect(sharedClasses).toEqual(sharedBaseClasses);
  });

  it("forwards explicit type, native props, handlers, and its native ref", async () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const dataProps = { "data-testid": "save-button" };
    const button = await render({
      ...dataProps,
      type: "submit",
      name: "action",
      value: "save",
      form: "settings-form",
      title: "Save changes",
      "aria-label": "Save changes",
      onClick,
      ref,
    });

    expect(button.type).toBe("submit");
    expect(button.name).toBe("action");
    expect(button.value).toBe("save");
    expect(button.getAttribute("form")).toBe("settings-form");
    expect(button.title).toBe("Save changes");
    expect(button.getAttribute("aria-label")).toBe("Save changes");
    expect(button.dataset.testid).toBe("save-button");
    expect(ref.current).toBe(button);

    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the click handler when disabled", async () => {
    const onClick = vi.fn();
    const button = await render({ disabled: true, onClick });

    expect(button.disabled).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets caller geometry and normal color classes take precedence", async () => {
    const button = await render({
      className:
        "px-2 px-4 bg-secondary text-secondary-foreground",
    });

    expect(button.className).toContain("px-4");
    expect(button.className).not.toContain("px-2");
    expect(button.className).toContain("bg-secondary");
    expect(button.classList.contains("bg-primary")).toBe(false);
    expect(button.className).toContain("text-secondary-foreground");
    expect(button.className).not.toContain("text-primary-foreground");
  });

  it("lets caller focus-visible, disabled, and selected-state classes override shared states", async () => {
    const button = await render({
      "aria-selected": true,
      className:
        "focus-visible:ring-4 focus-visible:ring-destructive focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-100 aria-selected:bg-secondary",
    });

    expect(button.getAttribute("aria-selected")).toBe("true");
    expect(button.className).toContain("focus-visible:ring-4");
    expect(button.className).not.toContain("focus-visible:ring-2");
    expect(button.className).toContain("focus-visible:ring-destructive");
    expect(button.className).not.toContain("focus-visible:ring-ring");
    expect(button.className).toContain("focus-visible:ring-offset-0");
    expect(button.className).not.toContain("focus-visible:ring-offset-2");
    expect(button.className).toContain("disabled:cursor-default");
    expect(button.className).not.toContain("disabled:cursor-not-allowed");
    expect(button.className).toContain("disabled:opacity-100");
    expect(button.className).not.toContain("disabled:opacity-50");
    expect(button.className).toContain("aria-selected:bg-secondary");
    expect(button.className).toContain("bg-primary");
  });

  it.each(variants)(
    "keeps caller hover and active classes effective for %s",
    async (variant) => {
      const button = await render({
        variant,
        className: "hover:bg-primary active:bg-destructive",
      });
      const classes = [...button.classList];
      const callerHoverIndex = classes.indexOf("hover:bg-primary");
      const callerActiveIndex = classes.indexOf("active:bg-destructive");

      expect(callerHoverIndex).toBeGreaterThanOrEqual(0);
      expect(callerActiveIndex).toBeGreaterThanOrEqual(0);
      for (const sharedClass of interactionClasses[variant]) {
        const sharedIndex = classes.indexOf(sharedClass);
        expect(sharedIndex).toBeGreaterThanOrEqual(0);
        expect(callerHoverIndex).toBeGreaterThan(sharedIndex);
        expect(callerActiveIndex).toBeGreaterThan(sharedIndex);
        expect(sharedClass).toContain(":where(:enabled:");
      }
    },
  );
});
