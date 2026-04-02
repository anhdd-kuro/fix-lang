import Store from "electron-store";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import type { KeyBindings } from "~/stores/apiStore";

const normalizeAccelerator = (accelerator: string): string => {
  return accelerator
    .replace(/CommandOrControl/gi, "CommandOrControl")
    .replace(/Command/gi, "Command")
    .replace(/Control/gi, "Control")
    .replace(/Ctrl/gi, "Control")
    .replace(/Meta/gi, "Command")
    .replace(/Option/gi, "Alt")
    .replace(/\s+/g, "")
    .replace(/\+{2,}/g, "+");
};

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
   * Retrieves the current key bindings, merging with defaults to fill missing entries.
   */
  getKeyBindings(): KeyBindings {
    const stored = this.store.get("keyBindings", DEFAULT_KEY_BINDINGS);
    const merged = { ...DEFAULT_KEY_BINDINGS, ...stored };

    return {
      correction: normalizeAccelerator(merged.correction),
      translate: normalizeAccelerator(merged.translate),
      promptGen: normalizeAccelerator(merged.promptGen),
      profileSwitch: normalizeAccelerator(merged.profileSwitch),
    };
  }

  /**
   * Updates and persists the key bindings.
   */
  setKeyBindings(bindings: KeyBindings): void {
    this.store.set("keyBindings", bindings);
    console.log(
      `🚀 \n - KeybindingStore \n - setKeyBindings \n - bindings:`,
      bindings,
    );
  }

  /**
   * Resets key bindings to defaults.
   */
  resetKeyBindings(): void {
    this.store.set("keyBindings", DEFAULT_KEY_BINDINGS);
  }
}

export const keybindingStore = new KeybindingStore();
