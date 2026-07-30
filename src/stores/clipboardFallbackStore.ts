import Store from "electron-store";
import {
  DEFAULT_CLIPBOARD_FALLBACK_ENABLED,
  normalizeClipboardFallbackEnabled,
} from "~/shared/clipboardFallback";

type ClipboardFallbackSchema = {
  clipboardFallbackEnabled: boolean;
};

const createStore = (clearInvalidConfig: boolean) =>
  new Store<ClipboardFallbackSchema>({
    name: "clipboardFallback",
    defaults: {
      clipboardFallbackEnabled: DEFAULT_CLIPBOARD_FALLBACK_ENABLED,
    },
    clearInvalidConfig,
  });

/**
 * Whether the persisted preference survived startup.
 *
 * `clearInvalidConfig: true` makes conf substitute an empty config for a file
 * it cannot parse, silently turning a deliberate "off" back into the default
 * "on". It must stay `true` all the same: a strict store throws from the very
 * getter `set()` reads, which would leave a user with a corrupt file unable to
 * turn the setting off at all.
 *
 * That leaves this probe as the only moment the loss is observable. conf's
 * constructor REPAIRS the unparseable file in place before it returns
 * (`#initializeStore` assigns `this.store`, which writes), so by the time the
 * real store exists the file parses and nothing can tell a discarded
 * preference from a fresh install. A strict store instead throws while reading
 * the file and leaves it untouched — and returns normally for both a valid
 * config and a missing one.
 */
const storedPreferenceIsReadable = (): boolean => {
  try {
    createStore(false);
    return true;
  } catch {
    return false;
  }
};

class ClipboardFallbackStore {
  private readonly store: Store<ClipboardFallbackSchema>;

  constructor() {
    const discarded = !storedPreferenceIsReadable();
    this.store = createStore(true);

    if (discarded) {
      console.warn(
        `Could not read ${this.store.path}: the stored clipboard-fallback preference was discarded and has reverted to the default (enabled).`,
      );
    }
  }

  getClipboardFallbackEnabled(): boolean {
    return normalizeClipboardFallbackEnabled(
      this.store.get(
        "clipboardFallbackEnabled",
        DEFAULT_CLIPBOARD_FALLBACK_ENABLED,
      ),
    );
  }

  setClipboardFallbackEnabled(enabled: boolean): void {
    this.store.set("clipboardFallbackEnabled", enabled);
  }
}

export const clipboardFallbackStore = new ClipboardFallbackStore();
