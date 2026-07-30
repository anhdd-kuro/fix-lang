import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import "../main.css";
import type { AskInputPayload } from "~/features/ask/shared/ask";

/**
 * Exported (not just used below for the entry-point auto-render) so
 * `index.test.ts` can mount it directly via `react-dom/client` + `act`,
 * bypassing the `document.getElementById("root")` side effect at the bottom
 * of this file — mirrors `CorrectionResultWindow/index.tsx:19`.
 */
export const AskInputWindow = () => {
  useTheme();
  const { t } = useI18n();
  const [payload, setPayload] = useState<AskInputPayload | null>(null);
  const [question, setQuestion] = useState("");
  // Tracks which payload the current `question` was reset for, so a fresh
  // payload can be recognised during render rather than in an effect.
  const [resetForPayload, setResetForPayload] =
    useState<AskInputPayload | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAskInputData(setPayload);
    // Signal after the listener is installed so the first payload is not lost.
    window.electronAPI.signalAskInputReady();
    return unsubscribe;
  }, []);

  // The input window is hidden (not destroyed) between invocations, so the
  // React tree — and any typed-but-unsubmitted question — survives across
  // opens. Main pushes a fresh payload on every open; consume that signal to
  // clear the stale question. Adjusted during render (React's documented
  // pattern for "resetting state when a prop changes") rather than in an
  // effect, since calling setState synchronously inside an effect body
  // triggers an avoidable extra commit.
  if (payload !== null && payload !== resetForPayload) {
    setResetForPayload(payload);
    setQuestion("");
  }

  // Restoring focus needs the DOM node, so it stays in an effect — but it
  // never calls setState, so it does not re-trigger the render-time reset
  // above. `autoFocus` only fires on mount and this component never
  // remounts between invocations, so this is what re-focuses the textarea.
  useEffect(() => {
    if (payload !== null) textareaRef.current?.focus();
  }, [payload]);

  // Bound at the document level (not the textarea's onKeyDown) so Escape
  // keeps working once focus moves off the textarea onto a non-focusable
  // element such as the footer hint or the context chip.
  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        window.electronAPI.cancelAskInput();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const context = payload?.context ?? "";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter is left alone so the textarea's own newline-insertion
    // default action runs — only a bare Enter is treated as "submit".
    if (event.key === "Enter" && !event.shiftKey) {
      // A bare Enter is also how every Japanese (and other CJK) IME confirms
      // its conversion candidate. `isComposing` is the standards-based
      // signal; `keyCode === 229` is the legacy fallback some IMEs still
      // send instead. Either one means this Enter belongs to the IME, not
      // to the "submit" action.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const trimmed = question.trim();
      if (trimmed.length === 0) return;
      window.electronAPI.submitAskInput(trimmed);
    }
  };

  return (
    <main className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <textarea
        ref={textareaRef}
        autoFocus
        className="min-h-0 flex-1 resize-none rounded-md border border-card-control-border bg-card p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        placeholder={t("notifications.window.askInput.placeholder")}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <footer className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{t("notifications.window.askInput.sendHint")}</span>
          <span>{t("notifications.window.askInput.cancelHint")}</span>
        </div>
        {context.length > 0 && (
          <span>
            {t("notifications.window.askInput.contextChip", {
              count: context.length,
            })}
          </span>
        )}
      </footer>
    </main>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <I18nProvider>
      <AskInputWindow />
    </I18nProvider>,
  );
}
