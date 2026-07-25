import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { showErrorNotification } from "./error";

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
// which reads `~/stores/localeStore` (backed by `electron-store`, itself
// backed by real `app.getPath`). Mocking the store directly — the same
// pattern `correctionNotifications.test.ts` and `windowTitles.test.ts` use —
// keeps this test from touching the filesystem or the real Electron `app`.
vi.mock("~/stores/localeStore", () => ({
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
});
