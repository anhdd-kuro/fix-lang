import { addDays, format } from "date-fns";
import React, { useState, useEffect, useDeferredValue } from "react";
import HistoryEntryItem from "../components/HistoryEntryItem";
import HistoryReviewModal from "../components/HistoryReviewModal";
import ModelManagerDialog from "../components/ModelManagerDialog";
import SearchInput from "../components/SearchInput";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import { TrashButton } from "../components/TrashButton";
import useFuzzySearch from "../hooks/useFuzzySearch";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

/**
 * Derive unique preset names from loaded history entries (corrections bucket),
 * preserving first-seen order. PromptGen is appended last as a fixed entry.
 */
const deriveAvailableFilters = (entries: HistoryEntry[]): string[] => {
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.presetName && e.presetName !== "PromptGen") {
      seen.add(e.presetName);
    }
  }
  return [...seen, "PromptGen"];
};

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
const App: React.FC = () => {
  // History state — flat list combining corrections + promptGen buckets
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Search state for fuzzy search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const _deferredSearchQuery = useDeferredValue(searchQuery);

  // Active preset name filter — null means "show all"
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

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
    // Fetch corrections + promptGen buckets and combine into a single sorted list
    const fetchAllHistories = async () => {
      const [corrections, promptGen] = await Promise.all([
        window.electronAPI.getHistory("corrections"),
        window.electronAPI.getHistory("promptGen"),
      ]);

      const combined: HistoryEntry[] = [...corrections, ...promptGen];

      // Sort by timestamp (newest first)
      combined.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setHistory(combined);
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
    const fetchAllHistories = async () => {
      const [corrections, promptGen] = await Promise.all([
        window.electronAPI.getHistory("corrections"),
        window.electronAPI.getHistory("promptGen"),
      ]);
      const combined: HistoryEntry[] = [...corrections, ...promptGen];
      combined.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setHistory(combined);
    };

    const handleSettings = (type?: number) => {
      setInitialSettingsTab(type || 0);
      setIsSettingsOpen(true);
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

  // Derive available filter tabs dynamically from loaded history
  const availableFilters = deriveAvailableFilters(history);

  // Apply preset-name filter first, then fuzzy search on top
  const preFilteredHistory =
    activeFilter === null
      ? history
      : history.filter((e) => e.presetName === activeFilter);

  const filteredHistory = useFuzzySearch(preFilteredHistory, searchQuery);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex">
      {/* Sidebar history panel */}
      <aside
        className={`relative z-10 flex flex-col bg-gray-800 border-r border-gray-700 h-screen transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        <div className="flex justify-between items-center mb-4 sticky top-0 bg-gray-800 z-10">
          <div className="w-full">
            <SearchInput
              onSearch={setSearchQuery}
              placeholder="Search history..."
              className="w-full"
              debounceMs={300}
              suggestions={[
                ...availableFilters,
                // Today and yesterday
                format(new Date(), "MM/dd"),
                format(addDays(new Date(), -1), "MM/dd"),
              ]}
              dataListId="history-search-suggestions"
            />
          </div>
        </div>

        {/* Dynamic filter tabs — built from preset names present in data */}
        {availableFilters.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              className={`px-2 py-0.5 text-xs rounded-sm ${activeFilter === null ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
            >
              All
            </button>
            {availableFilters.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setActiveFilter(activeFilter === name ? null : name)
                }
                className={`px-2 py-0.5 text-xs rounded-sm ${activeFilter === name ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <ul className="divide-y divide-gray-700 overflow-y-auto mb-4 flex-1">
          {/* Use our custom fuzzy search hook to filter history entries */}
          {filteredHistory.map((entry: HistoryEntry, idx: number) => (
            <li
              key={idx}
              className="py-2 hover:bg-gray-700 px-2 relative group/history-entry"
            >
              <HistoryEntryItem
                entry={entry}
                onSelect={(selectedEntry) => {
                  setLastHistoryData({
                    ...selectedEntry,
                    timestamp: new Date().toISOString(),
                  });
                }}
                onDelete={(entryToDelete, featureId) => {
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
                  window.electronAPI.removeHistoryEntry(featureId, entryToDelete);
                }}
              />
            </li>
          ))}
        </ul>
        <TrashButton
          onClick={() => {
            // Clear the active filter's bucket, or corrections when showing all
            const featureId: HistoryFeatureId =
              activeFilter === "PromptGen" ? "promptGen" : "corrections";
            window.electronAPI
              .clearHistory(featureId)
              .then(() => {
                // Remove cleared entries from local state
                if (activeFilter === null) {
                  setHistory([]);
                } else {
                  setHistory((prev) =>
                    prev.filter((e) => e.presetName !== activeFilter)
                  );
                }
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
        {/* Header with Profile Selector and Settings Button */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-blue-400 text-center">
            Last Action Preview
          </h1>
          <div className="absolute top-3 right-3 flex items-center gap-3">
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
