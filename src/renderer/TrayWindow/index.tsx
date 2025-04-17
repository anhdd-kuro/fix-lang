import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "../main.css"; // Import Tailwind CSS entry point
import { TextAreaBox } from "../components/TextAreaBox";

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

  return (
    <div className="bg-gray-800 backdrop-blur-sm text-gray-100 p-2 rounded-lg w-full h-screen">
      <div className="bg-gray-800 text-gray-100 p-4 rounded-lg w-full">
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
              label="Corrected"
              value={lastHistory.corrected}
              readOnly
              placeholder="Corrected text"
            />
          </div>
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
