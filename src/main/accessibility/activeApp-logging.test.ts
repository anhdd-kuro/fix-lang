/**
 * @file activeApp-logging.test.ts
 * @description Tests that every frontmost-app read lands in the structured log
 * — the only signal that says whether a request carried app context. `exec` and
 * the log service are mocked; no osascript runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveApp } from "./activeApp";

// `vi.mock` and `vi.hoisted` below are hoisted above the import above, so the
// mocks are installed before `activeApp` is evaluated despite the source order.
const execMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// `default` too: the transformed module reads `child_process` as a CJS
// namespace, which vitest rejects when the mock has no default export.
vi.mock("child_process", () => ({
  exec: execMock,
  default: { exec: execMock },
}));
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

/** Drive the `exec` callback the way node does: (error, stdout, stderr). */
const mockExec = (error: Error | null, stdout = "") => {
  execMock.mockImplementation(
    (
      _cmd: string,
      _opts: unknown,
      cb: (e: Error | null, out: string, err: string) => void,
    ) => {
      cb(error, stdout, "");
    },
  );
};

describe("getActiveApp — logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The whole feature is macOS-only; the tests must exercise the darwin path
    // regardless of where they run.
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  });

  it("debug-logs the app name and bundle id on a successful read", async () => {
    mockExec(null, "Slack\tcom.tinyspeck.slackmacgap\n");

    await expect(getActiveApp()).resolves.toEqual({
      name: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
    });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.activeApp",
      "Frontmost app read",
      { app: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
    );
  });

  it("debug-logs the raw line when the read is dropped, so the reason is visible", async () => {
    mockExec(null, "FixLang\tcom.fixlang.app\n");

    await expect(getActiveApp()).resolves.toBeNull();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "accessibility.activeApp",
      "Frontmost app not usable as context",
      { raw: "FixLang\tcom.fixlang.app" },
    );
  });

  it("caps the raw line it echoes — it is untrusted process output", async () => {
    mockExec(null, `${"a".repeat(400)}\tcom.example.app`);

    await getActiveApp();

    const { raw } = loggerMock.debug.mock.calls[0][2];
    expect(raw.length).toBe(120);
  });

  it("warns (not errors) on a failed read and still resolves null", async () => {
    mockExec(new Error("osascript is not allowed assistive access"));

    await expect(getActiveApp()).resolves.toBeNull();
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "accessibility.activeApp",
      "Failed to read the frontmost app",
      { error: "osascript is not allowed assistive access" },
    );
  });

  it("logs nothing and skips osascript off darwin", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    await expect(getActiveApp()).resolves.toBeNull();
    expect(execMock).not.toHaveBeenCalled();
    expect(loggerMock.debug).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});
