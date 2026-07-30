/**
 * @file trayProviderSummaryView.ts
 * @description PURE derivations for the tray's Providers card, kept out of the
 * component so they are unit-testable without a DOM testing library (none is
 * installed). Mirrors `components/usage/usageTabs.ts`, whose tab list this card
 * reuses rather than restating — the tray and the Usage tab must never disagree
 * about which providers have an account to report on.
 */
import type { OpenAIProjectCosts } from "~/main/llm/providers/openai/usage.parsers";

/**
 * The configured project's billed spend for the range.
 *
 * `parseProjectCosts` drops zero-cost projects, so an id that is absent from the
 * rows means "nothing billed", not "unknown project" — those are the same state
 * as far as OpenAI's `/costs` can tell us, and reporting `$0.00` for it would
 * claim a certainty the endpoint never gave.
 */
export type TrayProjectSpend =
  | { kind: "spend"; costUsd: number; name: string | null }
  | { kind: "no-spend" };

export const selectProjectSpend = (
  costs: OpenAIProjectCosts,
  projectId: string,
): TrayProjectSpend => {
  const row = costs.projects.find((project) => project.projectId === projectId);
  if (!row) return { kind: "no-spend" };
  return { kind: "spend", costUsd: row.costUsd, name: row.name };
};
