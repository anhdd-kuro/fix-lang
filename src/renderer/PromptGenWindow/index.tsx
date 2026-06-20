import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../main.css";
import { Button } from "../components/Button";
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

  if (!data) {
    return (
      <div
        data-testid="promptgen-window-root"
        className="flex flex-col h-screen bg-window text-label-primary"
      />
    );
  }

  return (
    <div
      data-testid="promptgen-window-root"
      className="flex flex-col h-screen bg-window text-label-primary px-4 py-2"
    >
      {/* Title bar — draggable via Electron native window frame */}
      <h2 className="font-semibold text-sm text-label-primary">
        Generated Prompts ({data.prompts.length})
      </h2>

      {/* Main content */}
      <div className="space-y-4 mb-4 flex-1 overflow-auto mt-2">
        {data.prompts.map((prompt, index) => (
          <div
            key={index}
            className="bg-control rounded-[6px] p-4 relative group border border-separator/60"
          >
            <p className="whitespace-pre-wrap font-mono text-xs mb-2 pr-8 text-label-primary">
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

      {/* Footer bar */}
      <div className="flex justify-between items-center sticky bottom-0 bg-control px-3 py-2 rounded-[6px] border border-separator/60">
        <div className="text-xs text-label-secondary flex items-center gap-2">
          {data.promptTokens != null && (
            <span>Prompt tokens: {data.promptTokens}</span>
          )}
          {data.promptTokens != null && data.completionTokens != null && (
            <span className="text-label-tertiary">|</span>
          )}
          {data.completionTokens != null && (
            <span>Completion tokens: {data.completionTokens}</span>
          )}
          {(data.promptTokens != null || data.completionTokens != null) &&
            data.model && <span className="text-label-tertiary">|</span>}
          {data.model && <span>Model: {data.model}</span>}
        </div>
        <Button
          variant="default"
          onClick={() =>
            window.electronAPI.copyToClipboard(data.prompts.join("\n\n"))
          }
        >
          Copy All
        </Button>
      </div>
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PromptGenWindow />);
}
