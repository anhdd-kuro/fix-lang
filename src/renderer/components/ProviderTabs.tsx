import React from "react";
import { PROVIDER_ORDER, type ProviderId } from "~/features/providers/shared/providers";
import { PROVIDER_LABEL_KEYS } from "./modelSelectOptions";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "../i18n/useI18n";

export type ProviderTabsSize = "sm" | "md";

type ProviderTabsProps = {
  value: ProviderId;
  onChange: (provider: ProviderId) => void;
  /** `sm` for dense surfaces; `md` for settings. */
  size?: ProviderTabsSize;
  className?: string;
};

/**
 * Provider switcher rendered as a segmented control, matching `LanguageTabs`.
 * One provider panel is shown at a time in Settings → General.
 */
export const ProviderTabs: React.FC<ProviderTabsProps> = ({
  value,
  onChange,
  size = "md",
  className,
}) => {
  const { t } = useI18n();

  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel={t("settings.general.providers.title")}
      size={size}
      equalWidth={false}
      className={className}
      options={PROVIDER_ORDER.map((provider) => ({
        value: provider,
        label: t(PROVIDER_LABEL_KEYS[provider]),
      }))}
    />
  );
};

export default ProviderTabs;
