/**
 * @file selectedText-logging.test.ts
 * @description Tests that every AX selected-text read lands in the structured
 * log, that failures (exec error, timeout, oversized selection, non-darwin)
 * resolve `"unavailable"` instead of rejecting, and that the guards which must
 * run *inside* the AppleScript really do. `execFile` and the log service are
 * mocked; no osascript runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAxSelectedText } from "./selectedText";

// `vi.mock` and `vi.hoisted` below are hoisted above the import above, so the
// mocks are installed before `selectedText` is evaluated despite the source
// order.
const execFileMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// `default` too: the transformed module reads `child_process` as a CJS
// namespace, which vitest rejects when the mock has no default export.
vi.mock("child_process", () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

/**
 * Drive the 4-arg `execFile(file, args, options, callback)` form node uses.
 * `execFile` rather than `exec` on purpose: no shell means an apostrophe in the
 * AppleScript can never close the quoting early and silently disable AX reads.
 */
const mockExecFile = (error: Error | null, stdout = "") => {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      _opts: unknown,
      cb: (e: Error | null, out: string, err: string) => void,
    ) => {
      cb(error, stdout, "");
    },
  );
};

/** The AppleScript the module actually hands to osascript. */
const capturedScript = async (): Promise<string> => {
  mockExecFile(null, "NOELEM\t\t\tEOT\n");
  await getAxSelectedText();
  const [file, args] = execFileMock.mock.calls[0] as [string, readonly string[]];

  expect(file).toBe("osascript");
  expect(args[0]).toBe("-e");
  return args[1];
};

const scriptLines = (script: string): string[] =>
  script.split("\n").map((line) => line.trim());

/**
 * The single `if` statement a guard hangs off, so a test can assert the whole
 * boolean expression rather than the presence of its pieces — the pieces all
 * survive the operator and operand edits that silently disable a guard.
 */
const decisionLine = (script: string, opening: string): string => {
  const line = scriptLines(script).find((candidate) => candidate.startsWith(opening));

  expect(line).toBeDefined();
  return line as string;
};

