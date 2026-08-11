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
import { twJoin } from "tailwind-merge";
import { Button } from "../components/Button";
import {
  ChatTranscript,
  type ChatTranscriptMessage,
} from "../components/ChatTranscript";
import { GhostTextOverlay } from "../components/GhostTextOverlay";
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
  AskContextSource,
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

  // Handed to the context fold control so toggling never strands focus on a
  // button in a window whose whole purpose is the textarea. Clicking the
  // control blurs the textarea (which retires any ghost, as it should), and
  // this puts the caret back where the next keystroke belongs.
  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

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

  return (
    /*
      HEIGHT BUDGET. The window is 620 wide and one of TWO heights, picked per
      press in `askInputWindow.ts` from whether a context is attached — a
      636px window for a bare one-line question would dominate the screen.
      Both numbers there are FRAMED sizes: that file still sets no
      `useContentSize`, so macOS takes its 32px title bar out and `h-screen`
      here is always 32 less than what it passed to `BrowserWindow`. Measured,
      not assumed: `BrowserWindow({height: 200}).getContentSize()` reports 168.

        no context:   24 (`p-3`) + 300 (textarea floor) + 8 (`gap-2`)
                      + 16 (`text-xs` footer)
                      + 48 (transparency row + its `gap-2`)
                                                       = 396 page / 428 framed
        with context: that 396 + 200 (context card) + 8 (the second `gap-2`)
                                                       = 604 page / 636 framed

      That 48 is `RequestTransparency`'s COLLAPSED height (a fixed 40px row) plus
      the one `gap-2` above it, and collapsed is the only state the window is
      sized for: the expanded panel leaves the flow entirely and scrolls inside
      the window rather than growing it. `askInputWindow.ts` carries the same
      arithmetic in its own comment and has to be edited with this one.

      The row is absent altogether when the payload carries neither a system
      prompt nor any directives; the textarea's `flex-1` simply absorbs the 48,
      which is why nothing else has to know.

      The two floors below are the spec and the window is sized to fit them,
      rather than the floors being whatever a fixed window had left. Both are
      still needed: capping the card's TEXT alone leaves the label, the gaps,
      the padding and the fold control outside the bound — which is why the
      cap sits on the `<section>` — and a card cap with no textarea floor only
      moves the overflow onto the footer.

      `relative` is what the expanded transparency panel is positioned against:
      it fills this page from the top padding down to just above the footer.
    */
    <main className="relative flex h-screen flex-col gap-2 bg-background p-3 text-foreground">
      {/*
        Keyed by the context itself so a new selection always opens collapsed:
        the fold state belongs to the passage being folded, and remounting is
        cheaper than threading a reset through the payload handshake.

        Placed BEFORE the textarea on purpose. The control is a real focusable
        button, so it joins the tab order — ahead of the textarea, where a
        forward Tab from the input can never land on it. See `handleKeyDown`
        for why Tab reaching the textarea must stay the ghost's.
      */}
      {context.length > 0 && (
        <ContextPreview
          key={context}
          text={context}
          source={contextSource}
          onToggled={focusTextarea}
        />
      )}
      {/*
        Also placed BEFORE the textarea, for the same tab-order reason as the
        card above it: every focusable control in this window sits ahead of the
        input, so the only Tab the textarea ever sees stays the ghost's.

        Keyed by what it shows, exactly like the card above: the fold state
        belongs to the text being folded, and this window is hidden rather than
        destroyed, so an expanded panel left behind by the last press would
        otherwise reopen covering the textarea. The directives carry the press
        time, so in practice every press remounts this.
      */}
      <RequestTransparency
        key={`${systemPrompt} ${contextDirectives}`}
        systemPrompt={systemPrompt}
        contextDirectives={contextDirectives}
        onToggled={focusTextarea}
      />
      {/*
        `min-h-75` (300px) rather than `min-h-0`: both defeat the flex item's
        default `min-height: auto` — a textarea's intrinsic two-row height —
        but only a floor keeps the context card from taking the whole window.
        300 is the spec'd input height; `flex-1` on top of it absorbs whatever
        the window has left after the card, the gaps and the footer, which at
        both heights in the budget above is exactly 300.
      */}
      <div className="relative min-h-75 flex-1 rounded-md border border-card-control-border bg-card">
        {/*
          The anchor's PREFIX, not the whole question: the mirror exists to
          push the ghost to the caret, and feeding it text that lives after
          the caret paints the ghost past the end of the question while Tab
          inserts it mid-sentence. The anchor rather than live `question`
          because the ghost belongs to the state it was computed for.
        */}
        <GhostTextOverlay
          typed={
            ghostAnchor === null
              ? ""
              : ghostAnchor.text.slice(0, ghostAnchor.caret)
          }
          suggestion={ghostSuggestion}
          scrollTop={textareaScrollTop}
        />
        <textarea
          ref={textareaRef}
          autoFocus
          className="relative h-full w-full resize-none rounded-md bg-transparent p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
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

type ContextPreviewProps = {
  text: string;
  source: AskContextSource;
  onToggled: () => void;
};

/**
 * The attached selection, shown so the user can see WHAT they are about to
 * send rather than only how many characters of it.
 *
 * `min-h-50` (200px) is the spec'd floor for this card; `max-h-50` beside it
 * is not decoration but what makes the scroll container exist. The card is
 * `shrink-0` in a flex column with nothing else bounding it, so expanded — the
 * clamp dropped — a long selection would size the card to its content and push
 * the textarea and the footer off the bottom of the window. Floor and cap being
 * equal is the point: the card is exactly 200px whatever it holds, so the
 * window height in `askInputWindow.ts` can be a constant rather than a guess.
 *
 * THE CAP IS ON THE CARD, not on its text. Capping only the text left the
 * label, both gaps, the padding and the fold control outside the bound, so an
 * expanded card overran its budget and the "Ask anything" placeholder was cut
 * in half by the bottom of the card.
 *
 * Inside it, border 2 + `pt-2` 8 + `pb-1` 4 + `leading-none` label 10 + two
 * `gap-1` 8 + `text-xs` fold control 16 = 48px of chrome, leaving 152px for the
 * body. A `text-xs leading-snug` line is 16.5px, so `line-clamp-9` (148.5) is
 * still the largest clamp that fits. Collapsed, that clamp is what ellipsises;
 * expanded, the body takes the same 152 via `flex-1` and scrolls inside it.
 *
 * THE HEADROOM IS 3.5px, for the padding and both gaps together — less than one
 * full Tailwind step but more than a half one, so `pt-2.5` (+2) still fits while
 * `pt-3` (+4) clips the ninth line. Spend it and the clamp has to drop to 8.
 * `index.test.ts` pins these as exact class tokens for that reason: a substring
 * assertion cannot tell `pt-2` from `pt-2.5`.
 *
 * The padding is asymmetric on purpose: the label needs air above it or it reads
 * as glued to the passage, while the bottom edge already has the fold control
 * standing off it.
 *
 * The label's `leading-none` is not cosmetic: `text-[10px]` sets no
 * line-height, so its box would be whatever `normal` means for the user's font,
 * and a card whose height is an estimate cannot be summed against a floor.
 *
 * Collapsed is `line-clamp-9` rather than a plain `overflow-hidden` because the
 * clamp is what draws the ellipsis — `-webkit-box` plus `overflow: hidden` plus
 * `text-overflow: ellipsis` in one utility. A bare `overflow-hidden` cuts the
 * ninth line off mid-glyph with nothing to say more follows. That also rules
 * out putting `flex-1` on the collapsed branch: `-webkit-box` and flex sizing
 * fight over the same box, so the flex sizing lives on the expanded branch only.
 *
 * Rendered as plain text through React's own escaping: never `MarkdownView`,
 * never `dangerouslySetInnerHTML`. This is untrusted text the user selected in
 * some other app, sitting on an input surface.
 *
 * The fold control appears only when the clamp actually truncates the text,
 * measured from the laid-out element rather than guessed from the string,
 * because how many lines a passage occupies depends on the window's current
 * width and not on its character count.
 *
 * This is now the ONLY measured fold in the app — the Ask result popup's
 * `FoldableTextBlock` was replaced by `ChatTranscript`, whose system fold is a
 * native `<details>` and needs no measurement. So the trap in the effect below
 * is documented here rather than by reference to a sibling.
 */
const ContextPreview = ({ text, source, onToggled }: ContextPreviewProps) => {
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
    <section
      data-ask-context
      className="flex max-h-50 min-h-50 shrink-0 flex-col gap-1 rounded-md border border-card-control-border bg-card px-2 pt-2 pb-1"
    >
      {/*
        Labelled the way the session-detail chat labels its system prompt: a
        bordered card under a small uppercase role line. Without the label the
        card reads as an unexplained blob of someone else's text sitting above
        the question box.

        The label names the SOURCE, and that is what makes attaching the
        clipboard acceptable at all: when the hotkey's own copy produced
        nothing, this text may be minutes old and unrelated to what the user is
        looking at. Told which it is, they can send it or press Esc; told
        nothing, they would be sending it either way.
      */}
      <p
        data-ask-context-label
        data-ask-context-source={source}
        className="text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground"
      >
        {source === "clipboard"
          ? t("notifications.window.askInput.contextLabelClipboard")
          : t("notifications.window.askInput.contextLabel")}
      </p>
      <p
        ref={bodyRef}
        data-ask-context-text
        className={twJoin(
          "whitespace-pre-wrap break-words text-xs leading-snug text-card-foreground",
          expanded ? "min-h-0 flex-1 overflow-y-auto" : "line-clamp-9",
        )}
      >
        {text}
      </p>
      {truncated ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start rounded px-0 py-0 text-xs font-medium text-primary hover:underline"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((previous) => !previous);
            onToggled();
          }}
        >
          {expanded
            ? t("notifications.window.askInput.contextCollapse")
            : t("notifications.window.askInput.contextExpand")}
        </Button>
      ) : null}
    </section>
  );
};

