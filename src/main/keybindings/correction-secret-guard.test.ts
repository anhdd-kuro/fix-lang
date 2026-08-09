/**
 * @file correction-secret-guard.test.ts
 * @description Guard for the secret gate wired into `registerCorrectionShortcut`'s
 * ordinary (non-Ask) preset branch — the only send site in the app that can
 * paste a model's reply over a real credential in another application.
 *
 * `runSecretGate`, `scanForSecrets`, `maskSecrets` and `restoreSecrets` are all
 * kept REAL, the same way `correction-selection-guards.test.ts` keeps
 * `evaluateSelectionGuards` real: only the electron-touching neighbours
 * (`secretGuardStore`, `confirmSecretSend`) are mocked. That matters here more
 * than anywhere else — a mocked gate would let a call site that re-derives the
 * per-site policy pass, which is exactly the failure `SECRET_SEND_SITE_POLICY`
 * exists to prevent.
 *
 * The salt is random in production and is deliberately NOT injected here, so
 * every assertion about the masked text is structural (the placeholder shape,
 * and the absence of the credential) rather than a pinned string. `fixGrammar`
 * is mocked with an IMPLEMENTATION that transforms whatever it is handed, so a
 * test cannot accidentally assert against a reply built from text the request
 * never actually saw.
 */
import { globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
const notificationMocks = vi.hoisted(() => ({
  shown: [] as Electron.NotificationConstructorOptions[],
}));
vi.mock("electron-store", () => {
  class MockStore {
    get = vi.fn().mockReturnValue(undefined);
    set = vi.fn();
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  globalShortcut: { register: vi.fn().mockReturnValue(true) },
  Notification: class {
    constructor(options: Electron.NotificationConstructorOptions) {
      notificationMocks.shown.push(options);
    }
    show = vi.fn();
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
    getLocale: vi.fn().mockReturnValue("en-US"),
  },
}));
vi.mock("~/features/providers/store/apiStore", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importActual returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    getProfileSetting: vi.fn(),
    updateProfileSetting: vi.fn(),
    getDefaultModelId: vi.fn().mockReturnValue(""),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: {
    getKeyBindings: vi.fn(() => ({
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    })),
  },
}));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  // "paste" so the restore-failure branch has a real paste to divert AWAY from.
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("paste") },
}));
vi.mock("~/features/guards/store/guardStore", () => ({
  guardStore: { getSelectionGuardSettings: vi.fn() },
}));
vi.mock("~/features/secretGuard/store/secretGuardStore", () => ({
  secretGuardStore: { getSecretGuardSettings: vi.fn() },
}));
vi.mock("~/main/notifications/secretGuardDialog", () => ({
  confirmSecretSend: vi.fn(),
}));
// The locale is pinned so the notification copy asserted below is derived
// through the real translator kernel rather than hand-copied.
vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: vi.fn().mockReturnValue("en"),
}));
vi.mock("../clipboard/clipboardChangeTracker", () => ({ ageMs: vi.fn() }));
vi.mock("../notifications/confirmLargeSelection", () => ({
  confirmLargeSelection: vi.fn(),
}));
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi.fn(),
  getHighlightedTextForOptionalContext: vi.fn().mockResolvedValue(""),
  pasteText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai.request", () => ({ fixGrammar: vi.fn() }));
