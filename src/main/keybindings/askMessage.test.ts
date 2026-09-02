/**
 * @file askMessage.test.ts
 * @description Builds the single user-facing message sent to the model for
 * the Ask AI preset. This exact string is also what lands in history's
 * `original` column, so the expected output is pinned as a literal here
 * rather than recomputed the way the implementation does — a refactor that
 * silently changes the format should fail this test.
 */
import { describe, expect, it } from "vitest";
import { composeAskMessage } from "./askMessage";

describe("composeAskMessage", () => {
  it("returns the question only when context is empty", () => {
    expect(
      composeAskMessage({ question: "What is a closure?", context: "" }),
    ).toBe("What is a closure?");
  });

  it("returns the question only when context is whitespace-only", () => {
    expect(
      composeAskMessage({
        question: "What is a closure?",
        context: "   \n\t  ",
      }),
    ).toBe("What is a closure?");
  });

  it("wraps non-empty context in a delimited block, question outside it", () => {
    expect(
      composeAskMessage({
        question: "Summarize this.",
        context: "The quick brown fox jumps over the lazy dog.",
      }),
    ).toBe(
      "Summarize this.\n\n----- context -----\nThe quick brown fox jumps over the lazy dog.\n----- end context -----",
    );
  });

  it("trims surrounding whitespace on both question and context", () => {
    expect(
      composeAskMessage({
        question: "  Summarize this.  ",
        context: "  padded context  ",
      }),
    ).toBe(
      "Summarize this.\n\n----- context -----\npadded context\n----- end context -----",
    );
  });

  it("returns null for a whitespace-only question, regardless of context", () => {
    expect(
      composeAskMessage({ question: "   ", context: "some context" }),
    ).toBeNull();
    expect(composeAskMessage({ question: "", context: "" })).toBeNull();
    expect(composeAskMessage({ question: "\n\t", context: "" })).toBeNull();
  });
});