describe("getAxSelectedText — logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The whole feature is macOS-only; the tests must exercise the darwin
    // path regardless of where they run.
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  });

  it("runs osascript through execFile with no shell string", async () => {
    mockExecFile(null, "NOSEL\tAXTextField\t\tEOT\n");

    await getAxSelectedText();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0] as [
      string,
      readonly string[],
      { timeout: number; maxBuffer: number },
    ];
    expect(file).toBe("osascript");
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("-e");
    expect(options.timeout).toBe(1_500);
    expect(options.maxBuffer).toBe(8 * 1024 * 1024);
  });

  it("debug-logs status and role on a successful OK read", async () => {
    mockExecFile(null, "OK\tAXTextField\thello\tEOT\n");

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "ok",
      role: "AXTextField",
      selectedText: "hello",
      permissionDenied: false,
    });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Selection read",
      { status: "ok", role: "AXTextField", permissionDenied: false },
    );
  });

  it("debug-logs a miss without leaking any selection text", async () => {
    mockExecFile(null, "NOSEL\tAXTextField\t\tEOT\n");

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "empty",
      role: "AXTextField",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "No selection",
      { status: "empty", role: "AXTextField", permissionDenied: false },
    );
  });

  it("never puts selection text in the log body, even on an OK read", async () => {
    mockExecFile(null, "OK\tAXTextField\tSUPER-SECRET-TEXT\tEOT\n");

    await getAxSelectedText();

    for (const call of loggerMock.debug.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("SUPER-SECRET-TEXT");
    }
  });

  it("reports a secure field without any text, on the script's real frame", async () => {
    mockExecFile(null, "SECURE\tAXTextField\t\tEOT\n");

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "secure",
      role: "AXTextField",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Secure field skipped",
      { status: "secure", role: "AXTextField", permissionDenied: false },
    );
  });

  // The script exits 0 on a denial, so this arrives through the SUCCESS branch.
  // Without permissionDenied in the log context it would be indistinguishable
  // from an ordinary unavailable read.
  it("sets permissionDenied from a DENIED frame on a zero-exit script", async () => {
    mockExecFile(null, "DENIED\t\t\tEOT\n");

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: true,
    });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Selection unavailable",
      { status: "unavailable", role: "", permissionDenied: true },
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("resolves unavailable and warns (not errors) on an exec error", async () => {
    mockExecFile(new Error("System Events got an error: timeout"));

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Failed to read the selection",
      { code: null, reason: "execFailed" },
    );
  });

  it("resolves unavailable on a timeout (killed exec)", async () => {
    const timeoutError = Object.assign(new Error("Command failed"), {
      killed: true,
      signal: "SIGTERM",
    });
    mockExecFile(timeoutError);

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Failed to read the selection",
      { code: null, reason: "timedOut" },
    );
  });

  it("resolves unavailable on a maxBuffer overflow instead of rejecting", async () => {
    const maxBufferError = Object.assign(new Error("stdout maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });
    mockExecFile(maxBufferError);

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Failed to read the selection",
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", reason: "outputTooLarge" },
    );
  });

  it("sets permissionDenied when the exec error is an AX permission denial", async () => {
    mockExecFile(
      new Error(
        "execution error: System Events got an error: not allowed assistive access. (-1743)",
      ),
    );

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: true,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Failed to read the selection",
      { code: null, reason: "permissionDenied" },
    );
  });

  it("leaves permissionDenied false for an unrelated exec error", async () => {
    mockExecFile(new Error("Some application isn't running. (-600)"));

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.selectedText",
      "Failed to read the selection",
      { code: null, reason: "execFailed" },
    );
  });

  // f10 regression: `execFile` sets `error.message` to `Command failed:
  // osascript -e <the whole script>` followed by stderr, and stderr can quote
  // the frontmost window's title and full UI element path. Neither the script
  // text nor that fragment may reach the warn log — only a code + closed-set
  // reason may.
  it("never persists the raw script text or a window title from the error message", async () => {
    const windowTitleLeak = new Error(
      'Command failed: osascript -e tell application "System Events"\n' +
        "System Events got an error: Can't get window " +
        '"Q3 Layoffs Plan - Confidential.docx" of process "Pages". (-1728)',
    );
    mockExecFile(windowTitleLeak);

    await getAxSelectedText();

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const loggedContext = loggerMock.warn.mock.calls[0][2];
    const serialized = JSON.stringify(loggedContext);

    expect(serialized).not.toContain("Q3 Layoffs Plan");
    expect(serialized).not.toContain("tell application");
    expect(loggedContext).toEqual({ code: null, reason: "execFailed" });
  });

  it("resolves unavailable and skips osascript entirely off darwin", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    await expect(getAxSelectedText()).resolves.toEqual({
      status: "unavailable",
      role: "",
      selectedText: "",
      permissionDenied: false,
    });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerMock.debug).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("returns a fresh unavailable object per call", async () => {
    mockExecFile(null, "NOELEM\t\t\tEOT\n");

    const first = await getAxSelectedText();
    const second = await getAxSelectedText();

    expect(first).not.toBe(second);
  });
});

/**
 * These assert the SHAPE of the AppleScript, not just the parser, because the
 * security properties they cover are only real if they happen inside the
 * script. A parser-side fix would look identical in a unit test while the
 * password had already crossed the pipe into Node's stdout buffer.
 */
