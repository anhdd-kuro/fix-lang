/**
 * `buildCorrectionUserPrompt` frames the selection under a label ("Input:" or
 * "Draft prompt:"). Some models copy that label to the start of their reply,
 * and it then gets pasted into the user's document. Strip it — unless the
 * user's own text began with the same label, in which case it is content.
 */
// Own-line only: the prompt puts the label on its own line, and an inline
// "Input: …" is too often real content (an Ask answer, a translation).
const ECHOED_LABEL =
  /^\s*(?:\*\*)?(Input|Draft prompt)[ \t]*[:：](?:\*\*)?[ \t]*\r?\n/i;

export const stripEchoedInputLabel = (
  output: string,
  sourceText: string,
): string => {
  const match = ECHOED_LABEL.exec(output);
  if (!match) {
    return output;
  }

  const label = match[1].toLowerCase();
  if (sourceText.trimStart().toLowerCase().startsWith(label)) {
    return output;
  }

  return output.slice(match[0].length);
};
