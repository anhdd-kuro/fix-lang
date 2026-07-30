/**
 * @file TrayWindowMain.tsx
 * @description The tray panel's component tree. Split from `index.tsx` — which
 * is a bootstrap that calls `createRoot` at module scope — so this tree can be
 * rendered in a test without a `#root` element.
 */
import React from "react";
import { DefaultReasoningEffortSlider } from "../components/DefaultReasoningEffortSlider";
import { LanguageTabs } from "../components/LanguageTabs";
import { ModelSelect } from "../components/ModelSelect";
import { OutputModeTabs } from "../components/OutputModeTabs";
import Tooltip from "../components/Tooltip";
import { useActiveProfileId } from "../hooks/useActiveProfileId";
import { useTheme } from "../hooks/useTheme";
import { useI18n } from "../i18n/useI18n";
import { TrayActivityHeatmapLoader } from "./components/TrayActivityHeatmap";
import { TrayProviderSummary } from "./components/TrayProviderSummary";
import { TrayToolbar } from "./components/TrayToolbar";

const TrayGlobalSelectors: React.FC = () => {
  const { t } = useI18n();

  const overrideTooltip = (
    <Tooltip
      tooltipText={t("tray.global.overrideTooltip")}
      width="w-64"
      className="shrink-0"
      portal
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="model-select"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("tray.global.model.label")}
          </label>
          {overrideTooltip}
        </div>
        <ModelSelect
          saveOnChange
          showAdditionalInfo
          menuPortal
          menuMaxHeight={200}
          compact
        />
      </div>

      <DefaultReasoningEffortSlider
        label={t("tray.global.reasoning.label")}
        labelAdornment={overrideTooltip}
      />
    </div>
  );
};

export const TrayWindowMain: React.FC = () => {
  useTheme();
  // Account figures below carry a 60s cache and a latched `hasKey`, so they must
  // not survive a profile switch — the tray stays open across one, and a stale
  // balance reads as the new profile's.
  //
  // Each key is PREFIXED. `useActiveProfileId` returns "" until its IPC
  // resolves, and two siblings keyed by that same "" collide in React's
  // reconciliation map: the second evicts the first, so when the key flips to
  // the real id the first component is never unmounted and its DOM node stays
  // behind as a duplicate card. Production React logs no duplicate-key warning.
  const profileId = useActiveProfileId();

  return (
    <div className="bg-background/95 backdrop-blur-sm text-foreground p-3 pb-5 rounded-lg w-full h-full overflow-y-auto">
      <TrayToolbar />
      <div className="flex flex-col gap-4 pb-2">
        <TrayProviderSummary key={`providers-${profileId}`} />
        <div className="flex flex-col gap-2 rounded-lg border border-card-control-border bg-card p-2">
          <LanguageTabs />
          <OutputModeTabs />
        </div>
        <TrayActivityHeatmapLoader />
        <TrayGlobalSelectors key={`selectors-${profileId}`} />
      </div>
    </div>
  );
};

export default TrayWindowMain;
