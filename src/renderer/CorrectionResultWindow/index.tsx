// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/Button";
import CopyButton from "../components/CopyButton";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import "../main.css";
import type { CorrectionResultPayload } from "~/shared/correctionResult";

/**
 * Exported (not just used below for the entry-point auto-render) so
 * `index.test.ts` can mount it directly via `react-dom/client` + `act`,
 * bypassing the `document.getElementById("root")` side effect at the bottom
 * of this file — Vitest only collects `.test.ts`, not `.test.tsx`, and this
 * component has no other pure-logic sibling module to test against instead.
 */
export const CorrectionResultWindow = () => {
  useTheme();
  const { t } = useI18n();
  const [payload, setPayload] = useState<CorrectionResultPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onCorrectionResultData(setPayload);
    // Signal after the listener is installed so the first payload is not lost.
    window.electronAPI.signalCorrectionResultReady();
    return unsubscribe;
  }, []);

  if (!payload) return null;

  // Built from raw data (`payload.presetName`) via `t()` on every render —
  // never a pre-rendered sentence — so it re-resolves after a locale switch.
  // Mirrors `buildCorrectionResultWindowTitle()`'s fallback in
  // `src/main/webViewWindows/windowTitles.ts`: no presetName (a correction
  // delivered outside any preset context) falls back to the same generic
  // `notifications.window.correctionResult.title` key used for the native
  // window title, so the two only ever diverge when a preset is known.
  const title = payload.presetName
    ? t("notifications.correction.resultTitle", {
        presetName: payload.presetName,
      })
    : t("notifications.window.correctionResult.title");

  return (
    <main className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <header>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">
          {t("notifications.window.correctionResult.subtitle")}
        </p>
      </header>

      <section className="min-h-0 flex-1 overflow-auto rounded-md border border-card-control-border bg-card p-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {payload.text}
        </p>
      </section>

      <footer className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          onClick={() => window.electronAPI.closeCorrectionResultWindow()}
        >
          {t("common.close")}
        </Button>
        <CopyButton value={payload.text} label={t("common.copy")} showLabel />
      </footer>
    </main>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <I18nProvider>
      <CorrectionResultWindow />
    </I18nProvider>
  );
}
