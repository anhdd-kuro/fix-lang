import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ChatTranscript,
  type ChatTranscriptMessage,
} from "../components/ChatTranscript";
import { GhostTextOverlay } from "../components/GhostTextOverlay";
import { useAppearanceTypography } from "../hooks/useAppearanceTypography";
import {
  isSurfaceOnAnchor,
  useGhostText,
  type GhostTextSurfaceState,
} from "../hooks/useGhostText";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import "../main.css";
import type {
  AskInputPayload,
} from "~/features/ask/shared/ask";

/**
 * Exported (not just used below for the entry-point auto-render) so
 * `index.test.ts` can mount it directly via `react-dom/client` + `act`,
 * bypassing the `document.getElementById("root")` side effect at the bottom
 * of this file — mirrors `CorrectionResultWindow/index.tsx:19`.
 */
export const AskInputWindow = () => {
  useTheme();
  useAppearanceTypography();
  const { t } = useI18n();
  const [payload, setPayload] = useState<AskInputPayload | null>(null);
  const [question, setQuestion] = useState("");
  // Tracks which payload the current `question` was reset for, so a fresh
  // payload can be recognised during render rather than in an effect.
  const [resetForPayload, setResetForPayload] =
    useState<AskInputPayload | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The ghost mirror is a separate element from the textarea, so it does not
  // scroll with it. See `GhostTextOverlay.tsx` for why syncing beats
  // withholding acceptance.
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  // The one live read of the surface, handed to `useGhostText` so its dispatch
  // and paint gates hold with no event involved, and reused for the Tab-time
  // check below so all three ask the same question of the same DOM node.
  const readSurface = useCallback((): GhostTextSurfaceState | null => {
    const surface = textareaRef.current;
    if (surface === null) return null;
    return {
      text: surface.value,
      selectionStart: surface.selectionStart,
      selectionEnd: surface.selectionEnd,
    };
  }, []);
  // Destructured (not held as one `ghost` object) so effects below can list
  // exactly the stable function identities they use — `ghost.clear` as a
  // dependency reads as a fresh value to React every render, which either
  // defeats `exhaustive-deps` or re-subscribes the document listener on every
  // keystroke.
  const {
    suggestion: ghostSuggestion,
    anchor: ghostAnchor,
    notifyChange: notifyGhostChange,
    notifyCaretMove: notifyGhostCaretMove,
    notifyPointerDown: notifyGhostPointerDown,
    notifyCompositionStart: notifyGhostCompositionStart,
    notifyCompositionEnd: notifyGhostCompositionEnd,
    notifyBlur: notifyGhostBlur,
    clear: clearGhost,
  } = useGhostText({ readSurface });
  // Escape is handled at the document level (see below), where a stale
  // closure would never see a suggestion that arrived after the listener was
  // installed — kept in sync from `ghostSuggestion` on every render instead.
  const suggestionRef = useRef<string | null>(null);
  useEffect(() => {
    suggestionRef.current = ghostSuggestion;
  }, [ghostSuggestion]);
  // Set right before a Tab-accept inserts text, so the caret lands after the
  // inserted suggestion instead of wherever the browser leaves it on a
  // programmatic value change.
  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaretRef.current === null) return;
    textareaRef.current?.setSelectionRange(
      pendingCaretRef.current,
      pendingCaretRef.current,
    );
    pendingCaretRef.current = null;
  });

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAskInputData(setPayload);
    // Signal after the listener is installed so the first payload is not lost.
    window.electronAPI.signalAskInputReady();
    return unsubscribe;
  }, []);

  // Escape reaches this tree as a keystroke, but Cmd-W, the red close button
  // and a profile switch never do — they all reach `dismissAskInputWindow()` in
  // main with nothing sent back here. Left unhandled, this tree keeps the
  // abandoned question and its ghost, and the next open shows the window right
  // after pushing the fresh payload, so both can flash over the new, empty
  // input before the payload reset commits. Main tells us instead.
  useEffect(() => {
    return window.electronAPI.onAskInputDismissed(() => {
      setQuestion("");
      clearGhost();
    });
  }, [clearGhost]);

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
    clearGhost();
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
  //
  // First Escape clears a visible ghost suggestion and leaves the window
  // open; only a second Escape — pressed once no suggestion is showing —
  // cancels the window. Getting this backwards makes the window feel
  // un-dismissable whenever a suggestion happens to be up, which is worse
  // than shipping no ghost text at all.
  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const wasShowingGhost = suggestionRef.current !== null;
      // Cleared on BOTH branches, including the cancel one. The window is
      // hidden rather than destroyed, so a request still in flight when the
      // user gives up would otherwise resolve into the next Ask session and
      // offer a Tab-acceptable suggestion for the question they abandoned.
      clearGhost();
      if (wasShowingGhost) return;
      window.electronAPI.cancelAskInput();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [clearGhost]);

  const context = payload?.context ?? "";
  // Absent means `selection` — an older main process, or the ordinary case.
  const contextSource = payload?.contextSource ?? "selection";
  // Both are rendered by MAIN and shown verbatim — never re-wrapped, re-indented
  // or prettified here. The row exists so the user can read WHAT LEAVES THE
  // MACHINE, and a renderer that reformats is a second copy of the request's
  // wording that can drift from the one actually sent while still looking right.
  const systemPrompt = payload?.systemPrompt ?? "";
  const contextDirectives = payload?.contextDirectives ?? "";

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target;
    setQuestion(value);
    notifyGhostChange(value, selectionStart ?? value.length);
  };

  const handleCompositionStart = (
    _event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    notifyGhostCompositionStart();
  };

  const handleCompositionEnd = (
    _event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    notifyGhostCompositionEnd();
  };

  // React synthesises `onSelect` from selectionchange/keyup/mouseup/dragend
  // and only fires it once the selection has actually changed, which covers
  // arrow keys and the mouseup that ends a click or drag — none of which fire
  // `input`, and all of which leave the ghost continuing a prefix the caret
  // has left.
  //
  // It does NOT cover the click or drag itself. React's `SelectEventPlugin`
  // goes silent for the whole duration of a mousedown — every leg, `keyup` and
  // `selectionchange` included — so this handler is the responsive path only.
  // `onMouseDown` closes that window at its opening edge, and the hook's
  // dispatch/paint gates plus the Tab check below hold with no event at all.
  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart, selectionEnd } = event.currentTarget;
    notifyGhostCaretMove(value, selectionStart, selectionEnd);
  };

  const handleMouseDown = () => {
    notifyGhostPointerDown();
  };

  const handleBlur = () => {
    notifyGhostBlur();
  };

  const handleScroll = () => {
    setTextareaScrollTop(textareaRef.current?.scrollTop ?? 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab inserts the suggestion at the caret and clears the ghost. Tab also
    // moves focus by default, so the default action is only prevented when
    // there is something to accept — with no suggestion up, Tab keeps its
    // normal browser behavior.
    if (event.key === "Tab" && ghostSuggestion && ghostAnchor) {
      // Read the LIVE surface and check it against the anchor rather than
      // trusting that a caret-move event reached us. `onSelect` is what keeps
      // the ghost off the screen once the caret leaves; this is what keeps a
      // ghost that somehow survived from being spliced in at the wrong place,
      // and it needs no event to hold. Anything but a collapsed caret exactly
      // on the anchor is a refusal, not a best-effort insertion — inserting
      // untrusted model output somewhere the user did not ask for is worse
      // than a Tab that does nothing.
      if (!isSurfaceOnAnchor(readSurface(), ghostAnchor)) {
        // `preventDefault` even though nothing is inserted. This press was
        // aimed at an offered ghost, not at focus traversal, and this window is
        // a single-textarea popup: letting Tab's default action run moves focus
        // off the textarea and every following keystroke is silently dropped —
        // the user has to click back in to keep typing. So the press is
        // consumed, the ghost retires, and the caret stays put.
        event.preventDefault();
        clearGhost();
        return;
      }
      event.preventDefault();
      // The anchor's own text and caret rather than the live selection or
      // `question`: the guard above has just proved all three agree, and
      // splicing the value that was CHECKED is what makes that provable at a
      // glance.
      const { text, caret } = ghostAnchor;
      const next = text.slice(0, caret) + ghostSuggestion + text.slice(caret);
      pendingCaretRef.current = caret + ghostSuggestion.length;
      setQuestion(next);
      clearGhost();
      return;
    }

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
      // `question` only — an unaccepted ghost suggestion is never folded in,
      // or the model would end up answering a question the user never wrote.
      const trimmed = question.trim();
      if (trimmed.length === 0) return;
      // Submitting leaves the surface as surely as Escape does — the window
      // hides but this tree survives, so a reply still in flight would land
      // into the next Ask session and paint a ghost for the question the user
      // already sent. `revealWindow` shows the reopened window right after
      // pushing the new payload, so that ghost can flash on screen.
      clearGhost();
      window.electronAPI.submitAskInput(trimmed);
    }
  };

  const preambleMessages: ChatTranscriptMessage[] = [
    ...(context.length > 0
      ? [
          {
            role: "system",
            sectionId: "selection-context",
            label:
              contextSource === "clipboard"
                ? t("notifications.window.askInput.contextLabelClipboard")
                : t("notifications.window.askInput.contextLabel"),
            content: context,
          },
        ]
      : []),
    ...(systemPrompt.length > 0
      ? [
          {
            role: "system",
            sectionId: "system-prompt",
            label: t(
              "notifications.window.askInput.transparencySystemPromptLabel",
            ),
            content: systemPrompt,
          },
        ]
      : []),
    ...(contextDirectives.length > 0
      ? [
          {
            role: "system",
            sectionId: "context-directives",
            label: t("notifications.window.askInput.transparencyDirectivesLabel"),
            content: contextDirectives,
          },
        ]
      : []),
  ];

  return (
    /*
      HEIGHT BUDGET. The window is 620 wide and 380 framed (348 page + 32 title
      bar). Measured: BrowserWindow({height: 200}).getContentSize() reports 168.

        24 (`p-3`) + 300 (`min-h-75` chat scroll floor) + 8 (`gap-2`)
        + 16 (`text-xs` footer) = 348 page / 380 framed

      The chat scroll area holds every read-only block (selection, system
      prompt, context directives) as independently foldable `<details>` entries
      through `ChatTranscript`, plus the question input styled as a user bubble
      — the same shape the history modal uses in View as chat.
    */
    <main className="flex h-screen flex-col gap-2 bg-background p-3 text-foreground">
      <section
        data-ask-chat
        className="flex min-h-75 flex-1 flex-col gap-3 overflow-y-auto rounded-md bg-secondary p-3"
      >
        {preambleMessages.length > 0 ? (
          <ChatTranscript
            key={`${context} ${systemPrompt} ${contextDirectives}`}
            ariaLabel={t("notifications.window.askInput.transparencyAriaLabel")}
            messages={preambleMessages}
          />
        ) : null}
        <div className="flex justify-end" data-ask-question-input>
          <div className="relative w-full max-w-[80%] min-w-[12rem] rounded-lg bg-primary p-3 text-primary-foreground">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">
              {t("notifications.window.askResult.questionLabel")}
            </h3>
            <GhostTextOverlay
              typed={
                ghostAnchor === null
                  ? ""
                  : ghostAnchor.text.slice(0, ghostAnchor.caret)
              }
              suggestion={ghostSuggestion}
              scrollTop={textareaScrollTop}
              suggestionClassName="text-primary-foreground/60"
            />
            <textarea
              ref={textareaRef}
              autoFocus
              className="relative min-h-24 w-full resize-none bg-transparent text-sm leading-relaxed text-primary-foreground outline-none placeholder:text-primary-foreground/60"
              placeholder={t("notifications.window.askInput.placeholder")}
              value={question}
              onChange={handleChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onSelect={handleSelect}
              onMouseDown={handleMouseDown}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
            />
          </div>
        </div>
      </section>
      <footer className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{t("notifications.window.askInput.sendHint")}</span>
          {ghostSuggestion && (
            <span>{t("notifications.window.askInput.acceptHint")}</span>
          )}
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
