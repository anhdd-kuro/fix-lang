/**
 * @file askMessage.ts
 * @description Composes the single user-facing message sent to the model for
 * the Ask AI preset, folding the (optional) selection into the question as a
 * delimited context block. This exact string is what gets persisted as
 * history's `original` column, so its shape must stay deterministic and
 * reproducible — no timestamps, no randomness.
 */

const CONTEXT_BLOCK_START = "----- context -----";
const CONTEXT_BLOCK_END = "----- end context -----";

export type ComposeAskMessageInput = {
  /** The user's typed question from the Ask AI input window. */
  question: string;
  /** The selection carried in as optional context; empty when nothing was selected. */
  context: string;
}

/**
 * Returns `null` when `question` is empty or whitespace-only — the no-op case
 * the hotkey path checks before ever opening a request. Otherwise returns the
 * trimmed question, followed by the trimmed context in a delimited block when
 * context is non-empty (question outside the block, context only inside it).
 */
export const composeAskMessage = ({
  question,
  context,
}: ComposeAskMessageInput): string | null => {
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length === 0) return null;

  const trimmedContext = context.trim();
  if (trimmedContext.length === 0) return trimmedQuestion;

  return [
    trimmedQuestion,
    "",
    CONTEXT_BLOCK_START,
    trimmedContext,
    CONTEXT_BLOCK_END,
  ].join("\n");
};
