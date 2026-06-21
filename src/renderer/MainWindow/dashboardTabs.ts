/**
 * @file dashboardTabs.ts
 * @description Pure, framework-free helpers for the MainWindow dashboard tab
 * shell (issue #54). Kept separate from the React component so the tab-state
 * logic and the history filter/derivation logic are unit-testable without a
 * DOM testing library (none is installed; see #54 plan HITL #4).
 */
import type { HistoryEntry } from "~/stores/historyStore";

/** Stable identifiers for the four dashboard tabs, in display order. */
export type DashboardTabId = "overview" | "history" | "models" | "openrouter";

export type DashboardTabMeta = {
  id: DashboardTabId;
  label: string;
};

/**
 * Tab order + labels. History is index 1 so existing users land on the
 * familiar list and nothing visibly regresses on first open (#54 plan HITL #2).
 */
export const DASHBOARD_TABS: readonly DashboardTabMeta[] = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "models", label: "Models" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

/** Default active tab index — History. */
export const DEFAULT_DASHBOARD_TAB_INDEX = DASHBOARD_TABS.findIndex(
  (t) => t.id === "history"
);

/** Clamp an arbitrary index into the valid tab range (defensive). */
export const clampTabIndex = (index: number): number => {
  if (Number.isNaN(index) || index < 0) {
    return 0;
  }
  if (index >= DASHBOARD_TABS.length) {
    return DASHBOARD_TABS.length - 1;
  }
  return Math.floor(index);
};

/**
 * Derive unique preset names from loaded history entries (corrections bucket),
 * preserving first-seen order. `PromptGen` is appended last as a fixed entry.
 *
 * Moved verbatim from App.tsx so it can be unit-tested directly.
 */
export const deriveAvailableFilters = (entries: HistoryEntry[]): string[] => {
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.presetName && e.presetName !== "PromptGen") {
      seen.add(e.presetName);
    }
  }
  return [...seen, "PromptGen"];
};

/**
 * Apply the active preset-name filter. `null` means "show all". Legacy entries
 * without a presetName are excluded from any named filter (they only appear
 * under "All"), mirroring filterHistoryByPreset semantics.
 */
export const applyPresetFilter = (
  entries: HistoryEntry[],
  activeFilter: string | null
): HistoryEntry[] =>
  activeFilter === null
    ? entries
    : entries.filter((e) => e.presetName === activeFilter);

/**
 * Resolve the next active filter when a preset button is clicked: clicking the
 * already-active filter toggles back to "All" (null); otherwise selects it.
 */
export const toggleFilter = (
  current: string | null,
  clicked: string
): string | null => (current === clicked ? null : clicked);

/**
 * Which store buckets a visible "Clear" should wipe given the active filter:
 * - "All" (null) clears BOTH buckets so nothing visible survives.
 * - "PromptGen" clears only the promptGen bucket.
 * - any other preset filter clears the shared corrections bucket (which holds
 *   all non-PromptGen presets — clearing it removes more than the single active
 *   filter, by design of the bucket model).
 *
 * Extracted from the TrashButton handler so the bucket selection is testable.
 */
export const bucketsForClear = (
  activeFilter: string | null
): ("corrections" | "promptGen")[] =>
  activeFilter === null
    ? ["corrections", "promptGen"]
    : activeFilter === "PromptGen"
      ? ["promptGen"]
      : ["corrections"];
