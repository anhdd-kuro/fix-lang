import React from "react";
import { LOCALE_OPTIONS, type Locale } from "~/shared/i18n/registry";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "../i18n/useI18n";

/**
 * Interface-language switcher rendered as a segmented control ("tabs")
 * instead of a `<select>`. Shared by the settings panel, the dashboard
 * header, and the tray window, so all three stay visually and behaviourally
 * identical.
 *
 * Options come from `LOCALE_OPTIONS` (native names, e.g. "English" /
 * 「日本語」), so adding a third locale to the registry makes it appear in
 * every mount point with zero edits here.
 *
 * Switching is instant and global: `setLocale` persists in main and
 * broadcasts `locale-changed`, so every window re-renders in the new
 * language without a restart. The control never optimistically flips its own
 * highlight — `locale` comes from the provider, which only advances on that
 * broadcast, so what's highlighted always matches what main actually holds.
 */

export type LanguageTabsSize = "sm" | "md";

type LanguageTabsProps = {
  /** `sm` for dense surfaces (tray, dashboard header); `md` for settings. */
  size?: LanguageTabsSize;
  /** Extra classes for the container — e.g. `w-full` in the settings panel. */
  className?: string;
};

export const LanguageTabs: React.FC<LanguageTabsProps> = ({
  size = "sm",
  className,
}) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <SegmentedControl
      value={locale}
      onChange={(code) => {
        void setLocale(code as Locale);
      }}
      ariaLabel={t("settings.general.language.label")}
      size={size}
      equalWidth
      className={className}
      options={LOCALE_OPTIONS.map((option) => ({
        value: option.code,
        label: option.nativeLabel,
        lang: option.code,
      }))}
    />
  );
};

export default LanguageTabs;
