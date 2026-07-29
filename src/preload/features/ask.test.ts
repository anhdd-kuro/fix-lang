import { beforeEach, describe, expect, it, vi } from "vitest";
import { askFeature } from "./ask";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

describe("ask preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ask-input-data", () => {
    it("passes a valid payload through to the callback", () => {
      const callback = vi.fn();
      askFeature.onAskInputData(callback);

      expect(electronMocks.on).toHaveBeenCalledWith(
        "ask-input-data",
        expect.any(Function),
      );
      const listener = electronMocks.on.mock.calls[0][1] as (
        event: unknown,
        payload: unknown,
      ) => void;

      listener(undefined, { presetId: "ask", context: "selected text" });
      expect(callback).toHaveBeenCalledWith({
        presetId: "ask",
        context: "selected text",
      });
    });

    it.each([
      undefined,
      null,
      "a string",
      { context: "no presetId" },
      { presetId: 42, context: "" },
      { presetId: "ask", context: 42 },
      { presetId: "ask" },
    ])("drops a malformed ask-input-data payload: %j", (payload) => {
      const callback = vi.fn();
      askFeature.onAskInputData(callback);
      const listener = electronMocks.on.mock.calls[0][1] as (
        event: unknown,
        payload: unknown,
      ) => void;

      listener(undefined, payload);
      expect(callback).not.toHaveBeenCalled();
    });

    it("the returned unsubscribe function removes the same listener", () => {
      const callback = vi.fn();
      const unsubscribe = askFeature.onAskInputData(callback);
      const listener = electronMocks.on.mock.calls[0][1];

      unsubscribe();

      expect(electronMocks.removeListener).toHaveBeenCalledWith(
        "ask-input-data",
        listener,
      );
    });

    it("signalAskInputReady sends ask-input-ready", () => {
      askFeature.signalAskInputReady();
      expect(electronMocks.send).toHaveBeenCalledWith("ask-input-ready");
    });

    it("submitAskInput sends ask-input-submit with the question text", () => {
      askFeature.submitAskInput("What does this mean?");
      expect(electronMocks.send).toHaveBeenCalledWith(
        "ask-input-submit",
        "What does this mean?",
      );
    });

    it("cancelAskInput sends ask-input-cancel", () => {
      askFeature.cancelAskInput();
      expect(electronMocks.send).toHaveBeenCalledWith("ask-input-cancel");
    });
  });

  describe("ask-result-data", () => {
    it("passes a valid payload through to the callback", () => {
      const callback = vi.fn();
      askFeature.onAskResultData(callback);

      expect(electronMocks.on).toHaveBeenCalledWith(
        "ask-result-data",
        expect.any(Function),
      );
      const listener = electronMocks.on.mock.calls[0][1] as (
        event: unknown,
        payload: unknown,
      ) => void;

      listener(undefined, {
        question: "What does this mean?",
        answer: "It means...",
        markdown: true,
      });
      expect(callback).toHaveBeenCalledWith({
        question: "What does this mean?",
        answer: "It means...",
        markdown: true,
      });
    });

    it("passes through the optional presetName when it is a string", () => {
      const callback = vi.fn();
      askFeature.onAskResultData(callback);
      const listener = electronMocks.on.mock.calls[0][1] as (
        event: unknown,
        payload: unknown,
      ) => void;

      listener(undefined, {
        presetName: "Ask AI",
        question: "q",
        answer: "a",
        markdown: false,
      });
      expect(callback).toHaveBeenCalledWith({
        presetName: "Ask AI",
        question: "q",
        answer: "a",
        markdown: false,
      });
    });

    it.each([
      undefined,
      null,
      "a string",
      { answer: "a", markdown: true }, // missing question
      { question: "q", answer: 42, markdown: true }, // non-string answer
      { question: "q", answer: "a", markdown: "yes" }, // non-boolean markdown
      { question: "q", answer: "a", markdown: true, presetName: 42 }, // non-string presetName
    ])("drops a malformed ask-result-data payload: %j", (payload) => {
      const callback = vi.fn();
      askFeature.onAskResultData(callback);
      const listener = electronMocks.on.mock.calls[0][1] as (
        event: unknown,
        payload: unknown,
      ) => void;

      listener(undefined, payload);
      expect(callback).not.toHaveBeenCalled();
    });

    it("the returned unsubscribe function removes the same listener", () => {
      const callback = vi.fn();
      const unsubscribe = askFeature.onAskResultData(callback);
      const listener = electronMocks.on.mock.calls[0][1];

      unsubscribe();

      expect(electronMocks.removeListener).toHaveBeenCalledWith(
        "ask-result-data",
        listener,
      );
    });

    it("signalAskResultReady sends ask-result-ready", () => {
      askFeature.signalAskResultReady();
      expect(electronMocks.send).toHaveBeenCalledWith("ask-result-ready");
    });

    it("closeAskResultWindow sends close-ask-result-window", () => {
      askFeature.closeAskResultWindow();
      expect(electronMocks.send).toHaveBeenCalledWith(
        "close-ask-result-window",
      );
    });
  });
});
