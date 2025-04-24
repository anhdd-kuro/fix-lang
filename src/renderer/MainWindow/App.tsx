import React, { useState, useEffect } from "react";
import HistoryReviewModal from "../components/HistoryReviewModal";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import type { HistoryEntry, HistoryStoreType } from "~/stores/historyStore";

// Define UI-specific history type for frontend use
type UiHistoryType = "corrections" | "translations" | "summarize" | "promptGen";

// Define history features configuration (duplicate from shared config)
// This is safer than importing the actual HISTORY_FEATURES array which might contain non-UI code
const HISTORY_FEATURES = [
  {
    id: "corrections" as const,
    uiKey: "corrections" as const,
    label: "Corrections",
  },
  {
    id: "translations" as const,
    uiKey: "translations" as const,
    label: "Translations",
  },
  {
    id: "summarize" as const,
    uiKey: "summarize" as const,
    label: "Summarize",
  },
  {
    id: "promptGen" as const,
    uiKey: "promptGen" as const,
    label: "Prompt Generator",
  },
] satisfies { id: HistoryStoreType; uiKey: UiHistoryType; label: string }[];

// Import only the HistoryType, not VersionEntry since we have a local one

// Using the centralized type definitions from historyStore

// (We're using the VersionEntry type defined at the top of the file)

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
// Helper to map UI history types to API history types
const mapHistoryType = (uiKey: UiHistoryType): HistoryStoreType => {
  const feature = HISTORY_FEATURES.find((f) => f.uiKey === uiKey);
  if (!feature) {
    console.error(`History feature with UI key ${uiKey} not found`);
    return "corrections"; // Default fallback
  }
  return feature.id;
};