describe("SELECTED_TEXT_SCRIPT — guards that must live inside the script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  });

  it("reads both AXRole and AXSubrole", async () => {
    const script = await capturedScript();

    expect(script).toContain('"AXRole"');
    expect(script).toContain('"AXSubrole"');
    expect(script).toContain("AXSecureTextField");
    expect(script).toContain("AXPasswordField");
  });

  it("gates the secure decision on the SUBROLE, not the role alone", async () => {
    const script = await capturedScript();

    // The decision expression is pinned literally, and deliberately so:
    // merely *reading* AXSubrole proves nothing, because dropping the subrole
    // from this condition while leaving the read in place is exactly the
    // "simplify it back to a role check" edit that made this guard dead code
    // the first time — and it is invisible to any assertion that only looks
    // for the attribute name. CI runs on ubuntu, so the script cannot be
    // executed here; pinning the expression is the only available proof.
    //
    // A secure field's ROLE is the plain AXTextField (AXRoleConstants.h:360);
    // AXSecureTextField is a SUBROLE (AXRoleConstants.h:408).
    const secureDecision = decisionLine(script, "if r is in");

    expect(secureDecision).toContain("r is in secureIdentifiers");
    expect(secureDecision).toContain("sr is in secureIdentifiers");
    expect(secureDecision).toContain(" or ");
    expect(secureDecision).not.toContain(" and ");
  });

  it("returns the secure frame before it ever evaluates AXSelectedText", async () => {
    const script = await capturedScript();

    // Ordering is the whole security property: dropping the text after reading
    // it would still push the password across the pipe.
    expect(script.indexOf('return "SECURE"')).toBeGreaterThan(-1);
    expect(script.indexOf('"AXSelectedText"')).toBeGreaterThan(
      script.indexOf('return "SECURE"'),
    );
  });

  it("sentinel-checks AXSubrole before coercing it to text", async () => {
    const script = await capturedScript();

    // `(missing value) as text` yields the literal string "missing value"
    // (verified live), so coercing first would compare that against the secure
    // names and classify nothing.
    expect(script).toContain("if subroleValue is not missing value then");
  });

  // f9: AXRole used to be coerced with no sentinel check at all — unlike
  // AXSubrole right below it — so an element whose AXRole is `missing value`
  // produced the literal string "missing value" as `r`, which then flowed into
  // the returned result and the debug log context as a bogus role. Fails
  // safe (it can never match a secure name), but contradicts this file's own
  // stated invariant. Checked the same way the subrole read is.
  it("sentinel-checks AXRole before coercing it to text", async () => {
    const script = await capturedScript();

    expect(script).toContain("if roleValue is not missing value then");
  });

  it("captures the focused-element error instead of swallowing it", async () => {
    const script = await capturedScript();

    // A bare `try` around the AXFocusedUIElement read hides the denial, the
    // script prints NOELEM and exits 0, and permissionDenied can never become
    // true for a revoked Accessibility grant.
    expect(scriptLines(script)).toContain("on error number errNum");
    expect(script).toContain('return "DENIED"');
  });

  it("gates the DENIED frame on both denial codes, disjunctively", async () => {
    const denialDecision = decisionLine(await capturedScript(), "if errNum");

    // Asserting the three pieces exist separately is not enough: both codes
    // survive an `or` -> `and` edit that makes the DENIED branch unreachable
    // and silently restores the original bug. Pin the expression.
    expect(denialDecision).toContain("errNum is -25211");
    expect(denialDecision).toContain("errNum is -1743");
    expect(denialDecision).toContain(" or ");
    expect(denialDecision).not.toContain(" and ");
    expect(denialDecision).toContain('return "DENIED"');
  });

  it("binds only an error number, never an error message, in its one handler", async () => {
    const handlers = scriptLines(await capturedScript()).filter((line) =>
      line.startsWith("on error"),
    );

    // AppleScript quotes the offending value into its error text, so binding a
    // message identifier at all is a route for the user's selection into the
    // frame and from there into the log. Matching on the shape rather than on
    // one variable name keeps `on error msg number errNum` from slipping past.
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toMatch(/^on error number \w+$/);
  });

  it("keeps the selection coercion inside a try that closes before the OK return", async () => {
    const lines = scriptLines(await capturedScript());
    const coercion = lines.indexOf("set selectionText to s as text");

    // The line existing proves nothing — the regression that matters is the
    // enclosing `try` being removed while the line stays. An uncoercible
    // selection would then make osascript exit non-zero with the selection
    // quoted in its error text, straight into the persisted JSONL warn body,
    // where redactLogMessage has no pattern that can catch plain prose.
    expect(coercion).toBeGreaterThan(-1);

    const enclosingBlock = lines
      .slice(0, coercion)
      .reverse()
      .find((line) => line === "try" || line === "end try");
    expect(enclosingBlock).toBe("try");

    const after = lines.slice(coercion);
    const closerOffset = after.indexOf("end try");
    const okReturnOffset = after.findIndex((line) => line.startsWith('return "OK"'));
    expect(closerOffset).toBeGreaterThan(-1);
    expect(closerOffset).toBeLessThan(okReturnOffset);
  });

  it("no longer coerces the selection inline in the OK return", async () => {
    expect(await capturedScript()).not.toContain("& (s as text) &");
  });
});
