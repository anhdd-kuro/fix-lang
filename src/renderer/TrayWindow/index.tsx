import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "../main.css"; // Import Tailwind CSS entry point
import { ModelSelect } from "../components/ModelSelect";
import ProfileSelector from "../components/ProfileSelector";
import { SettingsButton } from "../components/SettingsIcon";
import { TextAreaBox } from "../components/TextAreaBox";

const rootElement = document.getElementById("root");

const TrayWindowMain: React.FC = () => {
  const [lastHistory, setLastHistory] = useState<{
    original: string;
    result: string;
    model?: string;
  }>({ original: "", result: "", model: "" });

  // Listen for tray requests from main
  useEffect(() => {
    window.electronAPI
      .getLastActionHistory()
      .then((data) => {
        if (!data) {
          setLastHistory({ original: "", result: "", model: "" });
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
            model: data.model,
          });
        }
        // If it's directly a HistoryEntry
        else if ("original" in data && "corrected" in data) {
          setLastHistory({
            original: data.original || "",
            result: data.corrected || "",
            model: data.model,
          });
        }
        // Unknown structure, use empty values
        else {
          setLastHistory({ original: "", result: "", model: "" });
        }
      })
      .catch((error) => {
        console.error("Error fetching last action history:", error);
        setLastHistory({ original: "", result: "", model: "" });
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
              model={lastHistory.model}
            />
          </div>
          <div className="flex-1 flex flex-col">
            <TextAreaBox
              label="Result"
              value={lastHistory.result}
              readOnly
              placeholder="Result text"
              model={lastHistory.model}
            />
          </div>
          <div className="flex flex-col justify-between items-center gap-2 mt-2 mb-1">
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <ProfileSelector />
            </div>

            <ModelSelect saveOnChange showAdditionalInfo={false} />
          </div>
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