type RequestTransparencyProps = {
  systemPrompt: string;
  contextDirectives: string;
  onToggled: () => void;
};

/**
 * The row that answers "what is actually being sent?" — the preset's system
 * prompt and the environment directives appended to it, shown through the same
 * `ChatTranscript` the history modal and the Ask result popup use, so a request
 * about to be sent reads exactly like a stored one.
 *
 * BOTH STRINGS ARE SHOWN VERBATIM. Main renders them; nothing here re-wraps,
 * re-indents or prettifies them, because the point of the row is that what is on
 * screen IS what leaves the machine.
 *
 * Absent fields render NOTHING — no row, no placeholder, no empty fold. A preset
 * with neither looks exactly as it did before this row existed.
 *
 * TWO STATES, AND ONLY ONE OF THEM IS IN THE WINDOW'S HEIGHT BUDGET:
 *
 * - Collapsed, this is a fixed `h-10` (40px) `shrink-0` bar. 40 is not a
 *   consequence of what it holds — it is the number `askInputWindow.ts` reserved
 *   for it (48 with the `gap-2` above), so a row that measured anything else
 *   would put the window back out of budget. `h-10` on the section and `h-10` on
 *   the header inside it is what makes the height independent of the label's
 *   font.
 * - Expanded, the section leaves the flow (`absolute`) and fills the page from
 *   the top padding to just above the footer, scrolling INSIDE itself. It has to
 *   leave the flow: a system prompt is long and the window is fixed, so an
 *   inline block that grew would push the textarea and the footer off the
 *   bottom, and a 40px inline scroll box — the only inline alternative that
 *   fits — would be useless. An `h-10 shrink-0` spacer takes the row's place in
 *   the flow so nothing below it moves while the panel is open.
 *
 * One toggle control, living in the header that both states share, so the
 * control is never duplicated and never hidden behind the panel it opened.
 *
 * ONE CLICK, NOT TWO. `unfoldSystemMessages` is what makes both blocks readable
 * the moment the panel opens. The transcript's default is a `<details>` per
 * system entry, which here meant expanding the row only to be handed two more
 * collapsed summaries — a second fold in front of the one thing this row exists
 * to show. The panel's own scroll is what handles a long prompt.
 */
