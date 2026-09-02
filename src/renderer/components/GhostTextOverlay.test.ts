/**
 * @file GhostTextOverlay.test.ts
 * @description Two kinds of coverage: a source guard pinning that this file
 * never imports `MarkdownView` or uses `dangerouslySetInnerHTML` (the
 * behavioral test below can't prove a negative about what the component
 * *could* render if edited later — the guard is what keeps a future edit
 * from quietly reintroducing either), and a render check that the typed
 * text and the suggestion both land as plain text nodes.
 *
 * Pixel alignment against the textarea's own metrics stays unverifiable here
 * — jsdom has no layout engine — so the scroll-sync coverage below pins the
 * wiring instead: the mirror carries the offset it was handed. Whether that
 * offset lands the ghost on the caret is a `bun run dev` check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GhostTextOverlay } from "./GhostTextOverlay";

const source = readFileSync(join(import.meta.dirname, "GhostTextOverlay.tsx"), "utf-8");

// Comments are stripped before matching — this file's own header explains the
// trap by naming both symbols, so a raw substring search would be satisfied
// by its own documentation and stay green even if the code itself regressed.
// Same technique as `reasoning.test.ts`.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("GhostTextOverlay source guard", () => {
  it("never imports MarkdownView", () => {
    expect(code).not.toContain("MarkdownView");
  });

  it("never uses dangerouslySetInnerHTML", () => {
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("GhostTextOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
  });

  const render = async (props: {
    typed: string;
    suggestion: string | null;
    scrollTop?: number;
  }) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(GhostTextOverlay, { scrollTop: 0, ...props }),
      );
    });
  };

  const mirror = (): HTMLElement | null =>
    container.querySelector("[data-ghost-mirror]");

  it("renders nothing when there is no suggestion", async () => {
    await render({ typed: "hello ", suggestion: null });
    expect(container.textContent).toBe("");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("renders nothing for an empty-string suggestion", async () => {
    await render({ typed: "hello ", suggestion: "" });
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("exposes the suggestion under its own stable seam, separate from the invisible typed mirror", async () => {
    await render({ typed: "The quick ", suggestion: "brown fox jumps" });

    expect(
      container.querySelector("[data-ghost-suggestion]")?.textContent,
    ).toBe("brown fox jumps");
  });

  it("renders the typed text and suggestion as plain text nodes", async () => {
    await render({ typed: "The quick ", suggestion: "brown fox jumps" });

    expect(container.textContent).toBe("The quick brown fox jumps");
    // No markdown ever gets a chance to turn the suggestion into markup.
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders a suggestion containing markdown-like syntax completely literally", async () => {
    await render({
      typed: "click ",
      suggestion: "[here](javascript:alert(1)) and ![x](https://evil.example/x.png)",
    });

    expect(container.textContent).toBe(
      "click [here](javascript:alert(1)) and ![x](https://evil.example/x.png)",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  // 02/f1. Without this the mirror clips at offset zero while "Tab to accept"
  // still shows, so Tab inserts model output the user never saw.
  it("offsets the mirror by the textarea's scrollTop so a scrolled ghost stays in view", async () => {
    await render({ typed: "line ".repeat(80), suggestion: "tail", scrollTop: 96 });

    expect(mirror()?.style.transform).toBe("translateY(-96px)");
  });

  it("applies no offset when the textarea has not scrolled", async () => {
    await render({ typed: "hello ", suggestion: "world", scrollTop: 0 });

    expect(mirror()?.style.transform).toBe("translateY(0px)");
  });
});
