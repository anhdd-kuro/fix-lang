import React from "react";
import {
  FONT_FAMILY_IDS,
  type FontFamilyId,
} from "~/features/appearance/shared/typography";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "../i18n/useI18n";

export type FontFamilyTabsSize = "sm" | "md";

type FontFamilyTabsProps = {
  value: FontFamilyId;
  onChange: (fontFamily: FontFamilyId) => void;
  /** `sm` for dense surfaces; `md` for settings. */
  size?: FontFamilyTabsSize;
  className?: string;
  disabled?: boolean;
};

/**
 * Font-family switcher rendered as a segmented control, matching `LanguageTabs`.
 */
export const FontFamilyTabs: React.FC<FontFamilyTabsProps> = ({
  value,
  onChange,
  size = "md",
  className,
  disabled = false,
}) => {
  const { t } = useI18n();

  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel={t("settings.appearance.fontFamily.label")}
      size={size}
      equalWidth
      className={className}
      options={FONT_FAMILY_IDS.map((fontFamily) => ({
        value: fontFamily,
        label: t(`settings.appearance.fontFamily.${fontFamily}`),
        disabled,
      }))}
    />
  );
};

export default FontFamilyTabs;
