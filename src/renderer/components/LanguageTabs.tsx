import React from "react";
import { twJoin } from "tailwind-merge";
import { LOCALE_OPTIONS, type Locale } from "~/shared/i18n/registry";
import { Button } from "./Button";
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
 *
 * ARIA: this is a mutually-exclusive setting, not a view switcher, so it
 * deliberately does NOT use `role="tablist"`/`role="tab"` despite the visual
 * name — those roles promise `tabpanel`s that do not exist here. It mirrors
 * the dashboard's range pills (`role="group"` + `aria-pressed`), which is the
 * established idiom in this codebase for "pick one of N".
 */

export type LanguageTabsSize = "sm" | "md";

type LanguageTabsProps = {
  /** `sm` for dense surfaces (tray, dashboard header); `md` for settings. */
  size?: LanguageTabsSize;
  /** Extra classes for the container — e.g. `w-full` in the settings panel. */
  className?: string;
};

const SIZE_CLASSES: Record<LanguageTabsSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export const LanguageTabs: React.FC<LanguageTabsProps> = ({
  size = "sm",
  className,
}) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("settings.general.language.label")}
      className={twJoin(
        "flex gap-1 rounded-lg bg-background/60 p-0.5",
        className,
      )}
    >
      {LOCALE_OPTIONS.map((option) => {
        const isActive = option.code === locale;
        return (
          <Button
            key={option.code}
            variant={isActive ? "primary" : "ghost"}
            // `lang` so a screen reader pronounces each native name with the
            // right voice — the button label is in the language it selects,
            // not in the currently active one.
            lang={option.code}
            aria-pressed={isActive}
            onClick={() => {
              if (isActive) return;
              void setLocale(option.code as Locale);
            }}
            className={twJoin(
              "flex-1 rounded-md font-medium whitespace-nowrap",
              SIZE_CLASSES[size],
              isActive ? "shadow" : "text-muted-foreground",
            )}
          >
            {option.nativeLabel}
          </Button>
        );
      })}
    </div>
  );
};

export default LanguageTabs;
