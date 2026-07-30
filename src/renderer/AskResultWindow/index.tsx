import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { twJoin } from "tailwind-merge";
import { Button } from "../components/Button";
import CopyButton from "../components/CopyButton";
import { MarkdownView } from "../components/MarkdownView";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import "../main.css";
import type { AskResultPayload } from "~/features/ask/shared/ask";

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
        {payload.input?.trim() ? (
          <FoldableTextBlock
            sectionId="input"
            label={t("notifications.window.askResult.inputLabel")}
            text={payload.input}
          />
        ) : null}

        <FoldableTextBlock
          sectionId="question"
          label={t("notifications.window.askResult.questionLabel")}
          text={payload.question}
        />

        <div className="border-t border-border pt-3" data-ask-section="answer">
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
          hideIcon
        />
      </footer>
    </main>
  );
};

type FoldableTextBlockProps = {
  sectionId: "input" | "question";
  label: string;
  text: string;
};

/**
 * Collapsed by default: the input can be a whole selected document, and the
 * answer — not its inputs — is what the popup exists to show.
 *
 * The fold control appears only when the clamp actually truncates the text.
 * That is measured from the laid-out element rather than guessed from the
 * string, because how many lines a passage occupies depends on the popup's
 * current width, not on its character count.
 */
const FoldableTextBlock = ({
  sectionId,
  label,
  text,
}: FoldableTextBlockProps) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);

  // Measured only while collapsed. Expanding drops the clamp, so the element
  // then reports no overflow — re-measuring there would clear `truncated` and
  // take away the control the user needs to collapse again.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;

    const measure = () => setTruncated(body.scrollHeight > body.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className="flex flex-col gap-1" data-ask-section={sectionId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        ref={bodyRef}
        data-ask-text
        className={twJoin(
          "whitespace-pre-wrap break-words text-sm leading-relaxed",
          !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {truncated ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start rounded px-0 py-0.5 text-xs font-medium text-primary hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded
            ? t("notifications.window.askResult.collapse")
            : t("notifications.window.askResult.expand")}
        </Button>
      ) : null}
    </div>
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
