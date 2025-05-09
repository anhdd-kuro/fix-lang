import { format } from "date-fns";
import React, { useState, useEffect } from "react";
import Select from "react-select";
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

  // History type selector state (now supporting multiple selections)
  const [historyTypes, setHistoryTypes] = useState<UiHistoryType[]>(
    HISTORY_FEATURES.map((f) => f.uiKey)
  );
  const [activeHistoryType, setActiveHistoryType] =
    useState<UiHistoryType>("corrections");

  // Options for history selector - using our local configuration
  const historyOptions: { value: UiHistoryType; label: string }[] =
    HISTORY_FEATURES.map((feature) => {
      return { value: feature.uiKey, label: feature.label.split(" ")[0] };
    });

  const [initialSettingsTab, setInitialSettingsTab] = useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [showHistoryReview, setShowHistoryReview] = useState<boolean>(false);
  const [showModelManager, setShowModelManager] = useState<boolean>(false);
  const [lastHistoryData, setLastHistoryData] = useState<HistoryEntry>({
    original: "",
    corrected: "",
    model: "",
    promptTokens: 0,
    completionTokens: 0,
    timestamp: new Date().toISOString(),
  });
  console.log(`🚀 \n - lastHistoryData:`, lastHistoryData);
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  // Loading state for API call
  const [_loading, _setLoading] = useState<boolean>(false);

  useEffect(() => {
    // Modified to handle multiple history types
    const fetchAllHistories = async () => {
      const allHistories: HistoryEntry[] = [];

      for (const type of historyTypes) {
        const typeHistory = await window.electronAPI.getHistory(type);

        // Add feature identifier to each entry
        const historyWithFeature = typeHistory.map((entry) => ({
          ...entry,
          featureType: type, // Add feature type for display
        }));
        allHistories.push(...historyWithFeature);
      }

      // Sort by timestamp (newest first)
      allHistories.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setHistory(allHistories);
    };

    fetchAllHistories();

    const removeHistoryListener = window.electronAPI.onHistoryUpdate?.(
      (payload) => {
        console.log("onHistoryUpdate", payload);
        // Refresh all histories when any history is updated
        fetchAllHistories();
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
  }, [historyTypes]);

  useEffect(() => {
    // Not using handleCopy inside the effect, moved it outside
    const _handleCopy = (_text: string) => {
      // Function moved outside effect
    };

    const handleSettings = (type?: number) => {
      setInitialSettingsTab(type || 0);
      setIsSettingsOpen(true);

      // Refresh histories after settings change
      const fetchAllHistories = async () => {
        const allHistories: HistoryEntry[] = [];

        for (const type of historyTypes) {
          const typeHistory = await window.electronAPI.getHistory(type);
          const historyWithFeature = typeHistory.map((entry) => ({
            ...entry,
            featureType: type,
          }));
          allHistories.push(...historyWithFeature);
        }

        allHistories.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        setHistory(allHistories);
      };

      fetchAllHistories();
    };

    const offOpenSettings = window.electronAPI.onOpenSettings?.(() => {
      handleSettings();
    });
    const offKey = window.electronAPI.onOpenKeybindingsDialog?.(() => {
      handleSettings(1);
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
      offKey?.();
      offPrompt?.();
      offHistory?.();
    };
  }, [historyTypes]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex">
      {/* Sidebar history panel */}
      <aside
        className={`relative z-10 flex flex-col bg-gray-800 border-r border-gray-700 h-screen transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        <div className="flex justify-between items-center mb-4 sticky top-0 bg-gray-800 z-10">
          <div className="w-full">
            <Select
              id="history-selector"
              isMulti
              value={historyOptions.filter((opt) =>
                historyTypes.includes(opt.value)
              )}
              onChange={(newValue) => {
                const selectedTypes = (newValue as typeof historyOptions).map(
                  (v) => v.value
                );
                setHistoryTypes(
                  selectedTypes.length ? selectedTypes : ["corrections"]
                );
                if (
                  selectedTypes.length &&
                  !selectedTypes.includes(activeHistoryType)
                ) {
                  setActiveHistoryType(selectedTypes[0]);
                }
              }}
              options={historyOptions}
              aria-label="Select history type"
              className="w-full text-xs"
              classNamePrefix="react-select"
              theme={(theme) => ({
                ...theme,
                colors: {
                  ...theme.colors,
                  primary: "#2563eb",
                  primary75: "#3b82f6",
                  primary50: "#60a5fa",
                  primary25: "#93c5fd",
                  neutral0: "#1f2937",
                  neutral5: "#374151",
                  neutral10: "#4b5563",
                  neutral20: "#6b7280",
                  neutral30: "#9ca3af",
                  neutral40: "#d1d5db",
                  neutral50: "#e5e7eb",
                  neutral60: "#f3f4f6",
                  neutral70: "#f9fafb",
                  neutral80: "#ffffff",
                  neutral90: "#ffffff",
                },
              })}
              styles={{
                control: (base) => ({
                  ...base,
                  backgroundColor: "#1f2937",
                  borderColor: "#4b5563",
                }),
                menu: (base) => ({
                  ...base,
                  backgroundColor: "#3A475A",
                }),
                option: (base, state) => ({
                  ...base,
                  backgroundColor: state.isFocused ? "#2563eb" : "#3A475A",
                  color: "#ffffff",
                }),
                singleValue: (base) => ({
                  ...base,
                  color: "#ffffff",
                }),
              }}
            />
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
                      ...history[0],
                      timestamp: new Date().toISOString(),
                    });
                  }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">
                      {format(new Date(entry.timestamp), "MM/dd HH:mm")}
                    </span>
                    <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded-sm ml-auto">
                      {
                        historyOptions.find(
                          (opt) =>
                            opt.value ===
                            (entry.featureType || activeHistoryType)
                        )?.label
                      }
                    </span>
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
                  className="invisible absolute right-2 bottom-2 group-hover/history-entry:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Find next entry to select
                    const nextEntry = history[idx + 1] || history[idx - 1];
                    if (nextEntry) {
                      setLastHistoryData({
                        ...nextEntry,
                        timestamp: new Date().toISOString(),
                      });
                    } else {
                      // If no other entries, clear the text areas
                      setLastHistoryData({
                        original: "",
                        corrected: "",
                        model: "",
                        promptTokens: 0,
                        completionTokens: 0,
                        timestamp: new Date().toISOString(),
                      });
                    }
                    window.electronAPI.removeHistoryEntry(
                      entry.featureType || activeHistoryType,
                      entry
                    );
                  }}
                  size="sm"
                />
              </div>
            </li>
          ))}
        </ul>
        <TrashButton
          onClick={() => {
            const featureId = mapHistoryType(activeHistoryType);
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
              setLastHistoryData({
                ...lastHistoryData,
                original: value,
                timestamp: new Date().toISOString(),
              })
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
              setLastHistoryData({
                ...lastHistoryData,
                corrected: value,
                timestamp: new Date().toISOString(),
              })
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
