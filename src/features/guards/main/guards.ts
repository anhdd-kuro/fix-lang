/**
 * @file guards.ts
 * @description IPC handlers for the selection-guard settings store
 * (stale-clipboard age, size cap, app deny-list) plus the read-only
 * "recently used apps" MRU that backs the deny-list editor's chips.
 *
 * Raw string channels (`get-selection-guards`, `set-selection-guards`,
 * `get-recent-active-apps`, `choose-denied-apps`, `resolve-app-bundle-ids`) —
 * only multi-origin channels get a constant in
 * `~/features/core/shared/ipcChannels.ts`.
 *
 * `choose-denied-apps` and `resolve-app-bundle-ids` are the two ways an `.app`
 * bundle becomes a denied bundle id (the file dialog and a drag-and-drop). The
 * dialog handler REUSES the resolver rather than resolving its own picks, so
 * the "is this really an existing .app, and what is its identifier?" rule has
 * one implementation — see `~/features/guards/main/appBundleIds.ts`.
 *
 * `set-selection-guards` mirrors `~/features/autocomplete/main/settings.ts`:
 * a malformed payload is REJECTED field by field rather than coerced into
 * defaults. Coercing a bad payload to defaults would let a buggy renderer
 * silently disable a safety rail instead of failing the write loudly.
 */
import { dialog, ipcMain } from "electron";
import { resolveAppBundleIds } from "~/features/guards/main/appBundleIds";
import { SelectionGuardSettingsPayloadSchema } from "~/features/guards/shared/guardSettings";
import { guardStore } from "~/features/guards/store/guardStore";
import { textLabel, type Label } from "~/features/i18n/shared/message";
import { getRecentActiveApps } from "~/main/accessibility/recentActiveApps";
import type { AppBundleIdsResult } from "~/features/guards/shared/appBundleIds";

export const registerSelectionGuardHandlers = (): void => {
  ipcMain.handle("get-selection-guards", async () =>
    guardStore.getSelectionGuardSettings(),
  );

  ipcMain.handle(
    "set-selection-guards",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings,
    ): Promise<{ success: boolean; error?: Label }> => {
      // Field by field: widening any field would just move the failure from
      // "rejected here" to "coerced into defaults downstream" by
      // `guardStore.setSelectionGuardSettings`'s own normalizer.
      const payload = SelectionGuardSettingsPayloadSchema.safeParse(settings);
      if (!payload.success) {
        return {
          success: false,
          error: textLabel("Malformed selection guard settings"),
        };
      }

      try {
        guardStore.setSelectionGuardSettings(payload.data);
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

  /**
   * Resolves paths the renderer got from a drop (`webUtils.getPathForFile`).
   * The payload is untrusted, so it is handed straight to `resolveAppBundleIds`,
   * which validates every entry before touching the filesystem.
   */
  ipcMain.handle(
    "resolve-app-bundle-ids",
    async (
      _event: Electron.IpcMainInvokeEvent,
      paths,
    ): Promise<AppBundleIdsResult> => resolveAppBundleIds(paths),
  );

  /**
   * A cancelled dialog is a SUCCESS with no ids — the user changed their mind,
   * which is not something to report as a failure. Picked paths still go
   * through the same resolver as a drop: main chose them, but the "existing
   * .app with a readable identifier" rule has exactly one implementation.
   */
  ipcMain.handle(
    "choose-denied-apps",
    async (): Promise<AppBundleIdsResult> => {
      const selection = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Applications", extensions: ["app"] }],
        defaultPath: "/Applications",
      });
      if (selection.canceled) return { success: true, bundleIds: [] };
      return resolveAppBundleIds(selection.filePaths);
    },
  );
};
