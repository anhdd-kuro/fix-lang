/**
 * @file openaiProject.ts
 * @description The OpenAI project the tray's Providers card reports spend for.
 *
 * `/organization/costs` can group by `project_id`, which is the ONE non-line-item
 * grouping OpenAI offers — so a per-project figure is real billed dollars rather
 * than an estimate. Which project, though, is not discoverable: an admin key is
 * organization-scoped and OpenAI exposes no endpoint that names the project
 * behind a key. The id is therefore stored per profile, alongside the admin key.
 *
 * Electron-free: main sanitizes on write, the renderer validates the field as it
 * is typed, and both must agree on what counts as a project id.
 */

/**
 * OpenAI project ids are `proj_` + an opaque token. The prefix is checked so a
 * pasted organization id (`org-…`) or an admin key is rejected at the field
 * instead of producing a card that silently reports $0.00 forever.
 */
const PROJECT_ID_PATTERN = /^proj_[A-Za-z0-9_-]{1,120}$/;

export const OPENAI_PROJECT_ID_PREFIX = "proj_";

/**
 * Normalize a stored/typed value. An empty or whitespace-only value means "not
 * configured" and yields `undefined`; a non-empty value that is not a project id
 * also yields `undefined`, so a malformed entry never reaches a request URL.
 */
export const sanitizeOpenAIProjectId = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return PROJECT_ID_PATTERN.test(trimmed) ? trimmed : undefined;
};

/**
 * True when a typed value is non-empty but not a project id — the state the
 * Settings field shows a hint for. An empty field is not an error.
 */
export const isMalformedOpenAIProjectId = (raw: string): boolean =>
  raw.trim() !== "" && sanitizeOpenAIProjectId(raw) === undefined;
