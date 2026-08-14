import React, { useMemo, useState } from "react";
import { twJoin } from "tailwind-merge";
import { useAppearanceTypography } from "../hooks/useAppearanceTypography";
import { useTheme } from "../hooks/useTheme";
import { useI18n } from "../i18n/useI18n";
import { THEME_PRESETS } from "../themes";
import { Button } from "./Button";
import { FontFamilyTabs } from "./FontFamilyTabs";
import { FontSizeTabs } from "./FontSizeTabs";
import { Input } from "./Input";
import type { ThemeId } from "~/features/theme/store/themeIds";

const THEME_CARD_MIN = "9.5rem";
const THEME_CARD_MAX = "13rem";

/**
 * Appearance settings — searchable theme preset picker with square preview cards.
 */
export const SettingAppearance: React.FC = () => {
  const { t } = useI18n();
  const { themeId, setTheme, isLoading } = useTheme();
  const {
    typography,
    setFontSize,
    setFontFamily,
    setCustomFontSize,
    setCustomFontFamily,
    isLoading: typographyLoading,
  } = useAppearanceTypography();
  const [query, setQuery] = useState("");

  const filteredPresets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return THEME_PRESETS;
    }

    return THEME_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(normalized) ||
        preset.id.toLowerCase().includes(normalized) ||
        preset.description.toLowerCase().includes(normalized),
    );
  }, [query]);

  const handleSelect = async (nextThemeId: ThemeId) => {
    if (nextThemeId === themeId) {
      return;
    }
    await setTheme(nextThemeId);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="shrink-0">
        <h3 className="text-lg font-medium text-foreground">
          {t("settings.appearance.fontSize.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.appearance.fontSize.description")}
        </p>
        <div className="mt-3">
          <FontSizeTabs
            value={typography.fontSize}
            onChange={(fontSize) => {
              void setFontSize(fontSize);
            }}
            disabled={typographyLoading}
            className="w-full"
          />
        </div>
        {typography.fontSize === "custom" ? (
          <div className="mt-3 flex flex-col gap-1">
            <label
              htmlFor="appearance-custom-font-size"
              className="text-sm text-card-foreground"
            >
              {t("settings.appearance.fontSize.customLabel")}
            </label>
            <Input
              key={typography.customFontSize}
              id="appearance-custom-font-size"
              type="text"
              defaultValue={typography.customFontSize}
              disabled={typographyLoading}
              placeholder={t("settings.appearance.fontSize.customPlaceholder")}
              className="w-full"
              onBlur={(event) => {
                const trimmed = event.target.value.trim();
                if (trimmed.length === 0 || trimmed === typography.customFontSize) {
                  event.target.value = typography.customFontSize;
                  return;
                }
                void setCustomFontSize(trimmed).catch(() => {
                  event.target.value = typography.customFontSize;
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.appearance.fontSize.customHint")}
            </p>
          </div>
        ) : null}
      </section>

      <section className="shrink-0">
        <h3 className="text-lg font-medium text-foreground">
          {t("settings.appearance.fontFamily.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.appearance.fontFamily.description")}
        </p>
        <div className="mt-3">
          <FontFamilyTabs
            value={typography.fontFamily}
            onChange={(fontFamily) => {
              void setFontFamily(fontFamily);
            }}
            disabled={typographyLoading}
            className="w-full"
          />
        </div>
        {typography.fontFamily === "custom" ? (
          <div className="mt-3 flex flex-col gap-1">
            <label
              htmlFor="appearance-custom-font-family"
              className="text-sm text-card-foreground"
            >
              {t("settings.appearance.fontFamily.customLabel")}
            </label>
            <Input
              key={typography.customFontFamily}
              id="appearance-custom-font-family"
              type="text"
              defaultValue={typography.customFontFamily}
              disabled={typographyLoading}
              placeholder={t("settings.appearance.fontFamily.customPlaceholder")}
              className="w-full"
              onBlur={(event) => {
                const trimmed = event.target.value.trim();
                if (trimmed.length === 0 || trimmed === typography.customFontFamily) {
                  event.target.value = typography.customFontFamily;
                  return;
                }
                void setCustomFontFamily(trimmed).catch(() => {
                  event.target.value = typography.customFontFamily;
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.appearance.fontFamily.customHint")}
            </p>
          </div>
        ) : null}
      </section>

      <div className="shrink-0">
        <h3 className="text-lg font-medium text-foreground">
          {t("settings.appearance.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.appearance.description", {
            count: THEME_PRESETS.length,
          })}
        </p>
      </div>

      <label className="block shrink-0">
        <span className="sr-only">{t("settings.appearance.searchLabel")}</span>
        <Input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={t("settings.appearance.searchPlaceholder")}
          className="w-full"
        />
      </label>

      {filteredPresets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("settings.appearance.noMatches", { query })}
        </p>
      ) : (
        <div
          className="p-1"
          role="radiogroup"
          aria-label={t("settings.appearance.radioGroupLabel")}
        >
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${THEME_CARD_MIN}), 1fr))`,
            }}
          >
            {filteredPresets.map((preset) => {
              const isSelected = preset.id === themeId;

              return (
                <Button
                  key={preset.id}
                  type="button"
                  variant={isSelected ? "primary" : "outline"}
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={preset.label}
                  disabled={isLoading}
                  onClick={() => {
                    void handleSelect(preset.id);
                  }}
                  style={{ maxWidth: THEME_CARD_MAX }}
                  className={twJoin(
                    "group mx-auto flex w-full min-w-0 flex-col rounded-lg border text-left",
                    isSelected
                      ? "border-ring ring-2 ring-ring ring-offset-2 ring-offset-background"
                      : "border-card-control-border hover:border-primary/50 hover:bg-accent/40",
                  )}
                >
                  <div
                    className="relative aspect-square w-full overflow-hidden rounded-t-[calc(0.5rem-1px)]"
                    style={{ backgroundColor: preset.swatch.background }}
                    aria-hidden="true"
                  >
                    <div
                      className="absolute inset-x-3 top-3 h-3 rounded-sm"
                      style={{ backgroundColor: preset.swatch.primary }}
                    />
                    <div
                      className="absolute inset-x-3 bottom-3 h-8 rounded-sm"
                      style={{ backgroundColor: preset.swatch.accent }}
                    />
                  </div>
                  <div className="px-2.5 py-2">
                    <div
                      className={twJoin(
                        "truncate text-sm font-medium",
                        isSelected
                          ? "text-primary-foreground"
                          : "text-foreground",
                      )}
                    >
                      {preset.label}
                    </div>
                    <div
                      className={twJoin(
                        "truncate text-xs",
                        isSelected
                          ? "text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {preset.description}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
