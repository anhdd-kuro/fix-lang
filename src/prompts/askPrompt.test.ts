/**
 * @file askPrompt.test.ts
 * @description Guards the *shape* of the "Ask AI" built-in preset prompt: its
 * id, that the `?raw` asset is bundled and pre-trimmed, and that it is
 * reachable through the `~/prompts` barrel.
 *
 * HONEST LIMIT: there is no LLM-in-the-loop harness in this repo, so prompt
 * *semantics* are untestable here. Every content assertion below is a marker
 * assertion: it proves a phrase is present in the prompt text, nothing more. A
 * green run does NOT mean the prompt behaves well, only that the required
 * behaviours are still mentioned. Judge the prompt by reading it.
 *
 * MARKER DISCIPLINE: a marker must match the sentence it is meant to pin and
 * nowhere else, otherwise deleting that sentence leaves the suite green while
 * the instruction is gone. Every marker below is anchored to a phrase unique
 * to its target sentence; before adding one, grep the prompt for it — more
 * than one hit means it does not guard what its test name claims.
 *
 * The static import below IS the "reachable through the barrel" assertion: a
 * named ESM import of a constant the barrel does not re-export fails the
 * whole module at load.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ASK_PRESET_ID, DEFAULT_ASK_PRESET_PROMPT } from "~/prompts";

const expectAllPresent = (text: string, markers: readonly RegExp[]) => {
  const missing = markers.filter((marker) => !marker.test(text));
  expect(missing.map(String)).toEqual([]);
};

const expectSingleHit = (text: string, marker: RegExp) => {
  const hits = text.match(new RegExp(marker.source, "gi")) ?? [];
  expect(hits.length).toBe(1);
};

describe("ask preset id", () => {
  it("uses the exact id written into user config", () => {
    expect(DEFAULT_ASK_PRESET_ID).toBe("ask");
  });
});

describe("bundled ask prompt asset", () => {
  const prompt = DEFAULT_ASK_PRESET_PROMPT;

  it("is non-empty", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("is already trimmed", () => {
    expect(prompt).toBe(prompt.trim());
  });

  it("is reachable via a static named import from ~/prompts", () => {
    expect(prompt).toContain("App locale:");
  });
});

describe("ask prompt instructs every required behaviour", () => {
  const prompt = DEFAULT_ASK_PRESET_PROMPT;

  it("states the assistant's role", () => {
    expectAllPresent(prompt, [
      /You are a knowledgeable expert assistant/i,
    ]);
    expectSingleHit(prompt, /You are a knowledgeable expert assistant/i);
  });

  it("answers in the app locale via the trailing directive, without naming a specific language", () => {
    expectAllPresent(prompt, [
      /App locale: <code>/i,
      /that code, not the language the question happens to be written in, is the language you must answer in/i,
    ]);
    expectSingleHit(
      prompt,
      /that code, not the language the question happens to be written in, is the language you must answer in/i,
    );
    expect(prompt).not.toMatch(/\bEnglish\b/i);
    expect(prompt).not.toMatch(/\bJapanese\b/i);
  });

  it("formats every response as GitHub Flavored Markdown", () => {
    expectAllPresent(prompt, [/GitHub Flavored Markdown/i]);
    expectSingleHit(prompt, /GitHub Flavored Markdown/i);
  });

  it("defaults to concise answers, expanding only when more detail is requested", () => {
    expectAllPresent(prompt, [
      /Default to a concise answer that directly resolves the question/i,
      /explicitly asks for more detail, more depth, or a step-by-step walkthrough/i,
    ]);
    expectSingleHit(
      prompt,
      /Default to a concise answer that directly resolves the question/i,
    );
  });

  it("never fabricates an answer and admits not knowing", () => {
    expectAllPresent(prompt, [
      /Never fabricate an answer/i,
      /say plainly that you do not know rather than guessing or inventing a plausible-sounding answer/i,
    ]);
    expectSingleHit(prompt, /Never fabricate an answer/i);
  });

  it("wraps code in fenced blocks tagged with the original language", () => {
    expectAllPresent(prompt, [
      /wrap it in a fenced code block tagged with the original language of that code/i,
      /never present code as untagged plain text/i,
    ]);
    expectSingleHit(
      prompt,
      /wrap it in a fenced code block tagged with the original language of that code/i,
    );
  });

  it("treats attached context as the subject of the question", () => {
    expectAllPresent(prompt, [
      /treat that attached context as the subject the question is about, not as incidental background/i,
    ]);
    expectSingleHit(
      prompt,
      /treat that attached context as the subject the question is about, not as incidental background/i,
    );
  });
});
