import React, { useEffect, useState } from "react";
import "../main.css";
import ReactDOM from "react-dom/client";
import CopyButton from "../components/CopyButton";
import type { SummaryPayload } from "~/main/partials/summaryWindow";

const App: React.FC = () => {
  const [data, setData] = useState<SummaryPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSummaryData((payload) => {
      setData(payload);
    });
    return () => unsubscribe();
  }, []);

  if (!data) return null;

  return (
    <div className="flex flex-col relative px-2 pb-2 backdrop-blur-2xl shadow-lg overflow-auto w-screen h-screen text-white">
      <textarea
        className="prose dark:prose-invert text-xs whitespace-pre-wrap overflow-auto w-full flex-1 p-1 focus:outline-none focus:border-none mt-8"
        value={data.summarizedText}
        readOnly
        placeholder="Summary"
      />
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <p>Prompt Tokens: {data.promptTokens ?? "-"}</p>
        <p>Completion Tokens: {data.completionTokens ?? "-"}</p>
      </div>
      <div className="flex absolute top-2 right-2 gap-1">
        <CopyButton value={data.summarizedText} label="Copy summary" />
      </div>
    </div>
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
