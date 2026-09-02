/**
 * @file askEnvironment.test.ts
 * @description Covers the ambient facts one Ask press carries and the exact
 * string they render into. Two properties dominate: NOTHING here may fail an
 * ask (every source is best-effort, and a failure yields absence rather than a
 * throw), and NOTHING unreadable may reach the prompt as a placeholder — a
 * `Keyboard input source: unknown` line is a fact with no content, and a model
 * handed one will reason from it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAskDirectives,
  formatLocalIso8601,
  MAX_PRESET_NAME_LENGTH,
  MAX_RECENT_TRANSFORMS,
  parseKeyboardInputSource,
  readRecentTransforms,
  RECENT_HISTORY_READ_LIMIT,
  resolveAskEnvironment,
  type AskEnvironment,
} from "./askEnvironment";

// `vi.mock` is hoisted above the import above it, and the factories read
// `vi.hoisted` values — so every source this module reads (the `defaults` spawn,
// SQLite history, the locale store, the logger) is stubbed before it loads.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const historyMock = vi.hoisted(() => ({ getRecentHistory: vi.fn(() => [] as unknown[]) }));
vi.mock("~/features/history/store/historyStore", () => ({
  getRecentHistory: historyMock.getRecentHistory,
}));

const localeMock = vi.hoisted(() => ({ getLocale: vi.fn(() => "en") }));
vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeMock.getLocale,
}));

const loggerMock = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logging/logService", () => ({ logger: loggerMock }));

/** The exact shape `defaults read com.apple.HIToolbox` prints on a real Mac. */
const ABC_ONLY = `(
        {
        "Bundle ID" = "com.apple.PressAndHold";
        InputSourceKind = "Non Keyboard Input Method";
    },
        {
        InputSourceKind = "Keyboard Layout";
        "KeyboardLayout ID" = 252;
        "KeyboardLayout Name" = ABC;
    }
)`;

const JAPANESE_IME = `(
        {
        "Bundle ID" = "com.apple.PressAndHold";
        InputSourceKind = "Non Keyboard Input Method";
    },
        {
        "Bundle ID" = "com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese";
        InputSourceKind = "Keyboard Input Method";
    },
        {
        InputSourceKind = "Keyboard Layout";
        "KeyboardLayout ID" = 252;
        "KeyboardLayout Name" = ABC;
    }
)`;

/**
 * CI runs these on Linux, where `readKeyboardInputSource` returns null before
 * it ever spawns anything — so without pinning the platform the exec-path tests
 * below would pass on a developer's Mac and assert nothing on the runner. The
 * non-darwin branch gets its own test rather than being the accidental default.
 */
const originalPlatform = process.platform;
const setPlatform = (platform: string): void => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};
afterAll(() => setPlatform(originalPlatform));

const succeedWith = (stdout: string): void => {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    callback(null, stdout, "");
  });
};

const failWith = (error: Error): void => {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    callback(error, "", "");
  });
};

const historyRow = (presetName: string | undefined, timestamp: string) => ({
  original: "the text the user selected",
  corrected: "the text the model returned",
  presetName,
  timestamp,
});

const ENVIRONMENT: AskEnvironment = {
  appLocale: "en",
  systemLocale: "en-US",
  keyboardInputSource: "ABC",
  capturedAt: "2026-08-11T14:32:05+09:00",
  timeZone: "Asia/Tokyo",
  recentTransforms: [
    { presetName: "Correction", timestamp: "2026-08-11T05:28:00.000Z" },
    { presetName: "Translate", timestamp: "2026-08-11T04:02:11.000Z" },
  ],
};

