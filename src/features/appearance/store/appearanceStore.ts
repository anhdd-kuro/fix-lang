/**
 * @file appearanceStore.ts
 * @description Persists global UI typography preferences (font size and family).
 */
import Store from "electron-store";
import {
  DEFAULT_APPEARANCE_TYPOGRAPHY,
  isValidCustomFontFamily,
  isValidCustomFontSize,
  normalizeAppearanceTypography,
  normalizeCustomFontFamily,
  normalizeCustomFontSize,
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
      customFontSize: this.store.get(
        "customFontSize",
        DEFAULT_APPEARANCE_TYPOGRAPHY.customFontSize,
      ),
      customFontFamily: this.store.get(
        "customFontFamily",
        DEFAULT_APPEARANCE_TYPOGRAPHY.customFontFamily,
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

  setCustomFontSize(customFontSize: string): AppearanceTypography | null {
    if (!isValidCustomFontSize(customFontSize)) {
      return null;
    }
    const next = normalizeCustomFontSize(customFontSize);
    this.store.set("fontSize", "custom");
    this.store.set("customFontSize", next);
    return this.getTypography();
  }

  setCustomFontFamily(customFontFamily: string): AppearanceTypography | null {
    if (!isValidCustomFontFamily(customFontFamily)) {
      return null;
    }
    const next = normalizeCustomFontFamily(customFontFamily);
    this.store.set("fontFamily", "custom");
    this.store.set("customFontFamily", next);
    return this.getTypography();
  }
}

export const appearanceStore = new AppearanceStore();
