import React from "react";
import { LOCALE_OPTIONS, type Locale } from "~/shared/i18n/registry";
import { useI18n } from "../i18n/useI18n";

/**
 * Interface-language picker. Options are generated from `LOCALE_OPTIONS`
 * (native names, e.g. "English" / "日本語") — adding a third locale to the
 * registry makes it appear here with zero edits to this file.
 *
 * Switching is instant and global: `setLocale` persists in main and
 * broadcasts `locale-changed`, so every window (dashboard, tray, PromptGen,
 * result popup) re-renders in the new language without a restart.
 */
export const LanguageSelect: React.FC = () => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div>
      {/* The section heading in SettingGeneral already reads "Language" /
          「言語」 visually — this label stays for the select's accessible
          name but is visually hidden to avoid rendering the same text twice
          stacked on screen. */}
      <label htmlFor="language-select" className="sr-only">
        {t("settings.general.language.label")}
      </label>
      <select
        id="language-select"
        className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        value={locale}
        onChange={(event) => {
          void setLocale(event.target.value as Locale);
        }}
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelect;