describe("parseKeyboardInputSource", () => {
  it("reads the keyboard layout name from a real machine's output", () => {
    expect(parseKeyboardInputSource(ABC_ONLY)).toBe("ABC");
  });

  /**
   * `com.apple.PressAndHold` is present on every Mac and says nothing about
   * what the user is typing in. A parser that took the first entry would report
   * it while the machine types plain ABC — the one answer that is confidently
   * wrong rather than merely missing.
   */
  it("skips the non-keyboard input method that is always present", () => {
    expect(parseKeyboardInputSource(ABC_ONLY)).not.toContain("PressAndHold");
  });

  /**
   * With an IME active the layout entry beside it is the IME's own romaji
   * keyboard. "Japanese" is the fact a translate-shaped question needs; "ABC"
   * would be true of the keys and wrong about the language.
   */
  it("prefers an input method over the keyboard layout listed beside it", () => {
    expect(parseKeyboardInputSource(JAPANESE_IME)).toBe("Japanese");
  });

  it("keeps the whole bundle id when its last segment says nothing", () => {
    const stdout = `(
        {
        "Bundle ID" = "com.example.a";
        InputSourceKind = "Keyboard Input Method";
    }
)`;

    expect(parseKeyboardInputSource(stdout)).toBe("com.example.a");
  });

  it("reads a quoted layout name", () => {
    const stdout = `(
        {
        InputSourceKind = "Keyboard Layout";
        "KeyboardLayout Name" = "U.S.";
    }
)`;

    expect(parseKeyboardInputSource(stdout)).toBe("U.S.");
  });

  it.each([
    ["empty output", ""],
    ["an empty array", "(\n)"],
    ["prose that is not a plist", "the domain/default pair does not exist"],
    ["only the non-keyboard entry", `(\n{\nInputSourceKind = "Non Keyboard Input Method";\n}\n)`],
  ])("returns null for %s", (_description, stdout) => {
    expect(parseKeyboardInputSource(stdout)).toBeNull();
  });
});

