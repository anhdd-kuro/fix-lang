/**
 * @file ChatTranscript.tsx
 * @description The one transcript renderer. Extracted verbatim from the
 * `View as chat` tab of `HistorySessionDetailsModal.tsx`, which was its only
 * consumer, so the Ask AI windows could show a request the SAME way the history
 * modal shows a stored one — one look for "here is a conversation", wherever it
 * is being shown.
 *
 * Because it was extracted rather than rewritten, the DOM it produces for the
 * history modal is byte-for-byte what that file used to inline: the optional
 * `<dl>` meta strip, then an `<ol>` whose `system` entries are `<details>` folds
 * under an uppercase `<summary>` and whose remaining entries are bubbles —
 * `user` right and `bg-primary`, everything else left and bordered — each under
 * an uppercase `<h3>` role label. The modal's own tests are the proof; a change
 * here that needs one of them touched is a change in behaviour.
 *
 * TWO THINGS ARE DELIBERATELY THE CALLER'S:
 *
 * - The role LABEL. This component never translates, because the labels differ
 *   per consumer (`System` / `User` / `Assistant` in history; `Selected text` /
 *   `Question` / `Answer` in Ask), and a component that owned them would need a
 *   key map that every new consumer has to be added to.
 * - How a message's CONTENT renders, per message, via `renderContent`. History
 *   renders every message as plain text in a `<pre>`; the Ask result's answer is
 *   GFM markdown through `MarkdownView` and must stay that way. Hardcoding
 *   either one here would force the other consumer to render its text wrong.
 *
 * The default body is plain text through React's own escaping — never
 * `dangerouslySetInnerHTML`. Everything this renders is untrusted: model output,
 * or text the user selected in some other app.
 */
import type { ReactNode } from "react";

/**
 * One entry of the optional strip above the transcript. `term` is the
 * screen-reader-only `<dt>`; `description` is what is actually shown. Optional
 * as a whole: the Ask windows have no token counts to state.
 */
export type ChatTranscriptMetaItem = {
  term: string;
  description: string;
};

export type ChatTranscriptMessage = {
  /**
   * Drives the layout, not the wording: `system` folds, `user` is a right-hand
   * bubble, anything else is a left-hand one. Free-form because history carries
   * roles this component has no opinion about (`reasoning`, `tool`).
   */
  role: string;
  /** Already translated by the caller — see the file header. */
  label: string;
  content: string;
  /**
   * Renders the message body instead of the default `<pre>`. Returns the WHOLE
   * body node, its own styling included, so a markdown consumer is not left
   * fighting a `<pre>` wrapper it never wanted.
   */
  renderContent?: (content: string) => ReactNode;
  /**
   * Emitted as `data-chat-section` when present, so a consumer whose messages
   * have distinct jobs (Ask's selection / question / answer) can address them.
   * Absent renders no attribute at all, which is what keeps the history modal's
   * DOM unchanged.
   */
  sectionId?: string;
};

type ChatTranscriptProps = {
  messages: readonly ChatTranscriptMessage[];
  /** Names the `<ol>` for assistive tech; translated by the caller. */
  ariaLabel: string;
  meta?: readonly ChatTranscriptMetaItem[];
};

const messageBody = (
  message: ChatTranscriptMessage,
  fallbackClassName: string,
): ReactNode =>
  message.renderContent ? (
    message.renderContent(message.content)
  ) : (
    <pre className={fallbackClassName}>{message.content}</pre>
  );

export const ChatTranscript = ({
  messages,
  ariaLabel,
  meta,
}: ChatTranscriptProps) => (
  <div className="flex flex-col gap-3">
    {meta && meta.length > 0 ? (
      <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-card-control-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {meta.map((item) => (
          <div key={item.term}>
            <dt className="sr-only">{item.term}</dt>
            <dd>{item.description}</dd>
          </div>
        ))}
      </dl>
    ) : null}
    <ol className="flex flex-col gap-3" aria-label={ariaLabel}>
      {messages.map((message, index) => {
        const sectionAttribute = message.sectionId
          ? { "data-chat-section": message.sectionId }
          : {};

        if (message.role === "system") {
          return (
            <li key={`${message.role}-${index}`} {...sectionAttribute}>
              <details className="rounded-md border border-card-control-border bg-card p-3">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {message.label} …
                </summary>
                {messageBody(
                  message,
                  "mt-2 text-sm text-foreground whitespace-pre-wrap break-words",
                )}
              </details>
            </li>
          );
        }

        const isUser = message.role === "user";
        return (
          <li
            key={`${message.role}-${index}`}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            {...sectionAttribute}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                isUser
                  ? "bg-primary text-primary-foreground"
                  : "border border-card-control-border bg-card text-card-foreground"
              }`}
            >
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">
                {message.label}
              </h3>
              {messageBody(message, "text-sm whitespace-pre-wrap break-words")}
            </div>
          </li>
        );
      })}
    </ol>
  </div>
);
