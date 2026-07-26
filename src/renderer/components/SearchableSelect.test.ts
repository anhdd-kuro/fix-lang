import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
