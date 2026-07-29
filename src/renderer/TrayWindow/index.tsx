import React from "react";
import ReactDOM from "react-dom/client";
import "../main.css";
import { LanguageTabs } from "../components/LanguageTabs";
import { ModelSelect } from "../components/ModelSelect";
import { OutputModeTabs } from "../components/OutputModeTabs";
import { useActiveProfileId } from "../hooks/useActiveProfileId";
import { useTheme } from "../hooks/useTheme";
import { I18nProvider } from "../i18n/I18nProvider";
import { TrayActivityHeatmapLoader } from "./components/TrayActivityHeatmap";
import { TrayCreditBalance } from "./components/TrayCreditBalance";
import { TrayToolbar } from "./components/TrayToolbar";

const rootElement = document.getElementById("root");

const TrayWindowMain: React.FC = () => {
  useTheme();
  // The credit balance is an ACCOUNT figure with a 60s cache and a latched
  // `hasKey`, so it must not survive a profile switch — the tray stays open
  // across one, and a stale balance reads as the new profile's.
  const profileId = useActiveProfileId();

  return (
  <div className="bg-background/95 backdrop-blur-sm text-foreground p-3 rounded-lg w-full h-full overflow-hidden">
    <TrayToolbar />
    <div className="flex flex-col gap-4">
      <TrayCreditBalance key={profileId} />
      <LanguageTabs />
      <OutputModeTabs />
      <TrayActivityHeatmapLoader />
      <ModelSelect
        saveOnChange
        showAdditionalInfo
        menuPortal
        menuMaxHeight={200}
        compact
      />
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
