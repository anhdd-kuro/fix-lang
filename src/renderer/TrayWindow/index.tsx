import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import CopyButton from "../components/CopyButton";
import "../main.css"; // Import Tailwind CSS entry point

const rootElement = document.getElementById("root");

const TrayWindowMain: React.FC = () => {
  const [lastHistory, setLastHistory] = useState<{
    original: string;
    corrected: string;
  }>({ original: "", corrected: "" });

  // Listen for tray requests from main
  useEffect(() => {
    window.electronAPI.getLastHistory().then((data) => setLastHistory(data));
  }, []);

  const handleClose = () => {
    window.electronAPI.hideTray();
  };

  return (
    <div className="bg-gray-800 backdrop-blur-sm text-gray-100 p-4 rounded-lg w-full h-screen">
      <div className="bg-gray-800 text-gray-100 p-4 rounded-lg w-full">
        <h3 className="text-lg mb-2">Last Action</h3>
        <div className="flex flex-col gap-2">
          <div className="flex-1 flex flex-col">
            <span className="text-sm mb-1">Original</span>
            <CopyButton value={lastHistory.original} label="Copy original" />
            <textarea
              readOnly
              value={lastHistory.original}
              aria-label="Original text"
              className="w-full h-24 bg-gray-700 p-2 rounded resize-none"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <span className="text-sm mb-1">Corrected</span>
            <CopyButton value={lastHistory.corrected} label="Copy corrected" />
            <textarea
              readOnly
              value={lastHistory.corrected}
              aria-label="Corrected text"
              className="w-full h-24 bg-gray-700 p-2 rounded resize-none"
            />
          </div>
        </div>
        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={handleClose}
            className="text-blue-400 hover:text-blue-200"
          >
            Close
          </button>
        </div>
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
