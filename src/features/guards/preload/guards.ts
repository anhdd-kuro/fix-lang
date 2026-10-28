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
import { ipcRenderer, webUtils } from "electron";
import { z } from "zod";
import {
  AppBundleIdsResultSchema,
  MAX_APP_BUNDLE_PATHS,
  looksLikeAppBundlePath,
} from "~/features/guards/shared/appBundleIds";
import {
  normalizeSelectionGuardSettings,
  SelectionGuardSettingsPayloadSchema,
} from "~/features/guards/shared/guardSettings";
import {
  SecurityStatsRangeSchema,
  SecurityStatsSchema,
} from "~/features/guards/shared/securityStats";
import {
  messageLabel,
  textLabel,
  type Label,
} from "~/features/i18n/shared/message";
import { asLabel } from "~/features/settings/preload/ipcLabel";
import type { AppBundleIdsResult } from "~/features/guards/shared/appBundleIds";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type {
  SecurityStats,
  SecurityStatsRange,
} from "~/features/guards/shared/securityStats";
import type { ActiveApp } from "~/main/accessibility/activeApp";

const ActiveAppSchema = z.object({
  name: z.string(),
  bundleId: z.string().nullable(),
});

/**
 * Built on `Array#every`, which skips holes, rather than on `z.array`, which
 * would read them as `undefined` and refuse; the array itself is the result.
 */
const RecentActiveAppsSchema = z.custom<ActiveApp[]>(
  (value) =>
    Array.isArray(value) &&
    value.every((app) => ActiveAppSchema.safeParse(app).success),
);

export const selectionGuardsFeature = {
  /** A malformed main-process reply falls back to normalized defaults. */
  getSelectionGuards: async (): Promise<SelectionGuardSettings> => {
    // The same payload rule the main-process handler applies, validated
    // independently: a widened field would move a crash into React.
    const reply = SelectionGuardSettingsPayloadSchema.safeParse(
      await ipcRenderer.invoke("get-selection-guards"),
    );
    return reply.success
      ? reply.data
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
    if (!SelectionGuardSettingsPayloadSchema.safeParse(settings).success) {
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
    const reply = RecentActiveAppsSchema.safeParse(
      await ipcRenderer.invoke("get-recent-active-apps"),
    );
    return reply.success ? reply.data : [];
  },

  /**
   * The renderer cannot read a dropped file's path itself — Electron 43
   * removed `File.path` — so `webUtils.getPathForFile` is exposed here, at the
   * preload boundary, rather than reached for in React. Returns `null` for
   * anything that is not a `File` or whose path does not look like an `.app`
   * bundle, so a stray text file drop is reported to the user instead of being
   * sent to main as a path it will only reject.
   */
  getAppBundlePathForFile: (file: File): string | null => {
    try {
      // `instanceof File` is NOT the guard here: the object arrives from the
      // renderer's world through `contextBridge`, so its prototype is not this
      // context's `File` and the check would reject every real drop. The type
      // is narrowed by what follows instead — a throw and a non-`.app` result
      // both come back as `null`.
      const filePath = webUtils.getPathForFile(file);
      return looksLikeAppBundlePath(filePath) ? filePath : null;
    } catch {
      return null;
    }
  },

  /**
   * Resolves dropped `.app` paths to bundle ids. The list is bounded and every
   * entry shape-checked here, then INDEPENDENTLY re-validated (plus checked
   * for existence) in main — this boundary cannot trust its own caller's
   * TypeScript types at runtime, and main cannot trust this boundary.
   */
  resolveAppBundleIds: async (
    paths: readonly string[],
  ): Promise<AppBundleIdsResult> => {
    if (
      !Array.isArray(paths) ||
      paths.length > MAX_APP_BUNDLE_PATHS ||
      !paths.every(looksLikeAppBundlePath)
    ) {
      return {
        success: false,
        error: messageLabel("security.deniedApps.dropInvalid"),
      };
    }
    const reply = AppBundleIdsResultSchema.safeParse(
      await ipcRenderer.invoke("resolve-app-bundle-ids", [...paths]),
    );
    return reply.success
      ? reply.data
      : { success: false, error: textLabel("Malformed app bundle ids reply") };
  },

  /** Opens the native `.app` picker in main and returns the chosen bundle ids. */
  chooseDeniedApps: async (): Promise<AppBundleIdsResult> => {
    const reply = AppBundleIdsResultSchema.safeParse(
      await ipcRenderer.invoke("choose-denied-apps"),
    );
    return reply.success
      ? reply.data
      : { success: false, error: textLabel("Malformed app bundle ids reply") };
  },

  /**
   * Unlike the getters above, a malformed reply REJECTS instead of falling back:
   * an all-zero roll-up reads as "no guard ever fired", which is a different
   * claim from "the numbers could not be read".
   */
  getSecurityStats: async (
    range: SecurityStatsRange,
  ): Promise<SecurityStats> => {
    if (!SecurityStatsRangeSchema.safeParse(range).success) {
      throw new Error("Malformed security stats range");
    }
    const reply = SecurityStatsSchema.safeParse(
      await ipcRenderer.invoke("get-security-stats", range),
    );
    if (!reply.success) {
      throw new Error("Malformed security stats reply");
    }
    return reply.data;
  },
};

export type SelectionGuardsFeature = typeof selectionGuardsFeature;
