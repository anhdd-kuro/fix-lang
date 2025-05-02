import React, { useState, useEffect } from "react";
import HistoryReviewModal from "../components/HistoryReviewModal";
import ModelManagerDialog from "../components/ModelManagerDialog";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import { TrashButton } from "../components/TrashButton";
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

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
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
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [showHistoryReview, setShowHistoryReview] = useState<boolean>(false);
  const [showModelManager, setShowModelManager] = useState<boolean>(false);
  const [lastHistoryData, setLastHistoryData] = useState<{
    original: string;
    corrected: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
  }>({
    original: "",
    corrected: "",
    model: "",
    promptTokens: 0,
    completionTokens: 0,
  });
  console.log(`🚀 \n - lastHistoryData:`, lastHistoryData);
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  // Loading state for API call
  const [_loading, _setLoading] = useState<boolean>(false);

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

    // Listen for model manager open requests triggered via IPC
    const openModelManagerHandler = () => {
      setShowModelManager(true);
      return { success: true };
    };

    // Register a listener for openModelManager calls
    const modelManagerEventName = "openModelManager";
    window.addEventListener(modelManagerEventName, openModelManagerHandler);

    return () => {
      removeHistoryListener?.();
      window.removeEventListener(
        modelManagerEventName,
        openModelManagerHandler
      );
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

    return () => {
      offOpenSettings?.();
      offModel?.();
      offKey?.();
      offPrompt?.();
      offHistory?.();
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
        <ul className="divide-y divide-gray-700 overflow-y-auto mb-4 flex-1">
          {history.map((entry, idx) => (
            <li
              key={idx}
              className="py-2 hover:bg-gray-700 px-2 relative group/history-entry"
            >
              <div className="flex justify-between items-start gap-2">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => {
                    setLastHistoryData({
                      original: entry.original,
                      corrected: entry.corrected,
                      model: entry.model,
                      promptTokens: entry.promptTokens,
                      completionTokens: entry.completionTokens,
                    });
                  }}
                >
                  <div className="text-sm text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                  <p
                    className="text-sm text-gray-100 line-clamp-1"
                    title={entry.original}
                  >
                    {entry.original.slice(0, 50)}...
                  </p>
                  <p
                    className="text-sm text-gray-100 line-clamp-1"
                    title={entry.model}
                  >
                    {entry.model}
                  </p>
                </div>
                <TrashButton
                  className="invisible absolute right-2 top-2 group-hover/history-entry:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Find next entry to select
                    const nextEntry = history[idx + 1] || history[idx - 1];
                    if (nextEntry) {
                      setLastHistoryData({
                        original: nextEntry.original,
                        corrected: nextEntry.corrected,
                        model: nextEntry.model,
                        promptTokens: nextEntry.promptTokens ?? 0,
                        completionTokens: nextEntry.completionTokens ?? 0,
                      });
                    } else {
                      // If no other entries, clear the text areas
                      setLastHistoryData({
                        original: "",
                        corrected: "",
                        model: "",
                        promptTokens: 0,
                        completionTokens: 0,
                      });
                    }
                    window.electronAPI.removeHistoryEntry(historyType, entry);
                  }}
                  size="sm"
                />
              </div>
            </li>
          ))}
        </ul>
        <TrashButton
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
          className="ml-auto mt-auto"
          showLabel
          size="md"
        />
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
            value={lastHistoryData.original}
            onChange={(value) =>
              setLastHistoryData({ ...lastHistoryData, original: value })
            }
            textCount={lastHistoryData.promptTokens}
            model={lastHistoryData.model}
            className="flex-1"
          />

          {/* Fixed Text Area */}
          <TextAreaBox
            label="Result Text"
            value={lastHistoryData.corrected}
            onChange={(value) =>
              setLastHistoryData({ ...lastHistoryData, corrected: value })
            }
            textCount={lastHistoryData.completionTokens}
            className="flex-1"
          />
        </div>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialTab={initialSettingsTab}
        />
        <HistoryReviewModal
          isOpen={showHistoryReview}
          data={lastHistoryData}
          onClose={() => setShowHistoryReview(false)}
        />
        <ModelManagerDialog
          isOpen={showModelManager}
          onClose={() => setShowModelManager(false)}
        />
      </main>
    </div>
  );
};

export default App;
