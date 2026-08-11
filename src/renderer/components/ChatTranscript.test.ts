/**
 * @file ChatTranscript.test.ts
 * @description Pins the shared transcript renderer's three shapes (`system`
 * folds, `user` right bubble, everything else left bubble), the optional meta
 * strip, and the two things the caller owns: the role label and — per message —
 * how the body renders. The last one is the reason this component exists in
 * more than one window: history renders every message as plain text in a
 * `<pre>`, the Ask result's answer is GFM markdown, and hardcoding either would
 * break the other.
 *
 * `.test.ts`, not `.test.tsx`: vitest only collects the former here, so the tree
 * is built with `createElement` rather than JSX.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatTranscript,
  type ChatTranscriptMessage,
  type ChatTranscriptMetaItem,
} from "./ChatTranscript";

describe("ChatTranscript", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (props: {
    messages: ChatTranscriptMessage[];
    ariaLabel?: string;
    meta?: ChatTranscriptMetaItem[];
  }) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(ChatTranscript, {
          ariaLabel: "Transcript",
          ...props,
        }),
      );
    });
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
  });

  const section = (id: string): HTMLElement =>
    container.querySelector(`[data-chat-section="${id}"]`) as HTMLElement;

  it("renders a system message as a fold that starts closed, under an uppercase summary", async () => {
    await render({
      messages: [
        {
          role: "system",
          label: "System prompt",
          content: "You are a careful editor.",
          sectionId: "system",
        },
      ],
    });

    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    const summary = details.querySelector("summary") as HTMLElement;
    expect(summary.textContent).toBe("System prompt …");
    expect(summary.className).toContain("uppercase");

    expect(details.querySelector("pre")?.textContent).toBe(
      "You are a careful editor.",
    );
    // The fold is not a bubble: no justification, no `max-w-[80%]` body.
    expect(section("system").className).toBe("");
  });

  it("renders a user message as a right-hand primary bubble", async () => {
    await render({
      messages: [
        { role: "user", label: "Question", content: "Why?", sectionId: "q" },
      ],
    });

    const item = section("q");
    expect(item.className).toContain("justify-end");
    const bubble = item.querySelector("div") as HTMLElement;
    expect(bubble.className).toContain("bg-primary");
    expect(bubble.className).toContain("max-w-[80%]");
    expect(bubble.querySelector("h3")?.textContent).toBe("Question");
    expect(bubble.querySelector("pre")?.textContent).toBe("Why?");
  });

  it.each(["assistant", "reasoning", "tool"])(
    "renders a %s message as a left-hand bordered bubble",
    async (role) => {
      await render({
        messages: [
          { role, label: role, content: "body", sectionId: "message" },
        ],
      });

      const item = section("message");
      expect(item.className).toContain("justify-start");
      const bubble = item.querySelector("div") as HTMLElement;
      expect(bubble.className).not.toContain("bg-primary");
      expect(bubble.className).toContain("border");
    },
  );

  it("renders content through React's own escaping, never as HTML", async () => {
    const hostile = "**bold** <b>tag</b> [link](http://example.com)";
    await render({
      messages: [
        { role: "assistant", label: "Answer", content: hostile },
        { role: "system", label: "System", content: hostile },
      ],
    });

    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelectorAll("pre")).toHaveLength(2);
    expect(container.textContent).toContain(hostile);
  });

  it("lets each message pick its own body renderer, leaving the others on plain text", async () => {
    await render({
      messages: [
        {
          role: "user",
          label: "Question",
          content: "**not markdown**",
          sectionId: "plain",
        },
        {
          role: "assistant",
          label: "Answer",
          content: "rendered",
          sectionId: "custom",
          renderContent: (content) =>
            createElement("em", { "data-custom-body": "" }, content),
        },
      ],
    });

    expect(section("plain").querySelector("pre")?.textContent).toBe(
      "**not markdown**",
    );
    const custom = section("custom");
    expect(custom.querySelector("pre")).toBeNull();
    expect(custom.querySelector("[data-custom-body]")?.textContent).toBe(
      "rendered",
    );
  });

  it("names the list for assistive tech and emits data-chat-section only where asked", async () => {
    await render({
      ariaLabel: "Ask AI conversation",
      messages: [
        { role: "user", label: "Question", content: "a", sectionId: "q" },
        { role: "assistant", label: "Answer", content: "b" },
      ],
    });

    const list = container.querySelector("ol") as HTMLElement;
    expect(list.getAttribute("aria-label")).toBe("Ask AI conversation");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("[data-chat-section]")).toHaveLength(1);
    expect(list.children[1].hasAttribute("data-chat-section")).toBe(false);
  });

  it("renders the meta strip as screen-reader terms over visible descriptions", async () => {
    await render({
      meta: [
        { term: "Prompt tokens: 0", description: "Prompt tokens: 10" },
        { term: "Completion tokens: 0", description: "Completion tokens: 2" },
      ],
      messages: [{ role: "user", label: "Question", content: "a" }],
    });

    const list = container.querySelector("dl") as HTMLElement;
    expect(list).toBeTruthy();
    expect([...list.querySelectorAll("dt")].map((dt) => dt.className)).toEqual([
      "sr-only",
      "sr-only",
    ]);
    expect([...list.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(
      ["Prompt tokens: 10", "Completion tokens: 2"],
    );
  });

  it("renders no meta strip when the caller has none — the Ask windows have no token counts", async () => {
    await render({
      messages: [{ role: "user", label: "Question", content: "a" }],
    });

    expect(container.querySelector("dl")).toBeNull();
  });
});
