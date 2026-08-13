/**
 * @file user-metadata.ts
 * @description Applies the Ask-environment directive block — locale, keyboard,
 * wall-clock time, recent transform names — to a system prompt.
 *
 * Retrieve lives in `~/main/keybindings/askEnvironment.ts`
 * (`resolveAskEnvironment` + `buildAskDirectives`). This is the one APPLY
 * function: every system-prompt call site (preset transforms, Autocomplete)
 * must go through it so wrapping, empty-handling, and placement cannot drift.
 *
 * EMPTY MEANS IDENTITY. Whitespace, `""`, `null` and `undefined` all return
 * the system prompt byte-identical — no heading, no blank `# Metadata context`
 * section. That is what keeps an unconfigured press on the same prompt (and
 * the same provider cache key) it had before this block existed.
 */
export type UserMetadataPlacement = "trailing" | "before-last-line";

/**
 * Appends rendered user-metadata directives to a system prompt.
 *
 * `trailing` (default) is the preset path: the preset's own instructions stay
 * the stable, cacheable prefix and the per-press facts vary only in the
 * suffix — the same placement `withActiveAppContext` uses for the source-app
 * block, and for the same reason.
 *
 * `before-last-line` is Autocomplete's path. That system prompt's first and
 * last lines are both literal JSON objects on purpose: a continuation-shaped
 * model picks up from the ends. Trailing metadata would replace
 * `{"suggestion":""}` as the last line and get continued as ghost text.
 *
 * @param systemPrompt - The prompt to extend.
 * @param directives - Output of `buildAskDirectives`, or a labelled window of
 *   it. Absent/empty leaves `systemPrompt` untouched.
 * @param placement - Where to insert a non-empty block.
 */
export const withUserMetadata = (
  systemPrompt: string,
  directives?: string | null,
  placement: UserMetadataPlacement = "trailing",
): string => {
  const block = directives?.trim() ?? "";
  if (!block) return systemPrompt;

  if (placement === "before-last-line") {
    const lastNewline = systemPrompt.lastIndexOf("\n");
    if (lastNewline === -1) {
      return `${systemPrompt}\n\n${block}`;
    }
    return `${systemPrompt.slice(0, lastNewline)}\n\n${block}\n${systemPrompt.slice(lastNewline + 1)}`;
  }

  return `${systemPrompt}\n\n${block}`;
};
