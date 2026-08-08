/**
 * @file dashboardTabs.ts
 * @description Pure, framework-free helpers for the MainWindow dashboard tab
 * shell (issue #54). Kept separate from the React component so the tab-state
 * logic and the history filter/derivation logic are unit-testable without a
 * DOM testing library (none is installed; see #54 plan HITL #4).
 *
 * Tab labels are translation keys, not prose (Chunk 8 i18n) — this file stays
 * locale-free by design; `App.tsx` resolves `labelKey` via `t()` at render
 * time, so `dashboardTabs.test.ts` never has to assert rendered English.
 */
import { isPromptGenEnabled } from "~/features/core/shared/features";
import type { DashboardTabId } from "~/features/core/shared/dashboardTabIds";
import type { HistoryEntry } from "~/features/history/store/historyStore";
import type { MessageKey } from "~/features/i18n/shared/message";

/**
 * Stable identifiers for the six dashboard tabs. Re-exported from `~/features/core/shared/dashboardTabIds` so
 * existing importers keep their path while preload shares the same union — a
 * second copy of it let a tab rename break tray navigation silently.
 */
export type { DashboardTabId } from "~/features/core/shared/dashboardTabIds";

export type DashboardTabMeta = {
  id: DashboardTabId;
  /** `dashboard.tab.*` translation key — resolved via `t()` at render time. */
  labelKey: MessageKey;
};

/**
 * Tab order + label keys. History is index 1 so existing users land on the
 * familiar list and nothing visibly regresses on first open (#54 plan HITL #2).
 */
export const DASHBOARD_TABS: readonly DashboardTabMeta[] = [
  { id: "overview", labelKey: "dashboard.tab.overview" },
  { id: "history", labelKey: "dashboard.tab.history" },
  { id: "models", labelKey: "dashboard.tab.models" },
  { id: "usage", labelKey: "dashboard.tab.usage" },
  { id: "logs", labelKey: "dashboard.tab.logs" },
  { id: "about", labelKey: "dashboard.tab.about" },
] as const;

/** Default active tab index — Overview (analytics landing view). */
export const DEFAULT_DASHBOARD_TAB_INDEX = DASHBOARD_TABS.findIndex(
  (t) => t.id === "overview"
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
 * preserving first-seen order. `PromptGen` is appended last as a fixed entry,
 * unless the PromptGen build-time feature tag is off — pass `includePromptGen`
 * explicitly in tests, where no bundler define exists.
 *
 * Moved verbatim from App.tsx so it can be unit-tested directly.
 */
export const deriveAvailableFilters = (
  entries: HistoryEntry[],
  includePromptGen: boolean = isPromptGenEnabled(),
): string[] => {
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.presetName && e.presetName !== "PromptGen") {
      seen.add(e.presetName);
    }
  }
  // Build-time feature tag off => no dead PromptGen filter chip, since no
  // PromptGen history can be produced by that build.
  return includePromptGen ? [...seen, "PromptGen"] : [...seen];
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