const App: React.FC = () => {
  // History state for all features using a unified approach
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // History type selector state
  const [historyType, setHistoryType] = useState<UiHistoryType>("corrections");

  // Options for history selector - using our local configuration
  const historyOptions: { value: UiHistoryType; label: string }[] =
    HISTORY_FEATURES.map((feature) => {
      return { value: feature.uiKey, label: feature.label };
    });
  const [initialSettingsTab, setInitialSettingsTab] = useState<number>(0);
  // State for text areas
  const [originalText, setOriginalText] = useState<string>("");
  const [fixedText, setFixedText] = useState<string>("");
  // Token counts for OpenAI usage
  const [promptTokens, setPromptTokens] = useState<number | null>(null);
  const [completionTokens, setCompletionTokens] = useState<number | null>(null);
  // Settings modal visibility
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  // Loading state for API call
  const [_loading, _setLoading] = useState<boolean>(false);
  // History panel visibility
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  const [showHistoryReview, setShowHistoryReview] = useState<boolean>(false);
  const [lastHistoryData, setLastHistoryData] = useState<{
    original: string;
    corrected: string;
  }>({ original: "", corrected: "" });

  useEffect(() => {
    window.electronAPI.getHistory(historyType).then((history) => {
      setHistory(history);
    });

    const removeHistoryListener = window.electronAPI.onHistoryUpdate?.(
      (payload) => {
        console.log("onHistoryUpdate", payload);
        setHistory(payload.entries);
      }
    );

    return () => {
      removeHistoryListener?.();
    };
  }, [historyType]);

  useEffect(() => {
    const offOpenSettings = window.electronAPI.onOpenSettings?.(() => {
      setInitialSettingsTab(0);
      setIsSettingsOpen(true);
    });
    const offModel = window.electronAPI.onOpenModelDialog?.(() => {
      setInitialSettingsTab(0);
      setIsSettingsOpen(true);
    });
    const offKey = window.electronAPI.onOpenKeybindingsDialog?.(() => {
      setInitialSettingsTab(1);
      setIsSettingsOpen(true);
    });
    const offPrompt = window.electronAPI.onOpenPromptDialog?.(() => {
      setInitialSettingsTab(2);
      setIsSettingsOpen(true);
    });
    const offHistory = window.electronAPI.onOpenHistoryDialog?.(async () => {
      const history = await window.electronAPI.getHistory("corrections");
      const last = history[history.length - 1] || {
        original: "",
        corrected: "",
      };
      setLastHistoryData(last);
      setShowHistoryReview(true);
    });
    
    // The onOpenSettings handler above already takes care of this
    // No need for additional listeners
    
    return () => {
      offOpenSettings?.();
      offModel?.();
      offKey?.();
      offPrompt?.();
      offHistory?.();
      // No additional cleanup needed
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex">
      {/* Sidebar history panel */}
      <aside
        className={`relative z-10 flex flex-col bg-gray-800 border-r border-gray-700 h-screen transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        <div className="flex justify-between items-center mb-4 sticky top-0 bg-gray-800 z-10">
          <div className="w-full">
            <select
              id="history-selector"
              value={historyType}
              onChange={(e) => setHistoryType(e.target.value as UiHistoryType)}
              className="w-full bg-gray-700 text-white border border-gray-600 rounded py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Select history type"
            >
              {historyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="divide-y divide-gray-700 flex-1 overflow-y-auto">
          {history.map((entry, idx) => (
            <li
              key={idx}
              className="py-2 hover:bg-gray-700 cursor-pointer px-2"
              onClick={() => {
                setOriginalText(entry.original);
                setFixedText(entry.corrected);
                setPromptTokens(entry.promptTokens ?? null);
                setCompletionTokens(entry.completionTokens ?? null);
              }}
            >
              <div className="text-sm text-gray-400">
                {new Date(entry.timestamp).toLocaleString()}
              </div>
              <div className="text-sm text-gray-100">
                {entry.original.slice(0, 50)}...
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            const featureId = mapHistoryType(historyType);
            window.electronAPI
              .clearHistory(featureId)
              .then(() => {
                setHistory([]);
              })
              .catch((err: Error) =>
                console.error(`Failed to clear ${featureId} history`, err)
              );
          }}
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-600 ml-auto mt-4 justify-end"
        >
          <svg
            shapeRendering="geometricPrecision"
            textRendering="geometricPrecision"
            imageRendering="optimizeQuality"
            fillRule="evenodd"
            clipRule="evenodd"
            viewBox="0 0 456 511.82"
            className="size-4"
          >
            <title>Trash icon</title>
            <path
              fill="#FD3B3B"
              d="M48.42 140.13h361.99c17.36 0 29.82 9.78 28.08 28.17l-30.73 317.1c-1.23 13.36-8.99 26.42-25.3 26.42H76.34c-13.63-.73-23.74-9.75-25.09-24.14L20.79 168.99c-1.74-18.38 9.75-28.86 27.63-28.86zM24.49 38.15h136.47V28.1c0-15.94 10.2-28.1 27.02-28.1h81.28c17.3 0 27.65 11.77 27.65 28.01v10.14h138.66c.57 0 1.11.07 1.68.13 10.23.93 18.15 9.02 18.69 19.22.03.79.06 1.39.06 2.17v42.76c0 5.99-4.73 10.89-10.62 11.19-.54 0-1.09.03-1.63.03H11.22c-5.92 0-10.77-4.6-11.19-10.38 0-.72-.03-1.47-.03-2.23v-39.5c0-10.93 4.21-20.71 16.82-23.02 2.53-.45 5.09-.37 7.67-.37zm83.78 208.38c-.51-10.17 8.21-18.83 19.53-19.31 11.31-.49 20.94 7.4 21.45 17.57l8.7 160.62c.51 10.18-8.22 18.84-19.53 19.32-11.32.48-20.94-7.4-21.46-17.57l-8.69-160.63zm201.7-1.74c.51-10.17 10.14-18.06 21.45-17.57 11.32.48 20.04 9.14 19.53 19.31l-8.66 160.63c-.52 10.17-10.14 18.05-21.46 17.57-11.31-.48-20.04-9.14-19.53-19.32l8.67-160.62zm-102.94.87c0-10.23 9.23-18.53 20.58-18.53 11.34 0 20.58 8.3 20.58 18.53v160.63c0 10.23-9.24 18.53-20.58 18.53-11.35 0-20.58-8.3-20.58-18.53V245.66z"
            />
          </svg>
          Clear
        </button>
      </aside>
      {/* Main content area */}
      <main className="flex-1 p-6 flex flex-col relative">
        {/* Toggle history panel button */}
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          className="absolute left-4 top-4 p-2 text-gray-400 hover:text-white rounded-lg bg-gray-700"
          aria-label="Toggle history panel"
        >
          <svg
            className={`size-4 transform transition-transform duration-200 ${historyOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
        {/* Header with Settings Button */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-blue-400 text-center">
            Last Action Preview
          </h1>
          <div className="absolute top-3 right-3">
            <SettingsButton onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>

        {/* Text Areas */}
        <div className="flex flex-col gap-10 flex-1">
          {/* Original Text Area */}
          <TextAreaBox
            label="Original Text"
            value={originalText}
            onChange={setOriginalText}
            textCount={promptTokens}
            className="flex-1"
          />

          {/* Fixed Text Area */}
          <TextAreaBox
            label="Result Text"
            value={fixedText}
            onChange={setFixedText}
            textCount={completionTokens}
            className="flex-1"
          />
        </div>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialTab={initialSettingsTab}
          onOverlayClick={() => setIsSettingsOpen(false)}
        />
        <HistoryReviewModal
          isOpen={showHistoryReview}
          data={lastHistoryData}
          onClose={() => setShowHistoryReview(false)}
        />
      </main>
    </div>
  );
};

export default App;
