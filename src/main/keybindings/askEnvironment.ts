/**
 * @file askEnvironment.ts
 * @description Resolves the ambient facts an Ask AI press should carry with
 * it — the system language, the keyboard the user is actually typing on, the
 * wall-clock moment of the press, and which transforms they last ran — and
 * renders them into ONE directive string.
 *
 * ONCE PER HOTKEY PRESS, never per keystroke. The same string is handed to
 * three places: the composed Ask message (`askFlow.ts`), the input window's
 * transparency row (`AskInputPayload.contextDirectives`), and the autocomplete
 * user prompt (`features/autocomplete/main/prompt.ts`, which fires while the
 * user types). Resolving it again anywhere downstream would mean the window
 * showing one thing and the request carrying another, which is the whole
 * failure the transparency row exists to prevent.
 *
 * BEST-EFFORT, exactly like the frontmost-app read in
 * `~/main/accessibility/activeApp.ts`: every source here can fail, and a
 * failure yields ABSENCE. Nothing renders `unknown`, `null` or an empty
 * placeholder — a line the model cannot use is worse than no line, because it
 * is a fact stated with no content and the model will try to use it anyway.
 *
 * NO LINE HERE MAY BE LOGGED. Preset names are user-editable text and the
 * timestamp identifies a session; `redactLogContext` would not blank either
 * (and would silently blank a key merely CONTAINING `clipboard`/`token`/
 * `secret`/`selected_text`, the `selectionPoll` trap). Callers log lengths and
 * counts only.
 */
import { execFile } from "node:child_process";
import { getRecentHistory } from "~/features/history/store/historyStore";
import { getLocale } from "~/features/i18n/store/localeStore";
import { logger } from "../logging/logService";

/**
 * How many recent transforms travel with a press. Five is what the user asked
 * for; it is also about as much as can ride on an autocomplete request that
 * fires while they are still typing.
 */
export const MAX_RECENT_TRANSFORMS = 5;

/**
 * Cap on one preset name. Preset names are user-editable, so this is not a
 * hostile-input guard so much as a bound on a string that has no bound of its
 * own and is multiplied by five on every dispatch. Truncated rather than
 * dropped: the user named it, and half a name still says which transform it
 * was.
 */
export const MAX_PRESET_NAME_LENGTH = 64;

/**
 * How many rows the history read asks for. More than
 * {@link MAX_RECENT_TRANSFORMS} because a row with no `presetName` (legacy
 * history, written before the snapshot existed) contributes nothing and is
 * skipped — reading exactly five would report an empty list for a user whose
 * newest five rows all predate that column.
 */
export const RECENT_HISTORY_READ_LIMIT = 20;

/**
 * `defaults` reads through cfprefsd, which can be slow or wedged. This is the
 * only blocking step between the hotkey and the input window appearing, so the
 * budget is short — shorter than the frontmost-app read's 1.5 s, because
 * nothing here is worth a visible delay before the window opens.
 */
export const INPUT_SOURCE_TIMEOUT_MS = 1_000;

/**
 * A keyboard layout name ("ABC", "U.S.", "Japanese - Romaji") is short. Past
 * this it is a mangled read, not a name.
 */
const MAX_INPUT_SOURCE_LENGTH = 64;

/**
 * A BCP 47 tag ("en", "ja-JP", "zh-Hans-CN") is short too, but it is a
 * different string from a different source, so it gets its own bound rather
 * than borrowing the keyboard one.
 */
const MAX_LOCALE_LENGTH = 32;

export type RecentTransform = {
  /** The producing preset's name as history recorded it, capped and cleaned. */
  presetName: string;
  /** The history row's own ISO 8601 timestamp, passed through verbatim. */
  timestamp: string;
};

export type AskEnvironment = {
  /** The app's own UI locale — the same value `buildAppLocaleDirective` states. */
  appLocale: string;
  /** `app.getSystemLocale()`, i.e. what macOS itself is set to. */
  systemLocale: string | null;
  /** The active keyboard layout or input method; null when unreadable. */
  keyboardInputSource: string | null;
  /** ISO 8601 with the local UTC offset, captured AT THE PRESS. */
  capturedAt: string;
  /** IANA zone name, e.g. `Asia/Tokyo`; null when the runtime will not say. */
  timeZone: string | null;
  /** Most recent first, at most {@link MAX_RECENT_TRANSFORMS}; may be empty. */
  recentTransforms: RecentTransform[];
};

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * ISO 8601 in LOCAL time with an explicit offset, which `toISOString()` cannot
 * produce — it always renders UTC with a `Z`. "It is 14:32 for me, and I am
 * nine hours ahead" is the fact a model needs to reason about "this morning" or
 * "by end of day"; the same instant expressed as `05:32Z` is not that fact.
 */
