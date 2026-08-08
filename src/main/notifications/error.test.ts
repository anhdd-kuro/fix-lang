import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  AccessibilityPermissionError,
  LocalizedError,
  notifyRequestError,
  showErrorNotification,
} from "./error";

const {
  notificationConstructorMock,
  notificationShowMock,
  notificationState,
  showErrorPopupMock,
  localeStoreMocks,
} = vi.hoisted(() => ({
  notificationConstructorMock: vi.fn(),
  notificationShowMock: vi.fn(),
  notificationState: {
    failNextDelivery: false,
    isReady: true,
    readyListener: undefined as (() => void) | undefined,
    failedListener: undefined as ((event: unknown, error: string) => void) | undefined,
  },
  showErrorPopupMock: vi.fn(),
  localeStoreMocks: { getLocale: vi.fn() },
}));

vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: showErrorPopupMock,
}));

// The desktop-notification title/fallback body are built via `mainT()`,
// which reads `~/features/i18n/store/localeStore` (backed by `electron-store`, itself
// backed by real `app.getPath`). Mocking the store directly — the same
// pattern `correctionNotifications.test.ts` and `windowTitles.test.ts` use —
// keeps this test from touching the filesystem or the real Electron `app`.
vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

vi.mock("electron", () => ({
  app: {
    isReady: () => notificationState.isReady,
    once: (_event: string, listener: () => void) => {
      notificationState.readyListener = listener;
    },
  },
  Notification: class {
    constructor(options: unknown) {
      notificationConstructorMock(options);
      if (notificationState.failNextDelivery) {
        notificationState.failNextDelivery = false;
        throw new Error("Notification service unavailable");
      }
    }

    show = notificationShowMock;

    on(event: string, listener: (event: unknown, error: string) => void) {
      if (event === "failed") notificationState.failedListener = listener;
      return this;
    }
  },
}));

