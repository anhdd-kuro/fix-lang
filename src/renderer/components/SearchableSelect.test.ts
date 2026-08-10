import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefaultGroupHeading,
  SearchableSelect,
  matchesSearch,
  withDefaultComponents,
} from "./SearchableSelect";
import type { SearchableSelectProps, SearchableOption } from "./SearchableSelect";
import type { GroupHeadingProps, GroupBase } from "react-select";

const option = (value: string, label = value) => ({ value, label });

describe("matchesSearch", () => {
  it("keeps every option for an empty query", () => {
    expect(matchesSearch(option("openai/gpt-5"), "")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "   ")).toBe(true);
  });

  it("ignores separators and case on both sides", () => {
    expect(matchesSearch(option("openai/gpt-5"), "gpt 5")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "GPT-5")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "openaigpt5")).toBe(true);
  });

  it("matches against the label as well as the value", () => {
    expect(matchesSearch(option("m-1", "Claude Opus 4.5"), "opus45")).toBe(true);
  });

  it("never filters out an option with no searchable text at all", () => {
    // `<ModelSelect>`'s inherit row, which would otherwise become unreachable.
    expect(matchesSearch(option("", ""), "gpt 5")).toBe(true);
    expect(matchesSearch(option("", ""), "anything at all")).toBe(true);
  });

  it("rejects options that do not contain the normalized query", () => {
    expect(matchesSearch(option("openai/gpt-5"), "llama")).toBe(false);
    expect(matchesSearch(option("openai/gpt-5"), "gpt6")).toBe(false);
  });

  it("filters grouped options exactly as it filters flat ones", () => {
    const grouped: GroupBase<SearchableOption>[] = [
      { label: "OpenAI", options: [option("openai::gpt-5-mini", "gpt-5-mini")] },
      { label: "Ollama", options: [option("ollama::llama3.2:3b", "llama3.2:3b")] },
    ];
    const flat = grouped.flatMap((group) => group.options);

    expect(flat.filter((entry) => matchesSearch(entry, "gpt 5"))).toEqual([
      grouped[0]?.options[0],
    ]);
    expect(grouped[1]?.options.some((entry) => matchesSearch(entry, "gpt 5"))).toBe(
      false,
    );
  });
});

describe("grouped options", () => {
  it("accepts a mixed flat/grouped array", () => {
    const options: SearchableSelectProps<SearchableOption>["options"] = [
      option("flat-1"),
      { label: "OpenAI", options: [option("openai::gpt-5-mini", "gpt-5-mini")] },
    ];

    const markup = renderToStaticMarkup(
      createElement(SearchableSelect, {
        options,
        value: null,
        onChange: () => undefined,
        noOptionsMessage: "none",
        placeholder: "Select model",
      }),
    );
    expect(markup).toContain("Select model");
  });
});

describe("DefaultGroupHeading", () => {
  const headingProps = (label: string) =>
    ({ data: { label, options: [] } }) as unknown as GroupHeadingProps<
      SearchableOption,
      false,
      GroupBase<SearchableOption>
    >;

  it("renders the group label", () => {
    expect(renderToStaticMarkup(createElement(DefaultGroupHeading, headingProps("OpenAI")))).toContain(
      "OpenAI",
    );
  });

  it("renders nothing for an empty label — the inherit group has no heading", () => {
    expect(DefaultGroupHeading(headingProps(""))).toBeNull();
  });
});

describe("open menu", () => {
  // No `@testing-library/react` is installed, so this renders the real
  // component via `react-dom/client` + `act`, as `ModelSelect.test.ts` does.
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    if (root) {
      const mounted = root;
      await act(async () => {
        mounted.unmount();
      });
    }
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const open = async (
    options: SearchableSelectProps<SearchableOption>["options"],
  ): Promise<HTMLDivElement> => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const mounted = root;
    const target = container;
    await act(async () => {
      mounted.render(
        createElement(SearchableSelect, {
          options,
          value: null,
          onChange: () => undefined,
          noOptionsMessage: "No options",
          placeholder: "Select...",
        }),
      );
    });
    await act(async () => {
      target
        .querySelector('[class*="-control"]')
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    return target;
  };

  const openMenu = async (): Promise<HTMLElement[]> => {
    const target = await open([
      option("correction", "Correction"),
      option("summarize", "Summarize"),
    ]);
    return [...target.querySelectorAll<HTMLElement>('[role="option"]')];
  };

  it("paints the focused row from the theme, not react-select's own blue", async () => {
    const [focused] = await openMenu();
    expect(focused).toBeDefined();
    const style = getComputedStyle(focused as HTMLElement);
    // react-select's `optionCSS` would put #DEEBFF here and inherit the text
    // colour, which is what made a themed foreground unreadable on hover.
    expect(style.backgroundColor).toBe("var(--secondary)");
    expect(style.color).toBe("var(--secondary-foreground)");
  });

  it("leaves an unfocused row transparent so the menu colour shows through", async () => {
    const options = await openMenu();
    const resting = options[1];
    expect(resting).toBeDefined();
    // jsdom serializes `transparent` as its rgba() equivalent.
    expect(getComputedStyle(resting as HTMLElement).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
  });

  it("keeps the empty-result message on the menu's own paired foreground", async () => {
    // It renders INSIDE the `popover` menu, where `muted-foreground` falls to
    // 2.03:1 in `slack-ochin` — and it is the only feedback a matchless search
    // gets, so it may not be the token that fails there.
    const target = await open([]);
    const menu = target.querySelector('[class*="-menu"]');
    const message = [...target.querySelectorAll<HTMLElement>("div")]
      .reverse()
      .find((node) => node.textContent === "No options");

    expect(menu).toBeDefined();
    expect(message).toBeDefined();
    expect(getComputedStyle(menu as HTMLElement).backgroundColor).toBe("var(--popover)");
    expect(getComputedStyle(message as HTMLElement).color).toBe(
      "var(--popover-foreground)",
    );
  });
});

describe("withDefaultComponents", () => {
  it("supplies a themed GroupHeading by default", () => {
    expect(withDefaultComponents().GroupHeading).toBe(DefaultGroupHeading);
  });

  it("lets a caller's own GroupHeading win", () => {
    const Custom = () => null;
    expect(withDefaultComponents({ GroupHeading: Custom }).GroupHeading).toBe(Custom);
  });

  it("keeps the caller's other sub-components", () => {
    const Option = () => null;
    const merged = withDefaultComponents({ Option });
    expect(merged.Option).toBe(Option);
    expect(merged.GroupHeading).toBe(DefaultGroupHeading);
  });
});
