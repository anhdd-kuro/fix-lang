/**
 * @file appBundleIds.test.ts
 * @description The main-process half of "block an .app": re-validation of
 * renderer-supplied paths, and reading `CFBundleIdentifier` off disk.
 *
 * The two things pinned hardest here are the two that would fail SILENTLY in
 * production: that every path is re-checked in main (a renderer's own filter
 * is a convenience, never the guard), and that `PlistBuddy` is invoked with an
 * ARGV ARRAY — a shell string would turn a filename into executable input,
 * and every macOS app path is attacker-nameable by anything that can write to
 * `~/Applications`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, existsSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));
vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));

const { isExistingAppBundlePath, readAppBundleId, resolveAppBundleIds } = await import(
  "./appBundleIds"
);

const SLACK = "/Applications/Slack.app";
const SLACK_PLIST = "/Applications/Slack.app/Contents/Info.plist";

/** Every path in `present` exists; everything else does not. */
const filesystemHolding = (...present: string[]): void => {
  const entries = new Set(present);
  existsSyncMock.mockImplementation((candidate: string) => entries.has(candidate));
};

/** Mimics `execFile`'s callback contract, which `promisify` wraps. */
const plistBuddyPrints = (stdout: string): void => {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      callback(null, { stdout, stderr: "" });
    },
  );
};

const plistBuddyFails = (): void => {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => {
      callback(new Error("Print: Entry, \":CFBundleIdentifier\", Does Not Exist"));
    },
  );
};

describe("isExistingAppBundlePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a well-shaped path that exists", () => {
    filesystemHolding(SLACK);
    expect(isExistingAppBundlePath(SLACK)).toBe(true);
  });

  it("rejects a well-shaped path that does not exist", () => {
    filesystemHolding();
    expect(isExistingAppBundlePath(SLACK)).toBe(false);
  });

  it("never touches the filesystem for a badly-shaped path", () => {
    filesystemHolding(SLACK);
    expect(isExistingAppBundlePath("../../Applications/Slack.app")).toBe(false);
    expect(existsSyncMock).not.toHaveBeenCalled();
  });
});

describe("readAppBundleId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads CFBundleIdentifier with an argv array, never a shell string", async () => {
    filesystemHolding(SLACK, SLACK_PLIST);
    plistBuddyPrints("com.tinyspeck.slackmacgap\n");

    await readAppBundleId(SLACK);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(file).toBe("/usr/libexec/PlistBuddy");
    expect(args).toEqual(["-c", "Print :CFBundleIdentifier", SLACK_PLIST]);
  });

  it("normalizes the printed identifier the same way a typed one is normalized", async () => {
    filesystemHolding(SLACK, SLACK_PLIST);
    plistBuddyPrints("  Com.TinySpeck.SlackMacGap  \n");

    await expect(readAppBundleId(SLACK)).resolves.toBe("com.tinyspeck.slackmacgap");
  });

  it("returns null instead of throwing when the bundle has no identifier", async () => {
    filesystemHolding(SLACK, SLACK_PLIST);
    plistBuddyFails();

    await expect(readAppBundleId(SLACK)).resolves.toBeNull();
  });

  it("does not spawn anything when there is no Info.plist to read", async () => {
    filesystemHolding(SLACK);

    await expect(readAppBundleId(SLACK)).resolves.toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("resolveAppBundleIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filesystemHolding(SLACK, SLACK_PLIST);
    plistBuddyPrints("com.tinyspeck.slackmacgap\n");
  });

  it("resolves a valid selection to canonical bundle ids", async () => {
    await expect(resolveAppBundleIds([SLACK])).resolves.toEqual({
      success: true,
      bundleIds: ["com.tinyspeck.slackmacgap"],
    });
  });

  it("treats an empty selection as a success with nothing to add", async () => {
    await expect(resolveAppBundleIds([])).resolves.toEqual({ success: true, bundleIds: [] });
  });

  it.each([
    ["a non-array payload", "/Applications/Slack.app"],
    ["null", null],
    ["a non-string entry", [42]],
    ["a relative path", ["Applications/Slack.app"]],
    ["a non-.app path", ["/etc/passwd"]],
    ["a path that does not exist", ["/Applications/Ghost.app"]],
  ])("rejects %s without spawning anything", async (_label, payload) => {
    await expect(resolveAppBundleIds(payload)).resolves.toMatchObject({ success: false });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects more paths than the deny-list could ever hold", async () => {
    const tooMany = Array.from({ length: 201 }, () => SLACK);

    await expect(resolveAppBundleIds(tooMany)).resolves.toMatchObject({ success: false });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  /**
   * All-or-nothing on purpose: a partial list would leave the user with "some
   * of what I dropped is blocked", and the deny-list cannot show which half.
   */
  it("adds nothing when one bundle's identifier cannot be read", async () => {
    plistBuddyFails();

    await expect(resolveAppBundleIds([SLACK])).resolves.toMatchObject({ success: false });
  });
});