vi.mock("~/features/history/main/history", () => ({ syncHistory: vi.fn() }));
vi.mock("../logging/logService", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../webViewWindows", () => ({
  hideOverlaySpinner: vi.fn(),
  showOverlaySpinner: vi.fn(),
}));
vi.mock("../webViewWindows/correctionResultWindow", () => ({
  showCorrectionResultWindow: vi.fn(),
}));
vi.mock("../webViewWindows/askInputWindow", () => ({
  showAskInputWindow: vi.fn(),
}));
vi.mock("./askFlow", () => ({ runAskFlow: vi.fn() }));
// `withHotkeyThrottle` stays REAL, same reason as `correction-preset-hotkeys.test.ts`.
vi.mock("./utils", async (importOriginal) => {
  const real = await importOriginal<typeof KeybindingUtils>();
  return { ...real, checkShortcut: vi.fn(), handleError: vi.fn() };
});
// `notifications/error` reaches `overlay.html?asset`, which vite cannot parse
// as JS under vitest. Stub that leaf so `LocalizedError` stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { guardStore } from "~/features/guards/store/guardStore";
import { syncHistory } from "~/features/history/main/history";
import { createTranslator } from "~/features/i18n/shared/translate";
import { redactLogContext } from "~/features/logs/shared/logging";
import { getProfileSetting, normalizeCorrectionSettings } from "~/features/providers/store/apiStore";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import { registerCorrectionShortcut } from "./correction";
import { handleError, resetHotkeyThrottleForTests } from "./utils";
import { getHighlightedTextWithActiveApp, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { logger } from "../logging/logService";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

const CORRECTION_HOTKEY = "Control+Shift+F";

/** A credential shaped exactly like the `openai-key` rule's pattern. */
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwx";
const SELECTION_WITH_SECRET = `please fix this sentence my key is ${OPENAI_KEY} thanks`;
const SELECTION_WITHOUT_SECRET = "please fix this sentence thanks";

/** The salt is random in production, so the placeholder is matched by shape. */
const PLACEHOLDER_PATTERN = /\[\[FIXLANG_SECRET_[0-9A-F]{6}_\d{2}\]\]/;

const tEn = createTranslator("en");

const SINGLE_BUILT_IN_PROFILE = {
  presets: [
    {
      id: "correction",
      name: "Correction",
      hotkey: CORRECTION_HOTKEY,
      systemPrompt: "Correction prompt.",
      model: "openai/gpt-4.1-mini",
      isBuiltIn: true,
    },
  ],
  selectedPresetId: "correction",
};

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

const registerCorrectionHandler = (): (() => Promise<void>) => {
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models" ? [] : normalizeCorrectionSettings(SINGLE_BUILT_IN_PROFILE),
  );

  registerCorrectionShortcut(fakeMainWindow());

  const call = (globalShortcut.register as Mock).mock.calls.find(
    ([shortcut]) => shortcut === CORRECTION_HOTKEY,
  );
  if (!call) {
    throw new Error("correction hotkey never registered");
  }
  return call[1] as () => Promise<void>;
};

const mockSelection = (text: string): void => {
  (getHighlightedTextWithActiveApp as Mock).mockImplementation(
    async (onFrontmostReadAndKeystrokeSent?: () => void) => {
      onFrontmostReadAndKeystrokeSent?.();
      return { text, activeApp: null, changed: true };
    },
  );
};

const setGuardMode = (settings: Partial<SecretGuardSettings>): void => {
  (secretGuardStore.getSecretGuardSettings as Mock).mockReturnValue({
    mode: "confirm",
    highEntropyRule: false,
    ...settings,
  });
};

const AI_RESULT_BASE = {
  promptTokens: 10,
  completionTokens: 5,
  model: "openai/gpt-4.1-mini",
  provider: "openai" as const,
  resolvedModel: "openai/gpt-4.1-mini",
  presetName: "Correction",
};

/**
 * Replies are derived from the text the request ACTUALLY received, so an
 * assertion can never describe a round trip that did not happen.
 */
const mockReply = (transform: (sent: string) => string): void => {
  (fixGrammar as Mock).mockImplementation(async (text: string) => ({
    ...AI_RESULT_BASE,
    correctedText: transform(text),
  }));
};

/** What the request was handed. */
const sentToProvider = (): string => (fixGrammar as Mock).mock.calls[0][0] as string;

const latencyFinishCalls = () =>
  (logger.info as Mock).mock.calls.filter(([scope]) => scope === "correction.latency");

const historyEntry = () =>
  (syncHistory as Mock).mock.calls[0]?.[0]?.entry as
    | { original: string; corrected: string }
    | undefined;

const goodJobShown = (): boolean =>
  notificationMocks.shown.some(
    (options) => options.title === tEn("notifications.correction.goodJob.title"),
  );

const restoreFailedShown = (): boolean =>
  notificationMocks.shown.some(
    (options) => options.title === tEn("notifications.secretGuard.restoreFailed.title"),
  );

