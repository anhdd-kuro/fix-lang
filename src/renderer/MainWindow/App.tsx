import React, { useState, useEffect, useCallback } from "react";
import {
  DASHBOARD_TABS,
  DEFAULT_DASHBOARD_TAB_INDEX,
  bucketsForClear,
} from "./dashboardTabs";
import { formatModelLineage } from "../components/historyModel";
import { HistoryPanel } from "../components/HistoryPanel";
import HistoryReviewModal from "../components/HistoryReviewModal";
import ModelManagerDialog from "../components/ModelManagerDialog";
import { OverviewPanel } from "../components/OverviewPanel";
import { PlaceholderPanel } from "../components/PlaceholderPanel";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
const App: React.FC = () => {
  // History state — flat list combining corrections + promptGen buckets
  const [history, setHistory] = useState<HistoryEntry[]>([]);

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
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  // Active dashboard tab — defaults to History so existing users see no change.
  const [activeDashboardTab, setActiveDashboardTab] = useState<number>(
    DEFAULT_DASHBOARD_TAB_INDEX
  );

  // Single stable reference shared by both useEffects and the clear handler.
  // Fetches both store buckets, merges, and sorts into the history state.
  const fetchAllHistories = useCallback(async (): Promise<void> => {
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
  }, []);

  useEffect(() => {
    // Wrap in a local void callback so the linter sees setState called from
    // a callback rather than synchronously at effect top-level.
    void (async () => {
      await fetchAllHistories();
    })();

    const removeHistoryListener = window.electronAPI.onHistoryUpdate?.(
      (payload) => {
        console.log("onHistoryUpdate", payload);
        // Refresh all histories when any history is updated
        void fetchAllHistories();
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
  }, [fetchAllHistories]);

  useEffect(() => {
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
  }, [fetchAllHistories]);

  // Select a history entry → update the Last Action Preview.
  const handleSelectEntry = (entry: HistoryEntry): void => {
    setLastHistoryData({ ...entry, timestamp: new Date().toISOString() });
  };

  // Delete a history entry → preview the next entry (or clear) then remove via IPC.
  const handleDeleteEntry = (
    entry: HistoryEntry,
    featureId: HistoryFeatureId,
    nextEntry: HistoryEntry | null
  ): void => {
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
    window.electronAPI.removeHistoryEntry(featureId, entry);
  };

  // Clear the buckets implied by the active filter, then re-fetch so the UI
  // mirrors store state. Bucket selection logic lives in bucketsForClear.
  const handleClear = (activeFilter: string | null): void => {
    const buckets: HistoryFeatureId[] = bucketsForClear(activeFilter);
    Promise.all(
      buckets.map((featureId) => window.electronAPI.clearHistory(featureId))
    )
      .then(() => fetchAllHistories())
      .catch((err: Error) => console.error(`Failed to clear history`, err));
  };

  // Corrections-bucket subset for the Overview tab (#57 aggregates corrections
  // only; PromptGen lives in its own bucket and is excluded from Overview).
  const correctionsHistory = history.filter(
    (e) => e.presetName !== "PromptGen"
  );

  // Tab panel contents. History hosts the extracted panel; Overview reads from
  // the already-fetched history state (no network/IPC on tab switch). Models /
  // OpenRouter remain inert placeholders until #58/#59 wire their data.
  const tabPanels: Record<string, React.ReactNode> = {
    overview: <OverviewPanel history={correctionsHistory} />,
    history: (
      <HistoryPanel
        history={history}
        onSelectEntry={handleSelectEntry}
        onDeleteEntry={handleDeleteEntry}
        onClear={handleClear}
      />
    ),
    models: (
      <PlaceholderPanel
        title="Models"
        description="Per-model usage breakdown will appear here."
      />
    ),
    openrouter: (
      <PlaceholderPanel
        title="OpenRouter"
        description="OpenRouter credits and activity will appear here."
      />
    ),
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex">
      {/* Sidebar dashboard panel (tabs select the left-panel content) */}
      <aside
        className={`relative z-10 flex flex-col bg-gray-800 border-r border-gray-700 h-screen transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        {/* Dashboard tab navigation — mirrors SettingsModal's ARIA tab pattern */}
        <div
          className="mb-3 grid grid-cols-2 gap-1 rounded-lg"
          role="tablist"
          aria-label="Dashboard tabs"
        >
          {DASHBOARD_TABS.map((tab, index) => {
            const isActive = activeDashboardTab === index;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`dashboard-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`dashboard-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveDashboardTab(index)}
                type="button"
                className={`transition-all duration-200 rounded-md font-medium text-xs py-1 ${isActive ? "bg-blue-600 text-white shadow-md" : "text-gray-300 hover:bg-gray-600 hover:text-gray-100 bg-gray-700"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab panels — only the active panel is rendered */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {DASHBOARD_TABS.map(
            (tab, index) =>
              activeDashboardTab === index && (
                <div
                  key={tab.id}
                  id={`dashboard-panel-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`dashboard-tab-${tab.id}`}
                  tabIndex={0}
                  className="flex flex-1 flex-col overflow-hidden"
                >
                  {tabPanels[tab.id]}
                </div>
              )
          )}
        </div>
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
            model={formatModelLineage(
              lastHistoryData.model,
              lastHistoryData.resolvedModel,
            )}
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
