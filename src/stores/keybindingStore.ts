import Store from "electron-store";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * KeybindingStore for managing key bindings persistence.
 */
class KeybindingStore {
  private store: Store<{ keyBindings: KeyBindings }>;

  constructor() {
    this.store = new Store<{ keyBindings: KeyBindings }>({
      name: "keyBindings",
      defaults: {
        keyBindings: DEFAULT_KEY_BINDINGS,
      },
      clearInvalidConfig: true,
    });
  }

  /**
   * Retrieves the current key bindings.
   */
  getKeyBindings(): KeyBindings {
    return this.store.get("keyBindings", DEFAULT_KEY_BINDINGS);
  }

  /**
   * Updates and persists the key bindings.
   */
  setKeyBindings(bindings: KeyBindings): void {
    this.store.set("keyBindings", bindings);
  }

  /**
   * Resets key bindings to defaults.
   */
  resetKeyBindings(): void {
    this.store.set("keyBindings", DEFAULT_KEY_BINDINGS);
  }
}

export const keybindingStore = new KeybindingStore();
