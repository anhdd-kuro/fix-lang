import React from "react";
import {
  FONT_SIZE_IDS,
  type FontSizeId,
} from "~/features/appearance/shared/typography";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "../i18n/useI18n";

export type FontSizeTabsSize = "sm" | "md";

type FontSizeTabsProps = {
  value: FontSizeId;
  onChange: (fontSize: FontSizeId) => void;
  /** `sm` for dense surfaces; `md` for settings. */
  size?: FontSizeTabsSize;
  className?: string;
  disabled?: boolean;
};

/**
 * Font-size switcher rendered as a segmented control, matching `LanguageTabs`.
 */
export const FontSizeTabs: React.FC<FontSizeTabsProps> = ({
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
      ariaLabel={t("settings.appearance.fontSize.label")}
      size={size}
      equalWidth
      className={className}
      options={FONT_SIZE_IDS.map((fontSize) => ({
        value: fontSize,
        label: t(`settings.appearance.fontSize.${fontSize}`),
        disabled,
      }))}
    />
  );
};

export default FontSizeTabs;