const RequestTransparency = ({
  systemPrompt,
  contextDirectives,
  onToggled,
}: RequestTransparencyProps) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const messages: ChatTranscriptMessage[] = [
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

  if (messages.length === 0) return null;

  return (
    <>
      <section
        data-ask-transparency
        data-ask-transparency-expanded={expanded ? "true" : "false"}
        className={twJoin(
          "flex flex-col rounded-md border border-card-control-border bg-card",
          expanded
            ? "absolute inset-x-3 top-3 bottom-9 z-10 gap-2 p-2"
            : "h-10 shrink-0 px-2",
        )}
      >
        <div className="flex h-10 shrink-0 items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
            {t("notifications.window.askInput.transparencyLabel")}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="rounded px-0 py-0 text-xs font-medium text-primary hover:underline"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((previous) => !previous);
              onToggled();
            }}
          >
            {expanded
              ? t("notifications.window.askInput.transparencyCollapse")
              : t("notifications.window.askInput.transparencyExpand")}
          </Button>
        </div>
        {expanded ? (
          <div
            data-ask-transparency-body
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <ChatTranscript
              ariaLabel={t(
                "notifications.window.askInput.transparencyAriaLabel",
              )}
              messages={messages}
              unfoldSystemMessages
            />
          </div>
        ) : null}
      </section>
      {expanded ? <div aria-hidden="true" className="h-10 shrink-0" /> : null}
    </>
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
