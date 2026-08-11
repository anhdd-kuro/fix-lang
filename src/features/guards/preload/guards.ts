/**
 * @file guards.ts
 * @description Preload bridge for the selection-guard settings store
 * (stale-clipboard age, size cap, app deny-list) and the read-only
 * "recently used apps" MRU that backs the deny-list editor's chips.
 *
 * Validated in both directions, mirroring
 * `~/features/autocomplete/preload/autocompleteSettings.ts`: a malformed
 * main-process reply is dropped before it reaches React, and a malformed
 * outgoing payload is rejected here rather than trusting the caller's
 * TypeScript type, which only holds at compile time. Never bypass this —
 * every IPC boundary in this app validates independently on both sides.
 */
import { ipcRenderer } from "electron";
import {
  MAX_BUNDLE_ID_LENGTH,
  MAX_DENIED_BUNDLE_IDS,
  normalizeBundleId,
  normalizeSelectionGuardSettings,
} from "~/features/guards/shared/guardSettings";
import {
  isSecurityStats,
  isSecurityStatsRange,
} from "~/features/guards/shared/securityStats";
import { textLabel, type Label } from "~/features/i18n/shared/message";
import { asLabel } from "~/features/settings/preload/ipcLabel";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type {
  SecurityStats,
  SecurityStatsRange,
} from "~/features/guards/shared/securityStats";
import type { ActiveApp } from "~/main/accessibility/activeApp";

/**
 * A number must be a non-negative INTEGER, not merely finite — see the
 * identical predicate in `~/features/guards/main/guards.ts` for why: a
 * negative or fractional finite number is exactly what the downstream
 * normalizer silently floors/clamps to `0`, so accepting it here would let
 * this boundary report success while a rail gets turned off with no signal.
 * An explicit `0` still passes — the documented way to disable a guard.
 */
const isNonNegativeIntegerSetting = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Mirrors `isDeniedBundleIdsPayload` in `~/features/guards/main/guards.ts`:
 * bound the array length and each raw entry's length before ever calling
 * `normalizeBundleId` (which trims/lowercases), and reuse that function
 * rather than re-deriving the canonicalisation rule.
 */
const isDeniedBundleIdsPayload = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_DENIED_BUNDLE_IDS &&
  value.every(
    (entry) =>
      typeof entry === "string" &&
      entry.length <= MAX_BUNDLE_ID_LENGTH &&
      normalizeBundleId(entry) !== null,
  );

/**
 * Field-by-field check, mirroring `isAutocompleteSettings` in
 * `~/features/autocomplete/preload/autocompleteSettings.ts`: the shape is
 * small enough that widening any field to `unknown` would just move a
 * crash into React instead of preventing it.
 */
const isSelectionGuardSettings = (
  value: unknown,
): value is SelectionGuardSettings => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isNonNegativeIntegerSetting(record.clipboardMaxAgeSeconds) &&
    isNonNegativeIntegerSetting(record.maxSelectionChars) &&
    isDeniedBundleIdsPayload(record.deniedBundleIds)
  );
};

const isActiveApp = (value: unknown): value is ActiveApp => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    (record.bundleId === null || typeof record.bundleId === "string")
  );
};

export const selectionGuardsFeature = {
  /** A malformed main-process reply falls back to normalized defaults. */
  getSelectionGuards: async (): Promise<SelectionGuardSettings> => {
    const result: unknown = await ipcRenderer.invoke("get-selection-guards");
    return isSelectionGuardSettings(result)
      ? result
      : normalizeSelectionGuardSettings(undefined);
  },

  /**
   * Rejects a malformed payload before it ever reaches `ipcRenderer.invoke` —
   * the same shape the main-process handler (`~/features/guards/main/guards.ts`)
   * validates independently, since this boundary cannot trust its own
   * caller's TypeScript types at runtime.
   */
  setSelectionGuards: async (
    settings: SelectionGuardSettings,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (!isSelectionGuardSettings(settings)) {
      return {
        success: false,
        error: textLabel("Malformed selection guard settings"),
      };
    }
    const result = await ipcRenderer.invoke("set-selection-guards", settings);
    return { success: Boolean(result?.success), error: asLabel(result?.error) };
  },

  /** A malformed main-process reply falls back to an empty list. */
  getRecentActiveApps: async (): Promise<ActiveApp[]> => {
    const result: unknown = await ipcRenderer.invoke("get-recent-active-apps");
    return Array.isArray(result) && result.every(isActiveApp) ? result : [];
  },

  /**
   * Guard-activity roll-up for the Security dashboard tab.
   *
   * A malformed range is rejected here rather than sent, and a malformed reply
   * REJECTS rather than falling back to zeros — an all-zero roll-up reads as
   * "no guard ever fired", which is a different claim from "the numbers could
   * not be read". The panel renders its load-failed state instead.
   */
  getSecurityStats: async (range: SecurityStatsRange): Promise<SecurityStats> => {
    if (!isSecurityStatsRange(range)) {
      throw new Error("Malformed security stats range");
    }
    const result: unknown = await ipcRenderer.invoke("get-security-stats", range);
    if (!isSecurityStats(result)) {
      throw new Error("Malformed security stats reply");
    }
    return result;
  },
};

export type SelectionGuardsFeature = typeof selectionGuardsFeature;
