import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/Button";
import CopyButton from "../components/CopyButton";
import { MarkdownView } from "../components/MarkdownView";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import "../main.css";
import type { AskResultPayload } from "~/shared/ask";

/**
 * Exported (not just used below for the entry-point auto-render) so
 * `index.test.ts` can mount it directly via `react-dom/client` + `act`,
 * bypassing the `document.getElementById("root")` side effect at the bottom
 * of this file — mirrors `CorrectionResultWindow/index.tsx:19`.
 */
export const AskResultWindow = () => {
  useTheme();
  const { t } = useI18n();
  const [payload, setPayload] = useState<AskResultPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAskResultData(setPayload);
    // Signal after the listener is installed so the first payload is not lost.
    window.electronAPI.signalAskResultReady();
    return unsubscribe;
  }, []);

  // Bound at the document level, not on a specific element, so ESC closes
  // this popup regardless of which element inside it currently has focus.
  // Main resolves which window sent the close via `event.sender`, so no id
  // is needed here.
  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        window.electronAPI.closeAskResultWindow();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  if (!payload) return null;

  return (
    <main className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <header>
        <h1 className="text-base font-semibold">
          {t("notifications.window.askResult.header")}
        </h1>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto rounded-md border border-card-control-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("notifications.window.askResult.questionLabel")}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {payload.question}
          </p>
        </div>

        <div className="border-t border-border pt-3">
          {payload.markdown ? (
            <MarkdownView markdown={payload.answer} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {payload.answer}
            </p>
          )}
        </div>
      </section>

      <footer className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          onClick={() => window.electronAPI.closeAskResultWindow()}
        >
          {t("common.close")}
        </Button>
        <CopyButton
          value={payload.answer}
          label={t("common.copy")}
          variant="primary"
          className="rounded px-3 py-1.5 text-sm"
          showLabel
        />
      </footer>
    </main>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <I18nProvider>
      <AskResultWindow />
    </I18nProvider>,
  );
}
