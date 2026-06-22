/**
 * @file themeStore.ts
 * @description Persists the active UI theme preset.
 */
import Store from "electron-store";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themeIds";

/** Maps legacy preset IDs to tm-themes JSON stems. */
const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  "ocean-dark": "material-theme-ocean",
  "cursor-dark": "brand-cursor-dark",
  atom: "one-dark-pro",
  dracula: "dracula",
  copilot: "night-owl",
  "github-dark": "github-dark-default",
  "ayu-dark": "ayu-dark",
  "claude-code-dark": "brand-claude-code-dark",
  default: "dark-plus",
};

const resolveThemeId = (stored: unknown): ThemeId => {
  if (typeof stored !== "string") {
    return DEFAULT_THEME_ID;
  }
  if (isThemeId(stored)) {
    return stored;
  }
  const migrated = LEGACY_THEME_IDS[stored];
  return migrated ?? DEFAULT_THEME_ID;
};

type ThemeStoreSchema = {
  themeId: ThemeId;
};

class ThemeStore {
  private store: Store<ThemeStoreSchema>;

  constructor() {
    this.store = new Store<ThemeStoreSchema>({
      name: "theme",
      defaults: {
        themeId: DEFAULT_THEME_ID,
      },
      clearInvalidConfig: true,
    });
  }

  getThemeId(): ThemeId {
    const stored = this.store.get("themeId", DEFAULT_THEME_ID);
    return resolveThemeId(stored);
  }

  setThemeId(themeId: ThemeId): void {
    this.store.set("themeId", themeId);
  }
}

export const themeStore = new ThemeStore();

export type { ThemeId } from "./themeIds";
export { isThemeId } from "./themeIds";