beforeEach(() => {
  vi.clearAllMocks();
  notificationMocks.shown.length = 0;
  resetHotkeyThrottleForTests();
  (globalShortcut.register as Mock).mockReturnValue(true);
  (guardStore.getSelectionGuardSettings as Mock).mockReturnValue({
    clipboardMaxAgeSeconds: 0,
    maxSelectionChars: 20_000,
    deniedBundleIds: [],
  });
  (clipboardChangeTracker.ageMs as Mock).mockReturnValue(null);
  setGuardMode({ mode: "confirm" });
  (confirmSecretSend as Mock).mockResolvedValue(true);
  mockReply((sent) => sent.replace("please", "Please"));
});

describe("correction secret guard — off", () => {
  it("sends the raw selection, never opens the dialog, and stores raw history", async () => {
    setGuardMode({ mode: "off" });
    mockSelection(SELECTION_WITH_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(sentToProvider()).toBe(SELECTION_WITH_SECRET);
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(historyEntry()?.original).toBe(SELECTION_WITH_SECRET);
    expect(historyEntry()?.corrected).toContain(OPENAI_KEY);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered" });
  });
});

describe("correction secret guard — confirm, nothing detected", () => {
  it("opens no dialog and never blinks the spinner", async () => {
    mockSelection(SELECTION_WITHOUT_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(sentToProvider()).toBe(SELECTION_WITHOUT_SECRET);
    // Shown once by the combined-read callback, hidden once at the end: a
    // dialog-lifetime hide/show pair here would be a blink on the vast
    // majority of transforms, which is what `aroundDialog` exists to avoid.
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(pasteText).toHaveBeenCalledTimes(1);
  });
});

describe("correction secret guard — confirm, declined", () => {
  it("sends nothing, pastes nothing, raises no error toast, and finishes once as secret-declined", async () => {
    mockSelection(SELECTION_WITH_SECRET);
    (confirmSecretSend as Mock).mockResolvedValue(false);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();
    // Cancel is a decision, not an error — same rule as the size confirm.
    expect(handleError).not.toHaveBeenCalled();

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "secret-declined" });
  });

  it("hides the spinner for exactly the dialog's lifetime", async () => {
    mockSelection(SELECTION_WITH_SECRET);
    let spinnerDuringDialog: { shown: number; hidden: number } | null = null;
    (confirmSecretSend as Mock).mockImplementation(async () => {
      spinnerDuringDialog = {
        shown: (showOverlaySpinner as Mock).mock.calls.length,
        hidden: (hideOverlaySpinner as Mock).mock.calls.length,
      };
      return false;
    });

    const handler = registerCorrectionHandler();
    await handler();

    // Shown once (combined read), hidden once — the spinner is down WHILE the
    // modal is up, not bracketing the whole gate.
    expect(spinnerDuringDialog).toEqual({ shown: 1, hidden: 1 });
  });
});

