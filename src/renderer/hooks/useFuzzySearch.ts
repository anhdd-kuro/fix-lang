import { format } from "date-fns";
import Fuse from "fuse.js";
import { useMemo } from "react";
import type { HistoryEntry } from "~/stores/historyStore";

// Define UI-specific history type for frontend use
type UiHistoryType = "corrections" | "translations" | "summarize" | "promptGen";

// Use a shared config type to avoid duplicating the config
type FuseConfig = {
  keys: (string | { name: string; getFn: (item: HistoryEntry) => string })[];
  threshold?: number;
  includeScore?: boolean;
  shouldSort?: boolean;
  ignoreLocation?: boolean;
  useExtendedSearch?: boolean;
};

// Define the hook for fuzzy searching history entries
export function useFuzzySearch(
  history: HistoryEntry[],
  searchQuery: string,
  featureMap: {
    id: string;
    uiKey: UiHistoryType;
    label: string;
  }[]
): HistoryEntry[] {
  // Default configuration for Fuse.js
  const fuseConfig: FuseConfig = useMemo(() => {
    return {
      keys: [
        "original", // Search in original text
        "corrected", // Search in corrected text
        "model", // Search by model name
        {
          name: "timestamp",
          getFn: (entry: HistoryEntry) =>
            format(new Date(entry.timestamp), "MM/dd HH:mm"),
        },
        {
          name: "featureType",
          getFn: (entry: HistoryEntry) => {
            // Search by feature name (not just ID)
            const feature = featureMap.find(
              (f) => f.uiKey === entry.featureType
            );
            return feature?.label || String(entry.featureType || "");
          },
        },
      ],
      includeScore: true,
      threshold: 0.4, // Lower = more strict matching
      shouldSort: true,
      ignoreLocation: true, // Better for searching through large text
      useExtendedSearch: true, // Allow for more advanced search patterns
    };
  }, [featureMap]);

  // Use useMemo to avoid recreating the filtered list on every render
  const filteredHistory = useMemo(() => {
    // If no search query, return all history
    if (!searchQuery.trim()) {
      return history;
    }

    // Initialize Fuse with our history and configuration
    const fuse = new Fuse<HistoryEntry>(history, fuseConfig);

    // Return the search results
    return fuse.search(searchQuery).map((result) => result.item);
  }, [history, searchQuery, fuseConfig]);

  return filteredHistory;
}

export default useFuzzySearch;
