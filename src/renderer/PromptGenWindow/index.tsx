import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../main.css";
import CopyButton from "../components/CopyButton";

type PromptGenData = {
  prompts: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  autoCopy?: boolean;
  x: number;
  y: number;
  model?: string;
};

const PromptGenWindow: React.FC = () => {
  const [data, setData] = useState<PromptGenData | null>(null);

  useEffect(() => {
    window.electronAPI.onPromptGenData((payload) => {
      console.log(
        `🚀 \n - window.electronAPI.onPromptGenData \n - payload:`,
        payload
      );
      setData(payload);

      if (payload.autoCopy && payload.prompts.length > 0) {
        const allPrompts = payload.prompts.join("\n\n");
        window.electronAPI.copyToClipboard(allPrompts);
      }
    });
    return () => {
      window.electronAPI.removePromptGenDataListener();
    };
  }, []);

  if (!data) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white px-4 py-2">
      {/* Title bar - this will be draggable due to Electron's native window frame */}
      <h2 className="font-semibold text-sm">
        Generated Prompts ({data.prompts.length})
      </h2>

      {/* Main content */}
      <div className="space-y-4 mb-4 flex-1 overflow-auto mt-2">
        {data.prompts.map((prompt, index) => (
          <div
            key={index}
            className="bg-gray-800 rounded p-4 relative group shadow-md"
          >
            <p className="whitespace-pre-wrap font-mono text-xs mb-2 pr-8">
              {prompt}
            </p>
            <CopyButton
              value={prompt}
              label="Copy"
              className="absolute top-2 right-2"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center sticky bottom-0 bg-gray-800 p-3 rounded-md shadow-md border border-gray-700">
        <div className="text-xs text-gray-400">
          {data.promptTokens && <span>Prompt tokens: {data.promptTokens}</span>}
          {" | "}
          {data.completionTokens && (
            <span className="ml-2">
              Completion tokens: {data.completionTokens}
            </span>
          )}
          {" | "}
          {data.model && <span className="ml-2">Model: {data.model}</span>}
        </div>
        <CopyButton
          value={data.prompts.join("\n\n")}
          label="Copy All"
          showLabel
        />
      </div>
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PromptGenWindow />);
}
