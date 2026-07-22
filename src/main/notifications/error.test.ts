import { beforeEach, describe, expect, it, vi } from "vitest";
import { showErrorNotification } from "./error";

const {
  notificationConstructorMock,
  notificationShowMock,
  notificationState,
  showErrorPopupMock,
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
}));

vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: showErrorPopupMock,
}));

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
});
