/**
 * @file selectedText.test.ts
 * @description Tests for parsing the `STATUS \t ROLE \t TEXT \t EOT` line the
 * AX-selected-text AppleScript prints. Pure unit tests — no Electron, no
 * osascript, no mocks.
 *
 * Every fixture here is a frame the real script can actually emit. That is not
 * a style preference: the secure-field guard was once green against a fixture
 * carrying `AXSecureTextField` in the ROLE field, which the script never puts
 * there (a secure field's role is the plain `AXTextField`), so the guard was
 * dead code and the tests could not see it. The `SECURE` frames below were
 * captured from a live osascript run against a real macOS secure text field.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSelectedTextResult } from "./selectedText";

describe("parseSelectedTextResult", () => {
  it("parses a plain OK read", () => {
    expect(parseSelectedTextResult("OK\tAXTextField\thello world\tEOT\n")).toEqual({
      status: "ok",
      role: "AXTextField",
      selectedText: "hello world",
      permissionDenied: false,
    });
  });

  it("preserves tabs embedded inside the selection", () => {
    expect(parseSelectedTextResult("OK\tAXTextArea\ta\tb\tc\tEOT\n")).toEqual({
      status: "ok",
      role: "AXTextArea",
      selectedText: "a\tb\tc",
      permissionDenied: false,
    });
  });

  it("preserves newlines embedded inside the selection", () => {
    expect(parseSelectedTextResult("OK\tAXTextArea\tline1\nline2\tEOT\n")).toEqual({
      status: "ok",
      role: "AXTextArea",
      selectedText: "line1\nline2",
      permissionDenied: false,
    });
  });

  it("preserves leading and trailing whitespace byte-for-byte", () => {
    expect(parseSelectedTextResult("OK\tAXTextField\t  padded  \tEOT\n")).toEqual({
      status: "ok",
      role: "AXTextField",
      selectedText: "  padded  ",
      permissionDenied: false,
    });
  });

  it("does not strip control characters from the selection", () => {
    // Deliberately NOT reusing activeApp's C0/C1-stripping logic: unlike an
    // app name, a control character can be part of what the user selected.
    expect(parseSelectedTextResult("OK\tAXTextField\ta\x00b\tEOT\n")).toEqual({
      status: "ok",
      role: "AXTextField",
      selectedText: "a\x00b",
      permissionDenied: false,
    });
  });

  it("works without a trailing newline", () => {
    expect(parseSelectedTextResult("OK\tAXTextField\thi\tEOT")).toEqual({
      status: "ok",
      role: "AXTextField",
      selectedText: "hi",
      permissionDenied: false,
    });
  });

  it("maps NOSEL to empty", () => {
    expect(parseSelectedTextResult("NOSEL\tAXTextField\t\tEOT\n")).toEqual({
      status: "empty",
      role: "AXTextField",
      selectedText: "",
      permissionDenied: false,
    });
  });

  it("maps NOELEM to unavailable", () => {
    expect(parseSelectedTextResult("NOELEM\t\t\tEOT\n")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
  });

  // The frame the live script emits for a real secure field: the script
  // decided on AXSubrole, so ROLE carries the honest plain AXTextField and the
  // TEXT field is empty because AXSelectedText was never evaluated at all.
  it("maps the script's SECURE frame to secure, on a plain AXTextField role", () => {
    expect(parseSelectedTextResult("SECURE\tAXTextField\t\tEOT\n")).toEqual({
      status: "secure",
      role: "AXTextField",
      selectedText: "",
      permissionDenied: false,
    });
  });

  // The consumer (`keybindings/selectionSource.ts`) checks `status === "secure"`
  // BEFORE `status === "ok"`, on purpose, as its own guard against a producer
  // that paired `status: "secure"` with a non-empty `selectedText`. That
  // consumer-side check is a second line of defence, not the only one — this
  // parser must still never let a secure result carry text or an "ok" status,
  // even if a future script edit started putting the field contents in the
  // frame.
  it("keeps a SECURE frame secure and text-free even if the frame carried text", () => {
    const result = parseSelectedTextResult("SECURE\tAXTextField\tsecretpw\tEOT\n");

    expect(result.status).toBe("secure");
    expect(result.selectedText).toBe("");
    expect(result).toEqual({
      status: "secure",
      role: "AXTextField",
      selectedText: "",
      permissionDenied: false,
    });
  });

  // Backstop only — the native script reports these as a SUBROLE, never here.
  // Kept for an AX provider that puts a secure name in the role field.
  it("maps a secure ROLE to secure and drops the text, even on an OK read", () => {
    expect(parseSelectedTextResult("OK\tAXSecureTextField\tsecretpw\tEOT\n")).toEqual({
      status: "secure",
      role: "AXSecureTextField",
      selectedText: "",
      permissionDenied: false,
    });
  });

  it("maps a non-SDK AXPasswordField role to secure and drops the text", () => {
    expect(parseSelectedTextResult("NOSEL\tAXPasswordField\t\tEOT\n")).toEqual({
      status: "secure",
      role: "AXPasswordField",
      selectedText: "",
      permissionDenied: false,
    });
  });

  it("maps the DENIED frame to unavailable with permissionDenied set", () => {
    expect(parseSelectedTextResult("DENIED\t\t\tEOT\n")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: true,
    });
  });

  it("maps NOTEXT (uncoercible selection) to unavailable but keeps the role", () => {
    expect(parseSelectedTextResult("NOTEXT\tAXTextArea\t\tEOT\n")).toEqual({
      status: "unavailable",
      role: "AXTextArea",
      selectedText: "",
      permissionDenied: false,
    });
  });

  it("maps a missing EOT frame to unavailable", () => {
    expect(parseSelectedTextResult("OK\tAXTextField\thello\n")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
  });

  // The other malformed fixtures are all malformed by having too FEW tabs, so
  // the tab-count checks alone catch them and the EOT comparison is never the
  // thing under test. This one is correctly tab-formed and fails ONLY on the
  // frame word, so deleting that comparison turns it red.
  it("maps a well-tab-formed frame whose final segment is not EOT to unavailable", () => {
    expect(parseSelectedTextResult("OK\tAXTextField\thello\tBADFRAME\n")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
  });

  it("maps a malformed/truncated frame to unavailable", () => {
    expect(parseSelectedTextResult("garbage output with no tabs")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(parseSelectedTextResult("")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(parseSelectedTextResult("OK\tAXTextField\tEOT\n")).toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
  });

  // One shared constant returned by reference would let a single caller
  // mutation poison every later unavailable read for the whole process.
  describe("unavailable results are not a shared mutable object", () => {
    it("returns a distinct object per call", () => {
      const first = parseSelectedTextResult("NOELEM\t\t\tEOT\n");
      const second = parseSelectedTextResult("garbage");

      expect(first).not.toBe(second);
    });

    it("does not let a mutation of one result reach the next read", () => {
      const mutated = parseSelectedTextResult("NOELEM\t\t\tEOT\n");
      mutated.permissionDenied = true;
      mutated.role = "poisoned";

      expect(parseSelectedTextResult("NOELEM\t\t\tEOT\n")).toEqual({
        status: "unavailable",
        role: "",
        selectedText: "",
        permissionDenied: false,
      });
    });
  });
});

/**
 * The AppleScript's frame word and the parser's `EOT_FRAME` assertion used to
 * be two independent literals — 7 copies of `"EOT"` in the script, 1 in the
 * parser — with nothing tying them together. Renaming the 7 script copies
 * (e.g. to `"END"`) left every test above green (they all feed the parser
 * hand-written fixtures, never the real script text) while silently making
 * every real read fail `parseSelectedTextResult`'s frame check and switching
 * the whole feature off. This reads the actual source text — not the
 * compiled/evaluated script, which would look identical either way once
 * `EOT_FRAME` and a hardcoded literal happen to agree — to prove the script
 * derives its frame token from `EOT_FRAME` rather than repeating it.
 */
describe("SELECTED_TEXT_SCRIPT source — EOT_FRAME coupling", () => {
  const source = readFileSync(path.join(import.meta.dirname, "selectedText.ts"), "utf8");
  const scriptLiteral = source.match(/const SELECTED_TEXT_SCRIPT = `([\s\S]*?)`;/);

  it("finds the script literal in the source", () => {
    expect(scriptLiteral).not.toBeNull();
  });

  it("has every return path interpolate ${EOT_FRAME} instead of a hardcoded frame word", () => {
    const script = scriptLiteral?.[1] ?? "";
    const returnLines = script.split("\n").filter((line) => line.includes("return "));

    // Every branch the script can return from — DENIED, both NOELEM exits,
    // SECURE, NOSEL, NOTEXT, OK — must be represented here; a count drop would
    // mean this assertion silently stopped covering a return path.
    expect(returnLines).toHaveLength(7);

    for (const line of returnLines) {
      expect(line).toContain("${EOT_FRAME}");
    }
  });
});