describe("correction secret guard — confirm, Send anyway", () => {
  it("sends the RAW selection and stores raw history on both sides", async () => {
    mockSelection(SELECTION_WITH_SECRET);
    (confirmSecretSend as Mock).mockResolvedValue(true);

    const handler = registerCorrectionHandler();
    await handler();

    expect(sentToProvider()).toBe(SELECTION_WITH_SECRET);
    expect(pasteText).toHaveBeenCalledTimes(1);
    // The dialog said the real value would be included; raw history after an
    // explicit Send anyway is the honest record of what happened.
    expect(historyEntry()?.original).toBe(SELECTION_WITH_SECRET);
    expect(historyEntry()?.corrected).toContain(OPENAI_KEY);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered" });
  });

  it("re-shows the spinner after the dialog so the request is not run bare", async () => {
    mockSelection(SELECTION_WITH_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    expect(showOverlaySpinner).toHaveBeenCalledTimes(2);
  });

  it("excludes the user's deliberation from totalMs and reports it as pausedMs", async () => {
    mockSelection(SELECTION_WITH_SECRET);

    const DIALOG_WAIT_MS = 15_000;
    // `withHotkeyThrottle` reads `Date.now` (spied below) at registration and
    // compares against a `last` of 0 cleared by `resetHotkeyThrottleForTests`
    // — starting at 0 would drop the press inside the throttle window.
    let clock = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    (confirmSecretSend as Mock).mockImplementation(async () => {
      clock += DIALOG_WAIT_MS;
      return true;
    });

    try {
      const handler = registerCorrectionHandler();
      await handler();
    } finally {
      dateNowSpy.mockRestore();
    }

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    const [, , context] = finishes[0];
    expect(context).toMatchObject({ outcome: "delivered" });
    expect(context.pausedMs).toBe(DIALOG_WAIT_MS);
    expect(context.totalMs).toBe(0);
  });
});

describe("correction secret guard — mask and restore", () => {
  it("sends the masked text, pastes the restored reply, and never opens a dialog", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    // Masking suppresses the confirm dialog: nothing is sent, so there is
    // nothing to confirm.
    expect(confirmSecretSend).not.toHaveBeenCalled();

    const sent = sentToProvider();
    expect(sent).not.toContain(OPENAI_KEY);
    expect(sent).toMatch(PLACEHOLDER_PATTERN);

    expect(pasteText).toHaveBeenCalledTimes(1);
    const pasted = (pasteText as Mock).mock.calls[0][0] as string;
    expect(pasted).toContain(OPENAI_KEY);
    expect(pasted).not.toMatch(PLACEHOLDER_PATTERN);
    expect(pasted).toBe(`Please fix this sentence my key is ${OPENAI_KEY} thanks`);

    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered", delivery: "pasted" });
  });

  it("stores MASKED text on both sides of history", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    const entry = historyEntry();
    // The history DB is unencrypted under userData and the snapshot viewer has
    // copy buttons — writing the restored text there would recreate, durably,
    // exactly the exposure masking removed.
    expect(entry?.original).not.toContain(OPENAI_KEY);
    expect(entry?.original).toMatch(PLACEHOLDER_PATTERN);
    expect(entry?.corrected).not.toContain(OPENAI_KEY);
    expect(entry?.corrected).toMatch(PLACEHOLDER_PATTERN);
    expect(entry?.original).toBe(sentToProvider());
  });

  it("fires the good-job notification when the reply matches the SENT text", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);
    // An identity echo: the model returned exactly what it was given. Comparing
    // the reply against the UNMASKED selection would compare masked to
    // unmasked and silently miss this.
    mockReply((sent) => sent);

    const handler = registerCorrectionHandler();
    await handler();

    expect(goodJobShown()).toBe(true);
    expect(pasteText).toHaveBeenCalledWith(SELECTION_WITH_SECRET);
  });
});

