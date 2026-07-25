import { describe, expect, it, vi } from "vitest";
import {
  documentAttrsForLocale,
  INITIAL_LOCALE_STATE,
  localeReducer,
  requestSetLocale,
  resolveInitialLocale,
  subscribeToLocaleBroadcasts,
  type LocaleBridge,
  type LocaleState,
} from "./localeState";
import type { Locale } from "~/shared/i18n/registry";

describe("localeReducer", () => {
  it("starts loading with the default locale", () => {
    expect(INITIAL_LOCALE_STATE).toEqual({ locale: "en", status: "loading" });
  });

  it("resolves the initial locale", () => {
    const next = localeReducer(INITIAL_LOCALE_STATE, { type: "resolved", locale: "ja" });
    expect(next).toEqual({ locale: "ja", status: "ready" });
  });

  it("applies a broadcast update after the initial resolution", () => {
    const ready: LocaleState = { locale: "en", status: "ready" };
    const next = localeReducer(ready, { type: "broadcast", locale: "ja" });
    expect(next).toEqual({ locale: "ja", status: "ready" });
  });

  it("ignores a stale `resolved` snapshot that arrives after a broadcast already set the locale — same reference", () => {
    // Simulates the race: this window's in-flight `getLocale()` (issued
    // before another window changed the language) resolves with the OLD
    // locale, but a `locale-changed` broadcast for the NEW locale already
    // landed first and moved status to "ready".
    const readyFromBroadcast: LocaleState = { locale: "ja", status: "ready" };
    const next = localeReducer(readyFromBroadcast, { type: "resolved", locale: "en" });
    expect(next).toBe(readyFromBroadcast);
    expect(next.locale).toBe("ja");
  });

  it("a broadcast always wins, including immediately after another broadcast", () => {
    const afterFirstBroadcast: LocaleState = { locale: "ja", status: "ready" };
    const next = localeReducer(afterFirstBroadcast, { type: "broadcast", locale: "en" });
    expect(next).toEqual({ locale: "en", status: "ready" });
  });

  it("ordering: broadcast-then-resolved leaves the broadcast locale in place", () => {
    let state: LocaleState = INITIAL_LOCALE_STATE;
    state = localeReducer(state, { type: "broadcast", locale: "ja" });
    expect(state).toEqual({ locale: "ja", status: "ready" });

    const afterBroadcast = state;
    state = localeReducer(state, { type: "resolved", locale: "en" });
    // The stale `resolved` snapshot (carrying the pre-broadcast locale) must
    // not undo the broadcast — same reference, not just equal fields.
    expect(state).toBe(afterBroadcast);
    expect(state.locale).toBe("ja");
  });

  it("leaves state unchanged (same reference) when setLocale is rejected", () => {
    const ready: LocaleState = { locale: "en", status: "ready" };
    const next = localeReducer(ready, { type: "setLocaleRejected" });
    expect(next).toBe(ready);
  });

  it("a rejected setLocale does not change the locale even mid-transition", () => {
    const loading: LocaleState = { locale: "en", status: "loading" };
    const next = localeReducer(loading, { type: "setLocaleRejected" });
    expect(next).toBe(loading);
    expect(next.locale).toBe("en");
  });
});

describe("documentAttrsForLocale", () => {
  it.each<[Locale, { lang: Locale; dir: "ltr" | "rtl" }]>([
    ["en", { lang: "en", dir: "ltr" }],
    ["ja", { lang: "ja", dir: "ltr" }],
  ])("derives %j -> %j", (locale, expected) => {
    expect(documentAttrsForLocale(locale)).toEqual(expected);
  });
});

const createBridge = (overrides: Partial<LocaleBridge> = {}): LocaleBridge => ({
  getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
  setLocale: vi.fn().mockResolvedValue({ success: true }),
  onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
  ...overrides,
});

describe("resolveInitialLocale", () => {
  it("dispatches the resolved locale from the bridge", async () => {
    const bridge = createBridge({
      getLocale: vi.fn().mockResolvedValue({ locale: "ja" }),
    });
    const action = await resolveInitialLocale(bridge);
    expect(action).toEqual({ type: "resolved", locale: "ja" });
  });
});

describe("subscribeToLocaleBroadcasts", () => {
  it("dispatches a broadcast action whenever the bridge calls back", () => {
    let capturedCallback: ((locale: Locale) => void) | undefined;
    const bridge = createBridge({
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        capturedCallback = callback;
        return vi.fn();
      }),
    });
    const dispatch = vi.fn();

    subscribeToLocaleBroadcasts(bridge, dispatch);
    capturedCallback?.("ja");

    expect(dispatch).toHaveBeenCalledWith({ type: "broadcast", locale: "ja" });
  });

  it("returns the bridge's own unsubscribe function so teardown calls it", () => {
    const unsubscribe = vi.fn();
    const bridge = createBridge({
      onLocaleChanged: vi.fn().mockReturnValue(unsubscribe),
    });

    const returned = subscribeToLocaleBroadcasts(bridge, vi.fn());
    expect(returned).toBe(unsubscribe);

    returned();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("requestSetLocale", () => {
  it("does not dispatch on success — the broadcast is expected to update state", async () => {
    const bridge = createBridge({ setLocale: vi.fn().mockResolvedValue({ success: true }) });
    const dispatch = vi.fn();

    const result = await requestSetLocale(bridge, "ja", dispatch);

    expect(result).toEqual({ success: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches setLocaleRejected on failure and surfaces the error", async () => {
    const bridge = createBridge({
      setLocale: vi.fn().mockResolvedValue({ success: false, error: "nope" }),
    });
    const dispatch = vi.fn();

    const result = await requestSetLocale(bridge, "ja", dispatch);

    expect(result).toEqual({ success: false, error: "nope" });
    expect(dispatch).toHaveBeenCalledWith({ type: "setLocaleRejected" });
  });
});
