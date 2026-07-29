import React from "react";
import ReactDOM from "react-dom/client";
import "../main.css";
import { LanguageTabs } from "../components/LanguageTabs";
import { ModelSelect } from "../components/ModelSelect";
import { OutputModeTabs } from "../components/OutputModeTabs";
import { ReasoningEffortSelect } from "../components/ReasoningEffortSelect";
import Tooltip from "../components/Tooltip";
import { useActiveProfileId } from "../hooks/useActiveProfileId";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";
import { TrayActivityHeatmapLoader } from "./components/TrayActivityHeatmap";
import { TrayCreditBalance } from "./components/TrayCreditBalance";
import { TrayToolbar } from "./components/TrayToolbar";

const rootElement = document.getElementById("root");

const TrayGlobalSelectors: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-card-foreground">
          {t("tray.global.heading")}
        </span>
        <Tooltip
          tooltipText={t("tray.global.overrideTooltip")}
          width="w-64"
          className="shrink-0"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="model-select"
          className="text-xs font-medium text-muted-foreground"
        >
          {t("tray.global.model.label")}
        </label>
        <ModelSelect
          saveOnChange
          showAdditionalInfo
          menuPortal
          menuMaxHeight={200}
          compact
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="tray-reasoning-select"
          className="text-xs font-medium text-muted-foreground"
        >
          {t("tray.global.reasoning.label")}
        </label>
        <ReasoningEffortSelect selectClassName="w-full px-2 py-1.5 text-xs" />
      </div>
    </div>
  );
};

const TrayWindowMain: React.FC = () => {
  useTheme();
  // The credit balance is an ACCOUNT figure with a 60s cache and a latched
  // `hasKey`, so it must not survive a profile switch — the tray stays open
  // across one, and a stale balance reads as the new profile's.
  const profileId = useActiveProfileId();

  return (
  <div className="bg-background/95 backdrop-blur-sm text-foreground p-3 pb-5 rounded-lg w-full h-full overflow-y-auto">
    <TrayToolbar />
    <div className="flex flex-col gap-4 pb-2">
      <TrayCreditBalance key={profileId} />
      <LanguageTabs />
      <OutputModeTabs />
      <TrayActivityHeatmapLoader />
      <TrayGlobalSelectors key={profileId} />
    </div>
  </div>
  );
};

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider>
      <TrayWindowMain />
    </I18nProvider>
  </React.StrictMode>
);

export default TrayWindowMain;