describe("correction secret guard — mask, restore failure", () => {
  const mockMangledReply = (): void => {
    mockReply((sent) => sent.replace(PLACEHOLDER_PATTERN, "[[REDACTED_BY_MODEL]]"));
  };

  it("diverts to the popup with the MASKED reply and never pastes", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);
    mockMangledReply();

    const handler = registerCorrectionHandler();
    await handler();

    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).toHaveBeenCalledTimes(1);

    const payload = (showCorrectionResultWindow as Mock).mock.calls[0][0] as { text: string };
    // Not a partial restore: a mixture of real secrets and placeholders is
    // indistinguishable, and the popup is copyable.
    expect(payload.text).not.toContain(OPENAI_KEY);
    expect(payload.text).toContain("[[REDACTED_BY_MODEL]]");
  });

  it("fires the Result-not-pasted notification and warns", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);
    mockMangledReply();

    const handler = registerCorrectionHandler();
    await handler();

    expect(restoreFailedShown()).toBe(true);

    const warn = (logger.warn as Mock).mock.calls.find(
      ([scope]) => scope === "secretGuard.mask",
    );
    expect(warn).toBeDefined();
    expect(warn?.[2]).toMatchObject({
      presetId: "correction",
      reason: "placeholder-missing",
      missingCount: 1,
    });
    // Fed through the REAL redactor: a key merely CONTAINING `secret`/`token`/
    // `clipboard`/`password`/`selected_text` persists as "[REDACTED]" with no
    // error at all.
    expect(redactLogContext(warn?.[2])).toEqual(warn?.[2]);
  });

  it("suppresses the good-job notification even when the reply echoes the sent text byte-for-byte", async () => {
    setGuardMode({ mode: "mask" });
    // `mockMangledReply` (used by the other tests in this block) always makes
    // `correctedText !== sentText`, so it never exercises the `restore.ok &&`
    // half of the good-job guard at all — a mutant that deletes that clause
    // still passes every test built on a mangled reply. Proving the guard
    // needs a reply that IS byte-identical to `sentText` while restore STILL
    // fails, which needs a residue collision rather than a missing
    // placeholder: if the reply equals `sentText` exactly, every placeholder
    // `sentText` contains is necessarily present in the reply too, so
    // "placeholder-missing" can never fire on a true echo. What CAN survive an
    // exact echo is text elsewhere in the selection that happens to already
    // look like the salted marker `restoreSecrets` scans for — untouched by
    // masking because it is not shaped like a credential, so it rides along
    // into `sentText` and back out again unchanged.
    //
    // The salt is normally unpredictable (`maskSecrets` draws it from
    // `Math.random`, and this call site never injects one), so it has to be
    // pinned here to construct a residue string that collides with it.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const RESIDUE_TEXT = "note leftover tag fixlang_secret_000000_99 stray";
    mockSelection(`${SELECTION_WITH_SECRET} ${RESIDUE_TEXT}`);
    // Identity echo — not a mangled one — is what makes this the case the
    // guard's `restore.ok &&` clause exists for.
    mockReply((sent) => sent);

    try {
      const handler = registerCorrectionHandler();
      await handler();
    } finally {
      randomSpy.mockRestore();
    }

    const sent = sentToProvider();
    // The precondition the good-job guard is named for: the model returned
    // exactly what it was sent.
    const popupPayload = (showCorrectionResultWindow as Mock).mock.calls[0]?.[0] as
      | { text: string }
      | undefined;
    expect(popupPayload?.text).toBe(sent);
    // And the restore genuinely failed on residue, not on a missing placeholder.
    expect(restoreFailedShown()).toBe(true);
    const warn = (logger.warn as Mock).mock.calls.find(([scope]) => scope === "secretGuard.mask");
    expect(warn?.[2]).toMatchObject({ reason: "placeholder-residue", missingCount: 0 });
    expect(pasteText).not.toHaveBeenCalled();

    // The property under test: a failed restore must suppress the good-job
    // notification EVEN THOUGH the reply echoed sentText exactly. Removing
    // `restore.ok &&` from the guard would show the user "no changes needed"
    // and "Result not pasted" at the same time.
    expect(goodJobShown()).toBe(false);
  });

  it("finishes exactly once, as delivered to the popup", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);
    mockMangledReply();

    const handler = registerCorrectionHandler();
    await handler();

    expect(handleError).not.toHaveBeenCalled();
    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered", delivery: "popup" });
  });

  it("still stores masked text on both sides", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITH_SECRET);
    mockMangledReply();

    const handler = registerCorrectionHandler();
    await handler();

    const entry = historyEntry();
    expect(entry?.original).not.toContain(OPENAI_KEY);
    expect(entry?.corrected).not.toContain(OPENAI_KEY);
  });
});

describe("correction secret guard — mask with nothing detected", () => {
  it("takes the same single reply path and pastes normally", async () => {
    setGuardMode({ mode: "mask" });
    mockSelection(SELECTION_WITHOUT_SECRET);

    const handler = registerCorrectionHandler();
    await handler();

    // An empty masking restores ok:true, so there is no special case here.
    expect(sentToProvider()).toBe(SELECTION_WITHOUT_SECRET);
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    expect(restoreFailedShown()).toBe(false);
  });
});

describe("correction secret guard — decline log redaction safety", () => {
  it("emits only keys the real redactor leaves intact", async () => {
    mockSelection(SELECTION_WITH_SECRET);
    (confirmSecretSend as Mock).mockResolvedValue(false);

    const handler = registerCorrectionHandler();
    await handler();

    const declineContext = (logger.info as Mock).mock.calls.find(
      ([scope, message]) =>
        scope === "correction.hotkey" && message === "Transform declined at the secret guard",
    )?.[2];
    expect(declineContext).toBeDefined();
    expect(redactLogContext(declineContext)).toEqual(declineContext);
  });
});
