/**
 * @file appearanceStore.ts
 * @description Persists global UI typography preferences (font size and family).
 */
import Store from "electron-store";
import {
  DEFAULT_APPEARANCE_TYPOGRAPHY,
  normalizeAppearanceTypography,
  normalizeFontFamilyId,
  normalizeFontSizeId,
  type AppearanceTypography,
  type FontFamilyId,
  type FontSizeId,
} from "~/features/appearance/shared/typography";

type AppearanceStoreSchema = AppearanceTypography;

class AppearanceStore {
  private store: Store<AppearanceStoreSchema>;

  constructor() {
    this.store = new Store<AppearanceStoreSchema>({
      name: "appearance",
      defaults: DEFAULT_APPEARANCE_TYPOGRAPHY,
      clearInvalidConfig: true,
    });
  }

  getTypography(): AppearanceTypography {
    return normalizeAppearanceTypography({
      fontSize: this.store.get("fontSize", DEFAULT_APPEARANCE_TYPOGRAPHY.fontSize),
      fontFamily: this.store.get(
        "fontFamily",
        DEFAULT_APPEARANCE_TYPOGRAPHY.fontFamily,
      ),
    });
  }

  setFontSize(fontSize: FontSizeId): AppearanceTypography {
    const next = normalizeFontSizeId(fontSize);
    this.store.set("fontSize", next);
    return this.getTypography();
  }

  setFontFamily(fontFamily: FontFamilyId): AppearanceTypography {
    const next = normalizeFontFamilyId(fontFamily);
    this.store.set("fontFamily", next);
    return this.getTypography();
  }
}

export const appearanceStore = new AppearanceStore();
