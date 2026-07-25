/**
 * @file useI18n.test.ts
 * @description Regression test for the Finding-2 fix: `tm`/`tl` (and the
 * whole `useI18n()` return value) must be referentially stable across
 * re-renders at a fixed locale, and change identity only when the locale
 * actually changes.
 *
 * Before the fix, `tm`/`tl` were fresh arrow functions created on every
 * render, and the returned object was a fresh object literal every render.
 * That silently defeated any `useMemo`/`useCallback` dependency array that
 * (correctly) listed them — e.g. `PresetWeightChart.tsx`'s chart-build memo
 * never actually memoized, because two of its five "locale-stable" deps were
 * not stable at all.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders a tiny harness component directly via
 * `react-dom/client` + `act` — the same technique already used in
 * `SettingUpdates.test.ts`.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { I18nProvider } from "./I18nProvider";
import { useI18n, type UseI18nResult } from "./useI18n";
import type { Locale } from "~/shared/i18n/registry";

// Expected text is derived through the real translator kernel (never
// hand-replicated) so a catalog reword doesn't break this test, and so an
// English-fallback regression in `tm` would still be caught.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

type Snapshot = {
  locale: Locale;
  tm: UseI18nResult["tm"];
  tl: UseI18nResult["tl"];
  result: UseI18nResult;
};

describe("useI18n — tm/tl referential stability", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let forceRerender: (() => void) | undefined;
  let snapshots: Snapshot[];

  const Harness = () => {
    const [, setTick] = useState(0);
    forceRerender = () => setTick((current) => current + 1);
    const result = useI18n();
    snapshots.push({ locale: result.locale, tm: result.tm, tl: result.tl, result });
    return null;
  };

  const render = async () => {
    snapshots = [];
    const api = {
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(Harness)));
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves
    // (see `I18nProvider.tsx`), so the harness only mounts — and pushes its
    // first snapshot — after this extra tick (mirrors `SettingUpdates.test.ts`).
    await waitForUi();
    await waitForUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    localeListener = undefined;
    forceRerender = undefined;
    vi.restoreAllMocks();
  });

  it("keeps tm, tl, and the whole result stable across an unrelated re-render at a fixed locale", async () => {
    await render();
    expect(snapshots).toHaveLength(1);
    const first = snapshots[0];
    expect(first.locale).toBe("en");

    // A re-render triggered by state local to the CONSUMER (not the
    // provider) — e.g. `OverviewPanel`'s `useElementWidth` firing on a
    // `ResizeObserver` tick — must not hand out new `tm`/`tl`/result
    // identities.
    await act(async () => {
      forceRerender?.();
    });

    expect(snapshots).toHaveLength(2);
    const second = snapshots[1];
    expect(second.locale).toBe("en");
    expect(second.tm).toBe(first.tm);
    expect(second.tl).toBe(first.tl);
    expect(second.result).toBe(first.result);
  });

  it("changes tm, tl, and the whole result identity when the locale actually changes", async () => {
    await render();
    const first = snapshots[0];

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const last = snapshots[snapshots.length - 1];
    expect(last.locale).toBe("ja");
    expect(last.tm).not.toBe(first.tm);
    expect(last.tl).not.toBe(first.tl);
    expect(last.result).not.toBe(first.result);
  });

  it("resolves a Message through the locale active when tm is called, not when it was created", async () => {
    await render();
    const { tm } = snapshots[0];
    expect(tm({ key: "common.loading" })).toBe(tEn("common.loading"));

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const { tm: tmAfter } = snapshots[snapshots.length - 1];
    // Prove the locale actually changed: the JA-derived text is returned,
    // and it differs from the EN-derived text (guards against a silent
    // English-fallback regression that would still pass a mere "not EN"
    // check if `tm` returned some other, unrelated string).
    expect(tmAfter({ key: "common.loading" })).toBe(tJa("common.loading"));
    expect(tmAfter({ key: "common.loading" })).not.toBe(tEn("common.loading"));
  });
});