export const formatLocalIso8601 = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
};

const resolveTimeZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Strips control characters and caps the length of a string that is about to
 * become a line in a prompt. A newline inside a preset name would break out of
 * the directive block and read as a directive of its own.
 */
const sanitizeLineValue = (value: string, maxLength: number): string =>
  value
    // eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();

const runInputSourceRead = (): Promise<string> =>
  new Promise((resolve, reject) => {
    // The DOMAIN, not the plist path: `defaults read com.apple.HIToolbox`
    // answers from cfprefsd, which is what actually holds the current value —
    // the on-disk plist can lag it. `execFile`, not `exec`, so no argument
    // reaches a shell.
    execFile(
      "defaults",
      ["read", "com.apple.HIToolbox", "AppleSelectedInputSources"],
      { timeout: INPUT_SOURCE_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

/** `"KeyboardLayout Name" = ABC;` and `"Bundle ID" = "com.apple.x";` alike. */
const readPlistField = (block: string, field: string): string | null => {
  const match = new RegExp(`"?${field}"?\\s*=\\s*("([^"]*)"|[^;]*);`).exec(block);
  if (!match) return null;
  return (match[2] ?? match[1] ?? "").trim() || null;
};

/**
 * A human-readable name for the input source macOS reports as selected.
 *
 * `AppleSelectedInputSources` is an old-style plist ARRAY, and the entries are
 * not equally interesting. `Non Keyboard Input Method` entries
 * (`com.apple.PressAndHold`, most commonly) are always present and say nothing
 * about what the user is typing in, so they are skipped — a parser that took
 * the first entry would report `PressAndHold` on a machine typing plain ABC,
 * which is the one answer that is confidently wrong.
 *
 * An INPUT METHOD wins over a bare keyboard layout when both are listed: with
 * Japanese IME active, the layout entry beside it is the IME's own romaji
 * keyboard, and "Japanese" is the fact that matters for a translate-shaped
 * question. Its name comes from the last dot-segment of the bundle id
 * (`com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese` -> `Japanese`), with
 * the whole id kept when that segment is too short to mean anything.
 *
 * Exported for tests: this parses untrusted-ish system output and every branch
 * has a real machine behind it.
 */
export const parseKeyboardInputSource = (stdout: string): string | null => {
  const blocks = stdout.match(/\{[^{}]*\}/g) ?? [];
  let layoutName: string | null = null;

  for (const block of blocks) {
    const kind = readPlistField(block, "InputSourceKind");
    if (kind === "Non Keyboard Input Method") continue;

    const bundleId = readPlistField(block, "Bundle ID");
    if (bundleId) {
      const segments = bundleId.split(".");
      const last = segments.at(-1) ?? "";
      return sanitizeLineValue(last.length > 1 ? last : bundleId, MAX_INPUT_SOURCE_LENGTH) || null;
    }

    const name = readPlistField(block, "KeyboardLayout Name");
    if (name && !layoutName) layoutName = sanitizeLineValue(name, MAX_INPUT_SOURCE_LENGTH) || null;
  }

  return layoutName;
};

/**
 * The active keyboard input source, or null on anything unexpected.
 *
 * macOS only, and never throws: an ask must not fail because a preferences
 * read did. A timeout, a missing key (`defaults` exits non-zero when the domain
 * has no such key), a non-darwin platform and an unparseable array all land in
 * the same place — absence.
 */
export const readKeyboardInputSource = async (): Promise<string | null> => {
  if (process.platform !== "darwin") return null;

  try {
    return parseKeyboardInputSource(await runInputSourceRead());
  } catch (error) {
    // `debug`, not `warn`: unlike a missing model this costs the user one
    // optional line in a prompt, and on a machine where the read is refused it
    // would fire on every single press.
    logger.debug("correction.hotkey", "Keyboard input source unreadable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * The last few transforms, as NAMES AND TIMES ONLY.
 *
 * The user chose this shape explicitly over sending any of the text those
 * transforms carried: "you have been correcting and translating all morning" is
 * useful context, and the corrected paragraphs themselves are the private thing
 * the app exists to keep local. Nothing in this function may ever reach for
 * `original` or `corrected`.
 *
 * Rows with no `presetName` (legacy history, written before the snapshot
 * existed) are skipped rather than listed as an unnamed transform — a bullet
 * saying only a timestamp is a fact with no content.
 */
export const readRecentTransforms = (): RecentTransform[] => {
  try {
    const recent: RecentTransform[] = [];
    // BOUNDED IN SQL, not by slicing here: this runs on every Ask press, and
    // the unbounded `getHistory` would materialize every row of an uncapped
    // history — the whole `original`/`corrected` corpus, on the main thread —
    // to keep five preset names. Rows come back ordered `timestamp DESC`, so
    // they are already most-recent-first.
    //
    // Over-read by a small margin because rows written before the preset-name
    // snapshot existed are skipped below, and a history whose newest five rows
    // are all legacy would otherwise report nothing at all.
    for (const entry of getRecentHistory("corrections", RECENT_HISTORY_READ_LIMIT)) {
      if (recent.length >= MAX_RECENT_TRANSFORMS) break;
      const presetName = sanitizeLineValue(entry.presetName ?? "", MAX_PRESET_NAME_LENGTH);
      if (!presetName || !entry.timestamp) continue;
      recent.push({ presetName, timestamp: entry.timestamp });
    }
    return recent;
  } catch (error) {
    // A history read reaches SQLite, which can fail for reasons that have
    // nothing to do with this press. Counts only — never a name.
    logger.debug("correction.hotkey", "Recent transforms unreadable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * The app's own UI locale, or `""` when the locale store will not answer.
 *
 * Guarded like every other source here rather than trusted because it is the
 * cheapest one: this runs before the input window opens, so an unguarded throw
 * would turn a preferences failure into an ask that never appears — exactly the
 * outcome the best-effort rule exists to prevent. An empty result drops the
 * line, it does not render an empty one.
 */
const readAppLocale = (): string => {
  try {
    return getLocale();
  } catch (error) {
    logger.debug("correction.hotkey", "App locale unreadable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
};

export type ResolveAskEnvironmentOptions = {
  /**
   * `app.getSystemLocale()`, injected rather than imported so this module stays
   * testable without an Electron app object. The caller in `correction.ts` is
   * already inside Electron.
   */
  systemLocale?: string | null;
  /** The press instant. Injected so the rendered string is pinnable in tests. */
  now?: Date;
};

/**
 * Resolves every ambient fact for ONE press.
 *
 * The captured time is the time of the PRESS, not of the submit: a slow typist
 * can leave the input window open for minutes, so the instant in the prompt may
 * be a few minutes stale by the time the request goes out. That is accepted
 * deliberately — re-reading the clock at submit would make the string differ
 * from the one the input window is showing for transparency, and from the one
 * every autocomplete dispatch in between already carried.
 */
export const resolveAskEnvironment = async ({
  systemLocale = null,
  now = new Date(),
}: ResolveAskEnvironmentOptions = {}): Promise<AskEnvironment> => ({
  appLocale: readAppLocale(),
  systemLocale: systemLocale?.trim()
    ? sanitizeLineValue(systemLocale, MAX_LOCALE_LENGTH)
    : null,
  keyboardInputSource: await readKeyboardInputSource(),
  capturedAt: formatLocalIso8601(now),
  timeZone: resolveTimeZone(),
  recentTransforms: readRecentTransforms(),
});

/**
 * The exact text appended to the Ask request, and the exact text the input
 * window shows in its transparency row.
 *
 * A STRICT EXTENSION of `buildAppLocaleDirective()`: the first line is still
 * `App locale: <locale>`, so the directive block a model has always seen is
 * unchanged at its head and only grows below it. The one exception proves the
 * absence rule rather than breaking it — a locale store that would not answer
 * drops the line instead of printing an empty one.
 *
 * NO FENCE, and that is deliberate. `composeAskMessage` fences the attached
 * passage because a passage is opaque text that has to be told apart from the
 * question; these are labelled `Key: value` lines, self-describing, and a blank
 * line already separates them from everything above. Leaving the fence off is
 * also what makes the block safe to WINDOW — `prompt.ts` caps it from the head
 * for the autocomplete dispatch, and a head-slice through a fenced block would
 * cut its closing delimiter off.
 *
 * ABSENT, NEVER EMPTY: a source that could not be read contributes no line at
 * all. `Keyboard input source: unknown` is a fact with no content, and a model
 * handed one will reason from it.
 */
export const buildAskDirectives = (environment: AskEnvironment): string => {
  const lines: string[] = [];

  if (environment.appLocale) {
    lines.push(`App locale: ${environment.appLocale}`);
  }
  if (environment.systemLocale) {
    lines.push(`System language: ${environment.systemLocale}`);
  }
  if (environment.keyboardInputSource) {
    lines.push(`Keyboard input source: ${environment.keyboardInputSource}`);
  }
  lines.push(
    environment.timeZone
      ? `Current time: ${environment.capturedAt} (${environment.timeZone})`
      : `Current time: ${environment.capturedAt}`,
  );
  if (environment.recentTransforms.length > 0) {
    lines.push("Recent transforms (most recent first, names and times only):");
    for (const transform of environment.recentTransforms) {
      lines.push(`- ${transform.presetName} (${transform.timestamp})`);
    }
  }

  return lines.join("\n");
};