describe("showErrorNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationState.failNextDelivery = false;
    notificationState.isReady = true;
    notificationState.readyListener = undefined;
    notificationState.failedListener = undefined;
    localeStoreMocks.getLocale.mockReturnValue("en");
  });

  it("shows an error only once as the same Error crosses application layers", () => {
    const error = new Error("The AI request failed.");

    showErrorNotification(error);
    showErrorNotification(error);

    expect(notificationConstructorMock).toHaveBeenCalledOnce();
    expect(notificationShowMock).toHaveBeenCalledOnce();
    expect(showErrorPopupMock).not.toHaveBeenCalled();
  });

  it("uses the in-app fallback once when notification delivery fails", () => {
    const error = new Error("The AI request failed.");
    notificationState.failNextDelivery = true;

    showErrorNotification(error);
    showErrorNotification(error);

    expect(notificationConstructorMock).toHaveBeenCalledOnce();
    expect(notificationShowMock).not.toHaveBeenCalled();
    expect(showErrorPopupMock).toHaveBeenCalledOnce();
  });

  it("queues a startup error until Electron is ready", () => {
    notificationState.isReady = false;
    const error = new Error("Startup failed.");

    showErrorNotification(error);

    expect(notificationConstructorMock).not.toHaveBeenCalled();
    expect(notificationState.readyListener).toBeTypeOf("function");

    notificationState.isReady = true;
    notificationState.readyListener?.();

    expect(notificationConstructorMock).toHaveBeenCalledOnce();
    expect(notificationShowMock).toHaveBeenCalledOnce();
  });

  it("shows the in-app popup when macOS rejects a desktop notification", () => {
    const error = new Error("Cannot connect to the AI provider.");

    showErrorNotification(error);
    notificationState.failedListener?.({}, "Application is not code signed");

    expect(showErrorPopupMock).toHaveBeenCalledWith(
      "Cannot connect to the AI provider.",
    );
  });

  it("uses the English-localized notification title", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    const error = new Error("The AI request failed.");

    showErrorNotification(error);

    expect(notificationConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: tEn("notifications.error.title") }),
    );
  });

  it("uses the Japanese-localized notification title, distinct from English", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");
    const error = new Error("The AI request failed.");

    showErrorNotification(error);

    expect(notificationConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: tJa("notifications.error.title") }),
    );
    // Prove the locale actually changed the wording, not just an English fallback.
    expect(tJa("notifications.error.title")).not.toBe(
      tEn("notifications.error.title"),
    );
  });

  it("falls back to the localized default body for a non-Error value", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    showErrorNotification("a raw string was thrown");

    expect(notificationConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: tJa("notifications.error.body") }),
    );
    expect(tJa("notifications.error.body")).not.toBe(
      tEn("notifications.error.body"),
    );
  });

  // ---------------------------------------------------------------------
  // LocalizedError — the notification body must come from the catalog key,
  // NOT `Error.message` (which stays an English developer diagnostic for
  // `console.error`/the structured logger). This is the mechanism behind
  // every "manufactured control-flow Error" fix (no text selected, no
  // profiles available, hotkey registration failed): each call site now
  // constructs a `LocalizedError` instead of a plain `Error`.
  // ---------------------------------------------------------------------
  describe("LocalizedError", () => {
    const cases: {
      description: string;
      devMessage: string;
      messageKey: Parameters<typeof tEn>[0];
    }[] = [
      {
        description: "no text selected (correction hotkey / PromptGen hotkey)",
        devMessage: "No text selected or clipboard is empty.",
        messageKey: "notifications.error.noTextSelected.body",
      },
      {
        description: "no profiles available (profile-switch hotkey)",
        devMessage: "No profiles available.",
        messageKey: "notifications.error.noProfilesAvailable.body",
      },
      {
        description: "hotkey registration failed (checkShortcut)",
        devMessage: "Shortcut false is not set in settings.",
        messageKey: "notifications.error.hotkeyRegistrationFailed.body",
      },
    ];

    it.each(cases)(
      "shows the catalog body for $description, in English",
      ({ devMessage, messageKey }) => {
        localeStoreMocks.getLocale.mockReturnValue("en");
        const error = new LocalizedError(devMessage, messageKey);

        showErrorNotification(error);

        expect(notificationConstructorMock).toHaveBeenCalledWith(
          expect.objectContaining({ body: tEn(messageKey) }),
        );
        // The English developer diagnostic must never leak into the body —
        // that's exactly the bug being fixed.
        expect(notificationConstructorMock).not.toHaveBeenCalledWith(
          expect.objectContaining({ body: devMessage }),
        );
      },
    );

    it.each(cases)(
      "shows the catalog body for $description, in Japanese, distinct from English",
      ({ devMessage, messageKey }) => {
        localeStoreMocks.getLocale.mockReturnValue("ja");
        const error = new LocalizedError(devMessage, messageKey);

        showErrorNotification(error);

        expect(notificationConstructorMock).toHaveBeenCalledWith(
          expect.objectContaining({ body: tJa(messageKey) }),
        );
        expect(tJa(messageKey)).not.toBe(tEn(messageKey));
      },
    );

    it("keeps the English devMessage on .message for logging, even in Japanese", () => {
      localeStoreMocks.getLocale.mockReturnValue("ja");
      const error = new LocalizedError(
        "No profiles available.",
        "notifications.error.noProfilesAvailable.body",
      );

      expect(error.message).toBe("No profiles available.");

      showErrorNotification(error);

      expect(notificationConstructorMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: tJa("notifications.error.noProfilesAvailable.body") }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // AccessibilityPermissionError — a dedicated LocalizedError subclass so
  // `handleError` can recognize a revoked macOS Accessibility permission via
  // `instanceof` (see keybindings/utils.ts) and trigger the actionable
  // `promptAccessibilityPermission()` dialog, on top of the same catalog-body
  // notification behavior every other LocalizedError gets.
  // ---------------------------------------------------------------------
  describe("AccessibilityPermissionError", () => {
    it("shows the catalog body in English, not the English devMessage", () => {
      localeStoreMocks.getLocale.mockReturnValue("en");
      const error = new AccessibilityPermissionError();

      showErrorNotification(error);

      expect(notificationConstructorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: tEn("notifications.error.accessibilityDenied.body"),
        }),
      );
      expect(notificationConstructorMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ body: error.message }),
      );
    });

    it("shows the catalog body in Japanese, distinct from English", () => {
      localeStoreMocks.getLocale.mockReturnValue("ja");
      const error = new AccessibilityPermissionError();

      showErrorNotification(error);

      expect(notificationConstructorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: tJa("notifications.error.accessibilityDenied.body"),
        }),
      );
      expect(tJa("notifications.error.accessibilityDenied.body")).not.toBe(
        tEn("notifications.error.accessibilityDenied.body"),
      );
    });

    it("is a LocalizedError keyed to the accessibility-denied catalog entry", () => {
      const error = new AccessibilityPermissionError();

      expect(error).toBeInstanceOf(LocalizedError);
      expect(error.messageKey).toBe("notifications.error.accessibilityDenied.body");
    });
  });

  // A caller that cancels its own request already knows the outcome. This
  // matters most for autocomplete, which supersedes the in-flight request on
  // every keystroke: without suppression each abort rejects through a provider
  // `catch` that notifies, so the user gets one notification per character.
  describe("cancellation", () => {
    const abortError = (): Error => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return error;
    };

    it("stays silent for an aborted request", () => {
      showErrorNotification(abortError());

      expect(notificationConstructorMock).not.toHaveBeenCalled();
      expect(showErrorPopupMock).not.toHaveBeenCalled();
    });

    it("stays silent for a timed-out request", () => {
      const error = new Error("The operation timed out.");
      error.name = "TimeoutError";

      showErrorNotification(error);

      expect(notificationConstructorMock).not.toHaveBeenCalled();
      expect(showErrorPopupMock).not.toHaveBeenCalled();
    });

    // The AI SDK re-wraps the underlying fetch rejection, so the abort is not
    // the outermost error by the time a provider `catch` sees it.
    it("stays silent for an abort wrapped by another error", () => {
      const wrapped = new Error("Failed to get a response.", { cause: abortError() });

      showErrorNotification(wrapped);

      expect(notificationConstructorMock).not.toHaveBeenCalled();
      expect(showErrorPopupMock).not.toHaveBeenCalled();
    });

    it("does not suppress a genuine failure that merely mentions aborting", () => {
      showErrorNotification(new Error("The provider aborted the stream."));

      expect(notificationConstructorMock).toHaveBeenCalledOnce();
    });

    // A self-referencing `cause` must not hang the walk.
    it("terminates on a cyclic cause chain", () => {
      const error = new Error("Cyclic.") as Error & { cause?: unknown };
      error.cause = error;

      showErrorNotification(error);

      expect(notificationConstructorMock).toHaveBeenCalledOnce();
    });
  });

  // The eleven provider notify sites all route through this helper, so its
  // polarity is the single thing standing between a quiet request and a
  // notification per keystroke.
  describe("notifyRequestError", () => {
    it("notifies for a request that did not ask to stay quiet", () => {
      notifyRequestError({}, new Error("The AI request failed."));

      expect(notificationConstructorMock).toHaveBeenCalledOnce();
    });

    it("stays silent for a quiet request", () => {
      notifyRequestError({ quiet: true }, new Error("The AI request failed."));

      expect(notificationConstructorMock).not.toHaveBeenCalled();
      expect(showErrorPopupMock).not.toHaveBeenCalled();
    });

    it("passes a caller fallback through for a non-Error value", () => {
      notifyRequestError({}, "not an error", "Failed to reach the provider.");

      expect(notificationConstructorMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Failed to reach the provider." }),
      );
    });

    // Omitting the argument must fall through to the localized default rather
    // than passing `undefined` as the body.
    it("uses the localized default body when no fallback is given", () => {
      notifyRequestError({}, "not an error");

      expect(notificationConstructorMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: tEn("notifications.error.body") }),
      );
    });
  });
});
