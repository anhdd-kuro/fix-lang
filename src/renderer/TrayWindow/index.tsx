import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "../main.css"; // Import Tailwind CSS entry point
import { ModelSelect } from "../components/ModelSelect";
import { SettingsButton } from "../components/SettingsIcon";
import { TextAreaBox } from "../components/TextAreaBox";

const rootElement = document.getElementById("root");

const TrayWindowMain: React.FC = () => {
  const [lastHistory, setLastHistory] = useState<{
    original: string;
    result: string;
  }>({ original: "", result: "" });

  // Listen for tray requests from main
  useEffect(() => {
    window.electronAPI
      .getLastActionHistory()
      .then((data) => {
        if (!data) {
          setLastHistory({ original: "", result: "" });
          return;
        }

        // Handle different potential data structures
        // If it's a LastActionHistory (has featureId and entry)
        if (
          "entry" in data &&
          "featureId" in data &&
          typeof data.entry === "object" &&
          data.entry !== null
        ) {
          const entry = data.entry as { original?: string; corrected?: string };
          setLastHistory({
            original: entry.original || "",
            result: entry.corrected || "",
          });
        }
        // If it's directly a HistoryEntry
        else if ("original" in data && "corrected" in data) {
          setLastHistory({
            original: data.original || "",
            result: data.corrected || "",
          });
        }
        // Unknown structure, use empty values
        else {
          setLastHistory({ original: "", result: "" });
        }
      })
      .catch((error) => {
        console.error("Error fetching last action history:", error);
        setLastHistory({ original: "", result: "" });
      });
  }, []);

  return (
    <div className="bg-gray-800 backdrop-blur-sm text-gray-100 p-2 rounded-lg w-full h-screen">
      <div className="bg-gray-800 text-gray-100 p-4 rounded-lg w-full relative">
        {/* Settings button positioned at top right */}
        <div className="absolute top-2 right-2">
          <SettingsButton
            onClick={() => window.electronAPI.showMainWindowSettings()}
            className="text-gray-400 hover:text-white"
            iconClassName="size-5"
          />
        </div>
        <h3 className="text-sm">Last Action</h3>
        <div className="flex flex-col gap-4 mt-2">
          <div className="flex-1 flex flex-col">
            <TextAreaBox
              label="Original"
              value={lastHistory.original}
              readOnly
              placeholder="Original text"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <TextAreaBox
              label="Result"
              value={lastHistory.result}
              readOnly
              placeholder="Result text"
            />
          </div>
          <ModelSelect saveOnChange />
        </div>
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-4 rounded"
          onClick={() => window.electronAPI.quitApp()}
        >
          Quit Application
        </button>
      </div>
    </div>
  );
};

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TrayWindowMain />
  </React.StrictMode>
);
export default TrayWindowMain;
