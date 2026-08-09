/**
 * @file guards.ts
 * @description IPC handlers for the selection-guard settings store
 * (stale-clipboard age, size cap, app deny-list) plus the read-only
 * "recently used apps" MRU that backs the deny-list editor's chips.
 *
 * Raw string channels (`get-selection-guards`, `set-selection-guards`,
 * `get-recent-active-apps`) — only multi-origin channels get a constant in
 * `~/features/core/shared/ipcChannels.ts`.
 *
 * `set-selection-guards` mirrors `~/features/autocomplete/main/settings.ts`:
 * a malformed payload is REJECTED field by field rather than coerced into
 * defaults. Coercing a bad payload to defaults would let a buggy renderer
 * silently disable a safety rail instead of failing the write loudly.
 */
import { ipcMain } from "electron";
import {
  MAX_BUNDLE_ID_LENGTH,
  MAX_DENIED_BUNDLE_IDS,
  normalizeBundleId,
} from "~/features/guards/shared/guardSettings";
import { guardStore } from "~/features/guards/store/guardStore";
import { textLabel, type Label } from "~/features/i18n/shared/message";
import { getRecentActiveApps } from "~/main/accessibility/recentActiveApps";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

/**
 * A number must be a non-negative INTEGER, not merely finite. Every finite
 * value that fails this (a negative number, a fractional one) is exactly the
 * class `normalizeNonNegativeInt` in `guardSettings.ts` silently floors/clamps
 * to `0` — which would otherwise turn a rail off with no signal that the
 * write was anything but accepted. An integer `x >= 0` is guaranteed to
 * survive that normalizer unchanged (`Math.max(0, Math.floor(x)) === x`), so
 * this check is exactly "would normalization change this value?" without
 * having to call the normalizer here. An explicit `0` passes — it is the
 * documented, deliberate way to disable a guard.
 */
const isNonNegativeIntegerSetting = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * A denied-bundle-ids payload is valid only if every entry would survive
 * `normalizeBundleId` unchanged in *shape* (still a real, non-dropped entry)
 * and the list is no longer than the store will ever persist. Both checks
 * run before any transform: the length check on the array itself, and the
 * cheap `.length` check on each raw entry, ahead of calling
 * `normalizeBundleId` (which trims/lowercases) — so a huge array or a huge
 * string is rejected without the allocation that string would otherwise
 * cost. Reuses `normalizeBundleId` rather than re-deriving the canonicalisation
 * rule, per the plan's single-source-of-truth requirement.
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
 * `~/features/autocomplete/main/settings.ts`: the shape is small enough that
 * widening any field to `unknown` would just move the failure from
 * "rejected here" to "coerced into defaults downstream" by
 * `guardStore.setSelectionGuardSettings`'s own normalizer.
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

export const registerSelectionGuardHandlers = (): void => {
  ipcMain.handle("get-selection-guards", async () => guardStore.getSelectionGuardSettings());

  ipcMain.handle(
    "set-selection-guards",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings: unknown,
    ): Promise<{ success: boolean; error?: Label }> => {
      if (!isSelectionGuardSettings(settings)) {
        return {
          success: false,
          error: textLabel("Malformed selection guard settings"),
        };
      }

      try {
        guardStore.setSelectionGuardSettings(settings);
        return { success: true };
      } catch (error) {
        console.error("Error setting selection guard settings:", error);
        return {
          success: false,
          error: textLabel(
            error instanceof Error ? error.message : "Unknown error",
          ),
        };
      }
    },
  );

  ipcMain.handle("get-recent-active-apps", async () => getRecentActiveApps());
};
