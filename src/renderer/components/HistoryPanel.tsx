/**
 * @file HistoryPanel.tsx
 * @description The history sidebar panel, extracted verbatim from App.tsx (#54)
 * so it can be hosted inside the "History" dashboard tab with zero regression.
 *
 * Self-contained: owns its local search + active-filter state and derives the
 * filtered list (preset filter then fuzzy search) internally. App stays the
 * data owner (fetches history, owns lastHistoryData + modals) and passes the
 * raw `history` plus narrow callbacks down. No network/IPC is performed here
 * beyond the delete/clear callbacks the parent supplies.
 */
import { addDays, format } from "date-fns";
import { useState } from "react";
import HistoryEntryItem from "./HistoryEntryItem";
import SearchInput from "./SearchInput";
import { TrashButton } from "./TrashButton";
import useFuzzySearch from "../hooks/useFuzzySearch";
import {
  applyPresetFilter,
  deriveAvailableFilters,
  toggleFilter,
} from "../MainWindow/dashboardTabs";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

type HistoryPanelProps = {
  /** Full, already-sorted history list (corrections + promptGen). */
  history: HistoryEntry[];
  /** Select an entry → parent updates the Last Action Preview. */
  onSelectEntry: (entry: HistoryEntry) => void;
  /**
   * Delete an entry. `nextEntry` is the entry the parent should preview after
   * deletion (or null to clear the preview). The parent performs the IPC
   * removal so this panel stays presentation + local-filter only.
   */
  onDeleteEntry: (
    entry: HistoryEntry,
    featureId: HistoryFeatureId,
    nextEntry: HistoryEntry | null
  ) => void;
  /** Clear the buckets implied by the current active filter. */
  onClear: (activeFilter: string | null) => void;
};

export const HistoryPanel = ({
  history,
  onSelectEntry,
  onDeleteEntry,
  onClear,
}: HistoryPanelProps) => {
  // Search state for fuzzy search
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Active preset name filter — null means "show all"
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Derive available filter tabs dynamically from loaded history
  const availableFilters = deriveAvailableFilters(history);

  // Apply preset-name filter first, then fuzzy search on top
  const preFilteredHistory = applyPresetFilter(history, activeFilter);
  const filteredHistory = useFuzzySearch(preFilteredHistory, searchQuery);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
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
        <div className="mb-3 flex flex-wrap gap-1">
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
              onClick={() => setActiveFilter(toggleFilter(activeFilter, name))}
              className={`px-2 py-0.5 text-xs rounded-sm ${activeFilter === name ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <ul className="mb-4 flex-1 divide-y divide-gray-700 overflow-y-auto">
        {/* Use our custom fuzzy search hook to filter history entries */}
        {filteredHistory.map((entry: HistoryEntry, idx: number) => (
          <li
            key={idx}
            className="py-2 hover:bg-gray-700 px-2 relative group/history-entry"
          >
            <HistoryEntryItem
              entry={entry}
              onSelect={(selectedEntry) => onSelectEntry(selectedEntry)}
              onDelete={(entryToDelete, featureId) => {
                // Find next entry to select (preserves prior App.tsx behavior).
                const nextEntry = history[idx + 1] || history[idx - 1] || null;
                onDeleteEntry(entryToDelete, featureId, nextEntry);
              }}
            />
          </li>
        ))}
      </ul>
      <TrashButton
        onClick={() => onClear(activeFilter)}
        className="ml-auto mt-auto"
        showLabel
        size="md"
      />
    </div>
  );
};
