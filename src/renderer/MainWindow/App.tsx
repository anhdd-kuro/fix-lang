import React, { useState, useEffect, useCallback } from "react";
import { twJoin } from "tailwind-merge";
import {
  clampTabIndex,
  DASHBOARD_TABS,
  DEFAULT_DASHBOARD_TAB_INDEX,
  bucketsForClear,
} from "./dashboardTabs";
import { formatModelLineage } from "../components/historyModel";
import { HistoryPanel } from "../components/HistoryPanel";
import HistoryReviewModal from "../components/HistoryReviewModal";
import ModelManagerDialog from "../components/ModelManagerDialog";
import { ModelsPanel } from "../components/ModelsPanel";
import { OpenRouterPanel } from "../components/OpenRouterPanel";
import { OverviewPanel } from "../components/OverviewPanel";
import { SettingsButton } from "../components/SettingsIcon";
import { SettingsModal } from "../components/SettingsModal";
import { TextAreaBox } from "../components/TextAreaBox";
import type { DashboardTabId } from "./dashboardTabs";
import type { AnalyticsRange } from "../analytics/shared";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

/** Range options for the analytics tabs (shared header pill group). */
const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "all", label: "All" },
  { id: "30d", label: "30d" },
  { id: "7d", label: "7d" },
];

/** Tabs that read the shared time-range pills. */
const RANGE_AWARE_TABS = new Set(["overview", "models"]);

/**
 * Main App component for FixLang Preview UI.
 *
 * Full-screen dashboard: a top header hosts the tab navigation (left) plus the
 * time-range pills + settings button (right); clicking a tab swaps the whole
 * content area. The History tab hosts the history list alongside the Last
 * Action Preview text areas (the original main view).
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
  // Active dashboard tab + shared analytics time range.
  const [activeDashboardTab, setActiveDashboardTab] = useState<number>(
    DEFAULT_DASHBOARD_TAB_INDEX
  );
  const [range, setRange] = useState<AnalyticsRange>("all");

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
    const offDashboardTab = window.electronAPI.onOpenDashboardTab?.(
      (tabId: DashboardTabId) => {
        const index = DASHBOARD_TABS.findIndex((tab) => tab.id === tabId);
        if (index >= 0) {
          setActiveDashboardTab(clampTabIndex(index));
        }
      }
    );

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
      offDashboardTab?.();
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

  // Corrections-bucket subset for the analytics tabs (aggregate corrections
  // only; PromptGen lives in its own bucket and is excluded).
  const correctionsHistory = history.filter(
    (e) => e.presetName !== "PromptGen"
  );

  // History tab body: the history list beside the Last Action Preview.
  const historyTab = (
    <div className="flex h-full gap-4">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 p-3">
        <HistoryPanel
          history={history}
          onSelectEntry={handleSelectEntry}
          onDeleteEntry={handleDeleteEntry}
          onClear={handleClear}
        />
      </aside>
      <section className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <h2 className="text-center text-2xl font-bold text-blue-400">
          Last Action Preview
        </h2>
        <div className="flex flex-1 flex-col gap-8">
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
              lastHistoryData.resolvedModel
            )}
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
      </section>
    </div>
  );

  // Tab panel contents. Analytics tabs read the shared range; History hosts the
  // list + preview; OpenRouter keeps its own data hook.
  const tabPanels: Record<string, React.ReactNode> = {
    overview: <OverviewPanel history={correctionsHistory} range={range} />,
    history: historyTab,
    models: <ModelsPanel history={correctionsHistory} range={range} />,
    openrouter: (
      <OpenRouterPanel onOpenSettings={() => setIsSettingsOpen(true)} />
    ),
  };

  const activeTabId = DASHBOARD_TABS[activeDashboardTab]?.id ?? "overview";
  const showRange = RANGE_AWARE_TABS.has(activeTabId);

  return (
    <div className="flex h-screen flex-col bg-gray-900 font-sans text-gray-100">
      {/* Shared header: tabs (left) + range pills & settings (right). */}
      <header className="flex items-center justify-between gap-4 border-b border-gray-700 bg-gray-800 px-4 py-2">
        <nav
          className="flex gap-1"
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
                className={twJoin(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white shadow"
                    : "text-gray-400 hover:bg-gray-700 hover:text-gray-100"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {showRange && (
            <div
              className="flex gap-1 rounded-lg bg-gray-900/60 p-0.5"
              role="group"
              aria-label="Time range"
            >
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  aria-pressed={range === r.id}
                  className={twJoin(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    range === r.id
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-100"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <SettingsButton onClick={() => setIsSettingsOpen(true)} />
        </div>
      </header>

      {/* Content area — only the active tab's panel is rendered. */}
      <main className="flex-1 overflow-y-auto p-6">
        <div
          id={`dashboard-panel-${activeTabId}`}
          role="tabpanel"
          aria-labelledby={`dashboard-tab-${activeTabId}`}
          tabIndex={0}
          className="h-full"
        >
          {tabPanels[activeTabId]}
        </div>
      </main>

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
    </div>
  );
};

export default App;
