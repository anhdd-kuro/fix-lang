import { describe, expect, it } from "vitest";
import { stripEchoedInputLabel } from "./strip-echoed-input-label";

describe("stripEchoedInputLabel", () => {
  it("removes an echoed 'Input:' line the source text never had", () => {
    expect(stripEchoedInputLabel("Input:\n- Fixed line.", "- fixd line.")).toBe(
      "- Fixed line.",
    );
  });

  it("handles CRLF, leading whitespace and trailing spaces on the label", () => {
    expect(stripEchoedInputLabel("  Input:  \r\nHello.", "helo")).toBe(
      "Hello.",
    );
  });

  it("removes an echoed 'Draft prompt:' label", () => {
    expect(stripEchoedInputLabel("Draft prompt:\nDo X.", "do x")).toBe("Do X.");
  });

  it("keeps an inline 'Input: …' — that is usually real content", () => {
    expect(stripEchoedInputLabel("Input: a string.", "what is x?")).toBe(
      "Input: a string.",
    );
  });

  it("removes bold, fullwidth-colon and spaced variants", () => {
    expect(stripEchoedInputLabel("**Input:**\nHi.", "hi")).toBe("Hi.");
    expect(stripEchoedInputLabel("Input：\nHi.", "hi")).toBe("Hi.");
    expect(stripEchoedInputLabel("Input :\nHi.", "hi")).toBe("Hi.");
  });

  it("keeps the label when the user's own text started with it", () => {
    expect(
      stripEchoedInputLabel("Input:\nthe field.", "input:\nteh field"),
    ).toBe("Input:\nthe field.");
  });

  it("leaves a label that is not at the start untouched", () => {
    expect(stripEchoedInputLabel("Hello.\nInput:\nx", "helo")).toBe(
      "Hello.\nInput:\nx",
    );
  });

  it("does not strip words that merely start with the label", () => {
    expect(stripEchoedInputLabel("Inputs: a, b", "inputs a b")).toBe(
      "Inputs: a, b",
    );
  });
});
