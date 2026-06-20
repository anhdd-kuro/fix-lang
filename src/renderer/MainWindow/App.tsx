import { addDays, format } from "date-fns";
import React, { useState, useEffect, useDeferredValue } from "react";
import HistoryEntryItem from "../components/HistoryEntryItem";
import HistoryReviewModal from "../components/HistoryReviewModal";
import { ListRow } from "../components/ListRow";
import ModelManagerDialog from "../components/ModelManagerDialog";
import SearchInput from "../components/SearchInput";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import { TrashButton } from "../components/TrashButton";
import useFuzzySearch from "../hooks/useFuzzySearch";
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

  // Search state for fuzzy search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const _deferredSearchQuery = useDeferredValue(searchQuery);

  // We're now showing all history and filtering with search, so we only need
  // activeHistoryType for the clear history function
  const [activeHistoryType] = useState<UiHistoryType>("corrections");

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
    // Fetch all histories from all features
    const fetchAllHistories = async () => {
      const allHistories: HistoryEntry[] = [];

      // Get history for all features
      for (const feature of HISTORY_FEATURES) {
        const typeHistory = await window.electronAPI.getHistory(feature.uiKey);

        // Add feature identifier to each entry
        const historyWithFeature = typeHistory.map((entry) => ({
          ...entry,
          featureType: feature.uiKey, // Add feature type for display
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
  }, []);

  useEffect(() => {
    const handleSettings = (type?: number) => {
      setInitialSettingsTab(type || 0);
      setIsSettingsOpen(true);

      // Refresh histories after settings change
      const fetchAllHistories = async () => {
        const allHistories: HistoryEntry[] = [];

        // Get history for all features
        for (const feature of HISTORY_FEATURES) {
          const typeHistory = await window.electronAPI.getHistory(
            feature.uiKey
          );
          const historyWithFeature = typeHistory.map((entry) => ({
            ...entry,
            featureType: feature.uiKey,
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
  }, []);

  const filteredHistory = useFuzzySearch(
    history,
    searchQuery,
    HISTORY_FEATURES
  );

  return (
    <div className="min-h-screen bg-window text-label-primary font-sans flex">
      {/* Sidebar history panel */}
      <aside
        className={`relative z-10 flex flex-col bg-control border-r border-separator h-screen transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        <div className="flex justify-between items-center mb-4 sticky top-0 bg-control z-10">
          <div className="w-full">
            <SearchInput
              onSearch={setSearchQuery}
              placeholder="Search history..."
              className="w-full"
              debounceMs={300}
              suggestions={[
                ...HISTORY_FEATURES.map((feature) => feature.label),
                // Today and yesterday
                format(new Date(), "MM/dd"),
                format(addDays(new Date(), -1), "MM/dd"),
              ]}
              dataListId="history-search-suggestions"
            />
          </div>
        </div>
        <ul className="overflow-y-auto mb-4 flex-1">
          {filteredHistory.map((entry: HistoryEntry, idx: number) => (
            <ListRow
              key={idx}
              as="li"
              onClick={() =>
                setLastHistoryData({
                  ...entry,
                  timestamp: new Date().toISOString(),
                })
              }
              className="relative group/history-entry py-2"
            >
              <HistoryEntryItem
                entry={entry}
                featureMap={HISTORY_FEATURES}
                activeHistoryType={activeHistoryType}
                onSelect={(selectedEntry) => {
                  setLastHistoryData({
                    ...selectedEntry,
                    timestamp: new Date().toISOString(),
                  });
                }}
                onDelete={(entryToDelete, featureType) => {
                  const nextEntry = history[idx + 1] || history[idx - 1];
                  if (nextEntry) {
                    setLastHistoryData({
                      ...nextEntry,
                      timestamp: new Date().toISOString(),
                    });
                  } else {
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
                    mapHistoryType(featureType as UiHistoryType),
                    entryToDelete
                  );
                }}
              />
            </ListRow>
          ))}
        </ul>
        <TrashButton
          onClick={() => {
            const featureId = mapHistoryType(
              activeHistoryType || "corrections"
            );
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
          className="absolute left-4 top-4 p-2 text-label-secondary hover:text-label-primary rounded-[6px] bg-control hover:bg-control-hover transition-colors"
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
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-label-primary text-center">
            Last Action Preview
          </h1>
          <div className="absolute top-3 right-3 flex items-center gap-3">
            <SettingsButton onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>

        {/* Text Areas */}
        <div className="flex flex-col gap-10 flex-1">
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
