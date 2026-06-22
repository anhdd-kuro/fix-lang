import React from "react";
import ReactDOM from "react-dom/client";
import "../main.css";
import { ModelSelect } from "../components/ModelSelect";
import { TrayActivityHeatmapLoader } from "./components/TrayActivityHeatmap";
import { TrayCreditBalance } from "./components/TrayCreditBalance";
import { TrayToolbar } from "./components/TrayToolbar";

const rootElement = document.getElementById("root");

const TrayWindowMain: React.FC = () => (
  <div className="bg-gray-800 backdrop-blur-sm text-gray-100 p-3 rounded-lg w-full h-full overflow-hidden">
    <TrayToolbar />
    <div className="flex flex-col gap-4">
      <TrayCreditBalance />
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

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TrayWindowMain />
  </React.StrictMode>
);

export default TrayWindowMain;