describe("readKeyboardInputSource through resolveAskEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform("darwin");
    historyMock.getRecentHistory.mockReturnValue([]);
    localeMock.getLocale.mockReturnValue("en");
  });

  it("never spawns anything off macOS, where the domain does not exist", async () => {
    setPlatform("linux");
    succeedWith(ABC_ONLY);

    const environment = await resolveAskEnvironment();

    expect(execFileMock).not.toHaveBeenCalled();
    expect(environment.keyboardInputSource).toBeNull();
  });

  it("reads the domain rather than the plist path, and never through a shell", async () => {
    succeedWith(ABC_ONLY);

    await resolveAskEnvironment();

    expect(execFileMock).toHaveBeenCalledWith(
      "defaults",
      ["read", "com.apple.HIToolbox", "AppleSelectedInputSources"],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
  });

  /**
   * `defaults` exits non-zero for a missing key, hangs on a wedged cfprefsd
   * (hence the timeout), and is absent entirely off macOS. All three are the
   * same outcome here: no line, no throw, and an ask that still opens.
   */
  it.each([
    ["a timeout", Object.assign(new Error("killed"), { killed: true })],
    ["a missing key", new Error("The domain/default pair does not exist")],
    ["a missing binary", Object.assign(new Error("ENOENT"), { code: "ENOENT" })],
  ])("yields null and never throws on %s", async (_description, error) => {
    failWith(error);

    const environment = await resolveAskEnvironment();

    expect(environment.keyboardInputSource).toBeNull();
    expect(buildAskDirectives(environment)).not.toContain("Keyboard input source");
  });

  it("logs a failed read at debug, since it fires on every press on a machine that refuses it", async () => {
    failWith(new Error("nope"));

    await resolveAskEnvironment();

    expect(loggerMock.debug).toHaveBeenCalledWith(
      "correction.hotkey",
      "Keyboard input source unreadable",
      expect.anything(),
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});

describe("readRecentTransforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * NAMES AND TIMES ONLY — chosen explicitly over sending any of the text those
   * transforms carried. This asserts the negative as well as the positive,
   * because the row objects hold `original` and `corrected` right beside the
   * fields that are wanted.
   */
  it("takes the preset name and timestamp and nothing else", () => {
    historyMock.getRecentHistory.mockReturnValue([historyRow("Correction", "2026-08-11T05:28:00.000Z")]);

    expect(readRecentTransforms()).toEqual([
      { presetName: "Correction", timestamp: "2026-08-11T05:28:00.000Z" },
    ]);
  });

  // `getHistory` returns rows ordered `timestamp DESC`, so the head of that list
  // is already most-recent-first.
  it("keeps at most five, most recent first", () => {
    historyMock.getRecentHistory.mockReturnValue(
      Array.from({ length: 12 }, (_, index) =>
        historyRow(`Preset ${index}`, `2026-08-11T0${index % 10}:00:00.000Z`),
      ),
    );

    const recent = readRecentTransforms();

    expect(recent).toHaveLength(MAX_RECENT_TRANSFORMS);
    expect(recent[0].presetName).toBe("Preset 0");
    expect(recent.at(-1)?.presetName).toBe("Preset 4");
  });

  /**
   * BOUNDED IN SQL. This runs on every Ask press, and the unbounded read would
   * pull the whole `original`/`corrected` corpus through the main thread to keep
   * five preset names.
   */
  it("asks the database for a bounded window rather than the whole feature", () => {
    historyMock.getRecentHistory.mockReturnValue([]);

    readRecentTransforms();

    expect(historyMock.getRecentHistory).toHaveBeenCalledWith(
      "corrections",
      RECENT_HISTORY_READ_LIMIT,
    );
    expect(RECENT_HISTORY_READ_LIMIT).toBeGreaterThan(MAX_RECENT_TRANSFORMS);
  });

  it("is empty for an empty history, which is an ordinary case", () => {
    historyMock.getRecentHistory.mockReturnValue([]);

    expect(readRecentTransforms()).toEqual([]);
  });

  // Pre-snapshot history rows carry no preset name, and a bullet stating only a
  // timestamp is a fact with no content.
  it("skips rows that never recorded a preset name", () => {
    historyMock.getRecentHistory.mockReturnValue([
      historyRow(undefined, "2026-08-11T05:28:00.000Z"),
      historyRow("Translate", "2026-08-11T04:02:11.000Z"),
    ]);

    expect(readRecentTransforms()).toEqual([
      { presetName: "Translate", timestamp: "2026-08-11T04:02:11.000Z" },
    ]);
  });

  /**
   * A preset name is user-editable text: it has no length of its own, it can
   * hold a newline that would break out of the directive block, and five of
   * them ride every autocomplete dispatch.
   */
  it("strips control characters and caps the name", () => {
    historyMock.getRecentHistory.mockReturnValue([
      historyRow(`Cor\nrection ${"x".repeat(200)}`, "2026-08-11T05:28:00.000Z"),
    ]);

    const [transform] = readRecentTransforms();

    expect(transform.presetName).not.toContain("\n");
    expect(transform.presetName.length).toBeLessThanOrEqual(MAX_PRESET_NAME_LENGTH);
  });

  /**
   * The read window is deliberately WIDER than five, because rows written before
   * the preset-name snapshot existed are skipped — reading exactly five would
   * report nothing for a user whose newest rows are all legacy.
   */
  it("still finds five once legacy rows in the window are skipped", () => {
    historyMock.getRecentHistory.mockReturnValue([
      ...Array.from({ length: 6 }, (_, index) =>
        historyRow(undefined, `2026-08-11T1${index}:00:00.000Z`),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        historyRow(`Preset ${index}`, `2026-08-11T0${index}:00:00.000Z`),
      ),
    ]);

    expect(readRecentTransforms()).toHaveLength(MAX_RECENT_TRANSFORMS);
  });

  it("returns nothing rather than throwing when the history read fails", () => {
    historyMock.getRecentHistory.mockImplementation(() => {
      throw new Error("database is locked");
    });

    expect(readRecentTransforms()).toEqual([]);
  });
});

describe("formatLocalIso8601", () => {
  /**
   * `toISOString()` always renders UTC with a `Z`, which is the wrong fact:
   * "it is 14:32 for me and I am nine hours ahead" is what a model needs to
   * reason about "this morning", and `05:32Z` is not that.
   */
  it("states local wall-clock time with an explicit offset", () => {
    const date = new Date("2026-08-11T05:32:05.000Z");
    const formatted = formatLocalIso8601(date);

    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(formatted).not.toContain("Z");
    expect(formatted.startsWith(`${date.getFullYear()}-`)).toBe(true);
  });
});

describe("buildAskDirectives", () => {
  it("renders every fact, app locale first", () => {
    expect(buildAskDirectives(ENVIRONMENT)).toBe(
      [
        "App locale: en",
        "System language: en-US",
        "Keyboard input source: ABC",
        "Current time: 2026-08-11T14:32:05+09:00 (Asia/Tokyo)",
        "Recent transforms (most recent first, names and times only):",
        "- Correction (2026-08-11T05:28:00.000Z)",
        "- Translate (2026-08-11T04:02:11.000Z)",
      ].join("\n"),
    );
  });

  /**
   * A STRICT EXTENSION of `buildAppLocaleDirective()`: the line a model has
   * always seen stays first and unchanged, and everything new grows below it.
   */
  it("opens on the same app-locale line the flow appended before it existed", () => {
    expect(buildAskDirectives(ENVIRONMENT).split("\n")[0]).toBe("App locale: en");
  });

  it("omits the keyboard line entirely when the source was unreadable", () => {
    const rendered = buildAskDirectives({ ...ENVIRONMENT, keyboardInputSource: null });

    expect(rendered).not.toContain("Keyboard input source");
    expect(rendered).not.toMatch(/unknown|null/i);
    expect(rendered).toContain("System language: en-US");
  });

  it("omits the system language line when macOS would not say", () => {
    const rendered = buildAskDirectives({ ...ENVIRONMENT, systemLocale: null });

    expect(rendered).not.toContain("System language");
    expect(rendered.split("\n")[0]).toBe("App locale: en");
  });

  it("drops the zone from the time line rather than stating an empty one", () => {
    const rendered = buildAskDirectives({ ...ENVIRONMENT, timeZone: null });

    expect(rendered).toContain("Current time: 2026-08-11T14:32:05+09:00");
    expect(rendered).not.toContain("()");
  });

  it("contributes no transforms section for an empty history", () => {
    const rendered = buildAskDirectives({ ...ENVIRONMENT, recentTransforms: [] });

    expect(rendered).not.toContain("Recent transforms");
    expect(rendered).toContain("Current time:");
  });

  /**
   * The whole point of the shape the user chose: the names say what they have
   * been doing, and the text of those transforms — the private thing the app
   * exists to keep local — never travels.
   */
  it("states names and times and no transform text", () => {
    const rendered = buildAskDirectives(ENVIRONMENT);

    expect(rendered).toContain("- Correction (2026-08-11T05:28:00.000Z)");
    expect(rendered).not.toContain("the text the user selected");
    expect(rendered).not.toContain("the text the model returned");
  });

  /**
   * NO FENCE. `composeAskMessage` fences the attached passage because a passage
   * is opaque text; these are self-describing `Key: value` lines, and the
   * absence of a fence is what makes the block safe to head-window for the
   * autocomplete dispatch without cutting a closing delimiter off.
   */
  it("carries no fence of its own", () => {
    expect(buildAskDirectives(ENVIRONMENT)).not.toContain("-----");
  });
});

describe("resolveAskEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform("darwin");
    historyMock.getRecentHistory.mockReturnValue([]);
    localeMock.getLocale.mockReturnValue("ja");
    succeedWith(ABC_ONLY);
  });

  it("carries both locales — the app's own and the system's — since they differ", async () => {
    const environment = await resolveAskEnvironment({ systemLocale: "en-US" });

    expect(environment.appLocale).toBe("ja");
    expect(environment.systemLocale).toBe("en-US");
  });

  it("treats a blank system locale as absent rather than as an empty fact", async () => {
    expect((await resolveAskEnvironment({ systemLocale: "   " })).systemLocale).toBeNull();
    expect((await resolveAskEnvironment({ systemLocale: null })).systemLocale).toBeNull();
  });

  /**
   * The press instant, deliberately — a slow typist can leave the window open
   * for minutes, and re-reading the clock at submit would make the request
   * differ from the string the window is showing for transparency.
   */
  it("captures the instant it was handed, not the one at submit", async () => {
    const now = new Date("2026-08-11T05:32:05.000Z");

    const environment = await resolveAskEnvironment({ now });

    expect(environment.capturedAt).toBe(formatLocalIso8601(now));
  });

  it("resolves fully even when every optional source fails", async () => {
    failWith(new Error("no"));
    historyMock.getRecentHistory.mockImplementation(() => {
      throw new Error("no");
    });

    const environment = await resolveAskEnvironment();

    expect(environment.keyboardInputSource).toBeNull();
    expect(environment.recentTransforms).toEqual([]);
    expect(buildAskDirectives(environment)).toContain("App locale: ja");
  });

  /**
   * The cheapest source is guarded too, because this runs BEFORE the input
   * window opens: an unguarded throw here would turn a preferences failure into
   * an ask that never appears, which is the outcome the best-effort rule exists
   * to prevent. Absence, not an empty line.
   */
  it("still opens an ask when even the locale store throws", async () => {
    localeMock.getLocale.mockImplementation(() => {
      throw new Error("config file is corrupt");
    });

    const environment = await resolveAskEnvironment({ systemLocale: "en-US" });

    expect(environment.appLocale).toBe("");
    const rendered = buildAskDirectives(environment);
    expect(rendered).not.toContain("App locale");
    expect(rendered).toContain("System language: en-US");
  });
});
