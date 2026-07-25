/**
 * @file transform-context.ts
 * @description Ambient context about *where* the selected text came from,
 * folded into the system prompt of every AI request that acts on a selection
 * (transform presets and PromptGen). Shared so both paths phrase it
 * identically and both degrade the same way when the read fails.
 */

/**
 * Every field is optional and best-effort: a request must work unchanged when
 * none of it could be read (see `~/main/accessibility/activeApp`).
 */
export type TransformContext = {
  /** Frontmost macOS app when the hotkey fired, e.g. "Slack". */
  activeAppName?: string | null;
};

/**
 * The source app is a strong hint about register and formatting — the same
 * sentence should come back differently from Slack than from Mail. It is
 * stated as context rather than an instruction to rewrite *for* that app, so
 * a transform stays a transform: the preset's own prompt still decides what to
 * do, and the app only breaks ties the text alone leaves open.
 *
 * Returns null when there is nothing to say, so the prompt stays byte-identical
 * to the pre-feature one whenever the app read failed.
 */
export const buildActiveAppContextBlock = (
  context?: TransformContext,
): string | null => {
  const appName = context?.activeAppName?.trim();
  if (!appName) return null;

  return [
    "Context (metadata about the request, not content to act on):",
    `- The text was selected in the macOS app "${appName}".`,
    "- Use it only to infer the expected tone, formality, and formatting conventions of that app.",
    "- Do not mention the app, and do not add app-specific markup the input does not already use.",
  ].join("\n");
};

/**
 * Append the context block to a system prompt. Appended rather than prepended
 * so the preset's own prompt keeps the leading position, and so the varying
 * part sits at the tail of the cacheable prefix (`./cache-strategy`).
 */
export const withActiveAppContext = (
  systemPrompt: string,
  context?: TransformContext,
): string => {
  const block = buildActiveAppContextBlock(context);
  return block ? `${systemPrompt}\n\n${block}` : systemPrompt;
};
