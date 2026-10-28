/**
 * @file guardStore.ts
 * @description Persists `SelectionGuardSettings` — the selection size cap
 * and the frontmost-app deny-list. Mirrors
 * `~/features/correction/store/outputModeStore.ts`: plain `electron-store`
 * with `clearInvalidConfig: true` and, deliberately, NO ajv schema — the
 * shape's one validation rule lives in `normalizeSelectionGuardSettings`.
 * Giving this store its own file confines `clearInvalidConfig`'s blast
 * radius to these fields alone, unlike `apiStore`'s schema, where one
 * bad stored value wipes every profile, preset and key reference at once.
 * Do not add a schema here.
 */
import Store from "electron-store";
import {
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  normalizeSelectionGuardSettings,
} from "~/features/guards/shared/guardSettings";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

type SelectionGuardsSchema = {
  selectionGuards: SelectionGuardSettings;
};

const DEFAULT_SELECTION_GUARD_SETTINGS: SelectionGuardSettings = {
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

class GuardStore {
  private readonly store = new Store<SelectionGuardsSchema>({
    name: "selectionGuards",
    defaults: { selectionGuards: DEFAULT_SELECTION_GUARD_SETTINGS },
    clearInvalidConfig: true,
  });

  getSelectionGuardSettings(): SelectionGuardSettings {
    return normalizeSelectionGuardSettings(
      this.store.get("selectionGuards", DEFAULT_SELECTION_GUARD_SETTINGS),
    );
  }

  /**
   * Normalizes before writing — never trusts its own caller, even though
   * the IPC handler already rejected a malformed payload before reaching
   * here.
   */
  setSelectionGuardSettings(settings: SelectionGuardSettings): void {
    this.store.set("selectionGuards", normalizeSelectionGuardSettings(settings));
  }
}

export const guardStore = new GuardStore();
