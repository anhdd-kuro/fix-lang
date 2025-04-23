import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "../main.css"; // Import Tailwind CSS entry point
import { ModelSelect } from "../components/ModelSelect";
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
      .then((data) => setLastHistory(data ?? { original: "", result: "" }));
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
              label="Result"
              value={lastHistory.result}
              readOnly
              placeholder="Result text"
            />
          </div>
          <ModelSelect />
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
