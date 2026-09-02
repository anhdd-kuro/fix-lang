/**
 * @file guardStore.ts
 * @description Persists `SelectionGuardSettings` — the stale-clipboard age
 * guard, the selection size cap, and the frontmost-app deny-list. Mirrors
 * `~/features/correction/store/outputModeStore.ts`: plain `electron-store`
 * with `clearInvalidConfig: true` and, deliberately, NO ajv schema — the
 * shape's one validation rule lives in `normalizeSelectionGuardSettings`.
 * Giving this store its own file confines `clearInvalidConfig`'s blast
 * radius to these three fields alone, unlike `apiStore`'s schema, where one
 * bad stored value wipes every profile, preset and key reference at once.
 * Do not add a schema here.
 */
import Store from "electron-store";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  normalizeSelectionGuardSettings,
} from "~/features/guards/shared/guardSettings";
import * as clipboardChangeTracker from "~/main/clipboard/clipboardChangeTracker";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

type SelectionGuardsSchema = {
  selectionGuards: SelectionGuardSettings;
};

const DEFAULT_SELECTION_GUARD_SETTINGS: SelectionGuardSettings = {
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
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
   * here — then calls `clipboardChangeTracker.applySettings` exactly when
   * `clipboardMaxAgeSeconds` crosses the 0 <-> non-0 boundary, so the 1 Hz
   * poll starts or stops immediately on this write instead of waiting for
   * the next launch. A write that does not cross that boundary (e.g. 5s ->
   * 9s, or only `maxSelectionChars` changing) leaves the tracker untouched.
   */
  setSelectionGuardSettings(settings: SelectionGuardSettings): void {
    const previous = this.getSelectionGuardSettings();
    const normalized = normalizeSelectionGuardSettings(settings);
    this.store.set("selectionGuards", normalized);

    const wasPollActive = previous.clipboardMaxAgeSeconds > 0;
    const isPollActive = normalized.clipboardMaxAgeSeconds > 0;
    if (wasPollActive !== isPollActive) {
      clipboardChangeTracker.applySettings(normalized);
    }
  }
}

export const guardStore = new GuardStore();
