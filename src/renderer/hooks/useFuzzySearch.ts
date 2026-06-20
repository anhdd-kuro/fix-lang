import { format } from "date-fns";
import Fuse from "fuse.js";
import { useMemo } from "react";
import type { HistoryEntry } from "~/stores/historyStore";

// Use a shared config type to avoid duplicating the config
type FuseConfig = {
  keys: (string | { name: string; getFn: (item: HistoryEntry) => string })[];
  threshold?: number;
  includeScore?: boolean;
  shouldSort?: boolean;
  ignoreLocation?: boolean;
  useExtendedSearch?: boolean;
};

// Define the hook for fuzzy searching history entries.
// presetName is now a direct string field on HistoryEntry, so no featureMap lookup is needed.
export function useFuzzySearch(
  history: HistoryEntry[],
  searchQuery: string
): HistoryEntry[] {
  // Default configuration for Fuse.js
  const fuseConfig: FuseConfig = useMemo(() => {
    return {
      keys: [
        "original", // Search in original text
        "corrected", // Search in corrected text
        "model", // Search by model name
        "presetName", // Search by preset name
        {
          name: "timestamp",
          getFn: (entry: HistoryEntry) =>
            format(new Date(entry.timestamp), "MM/dd HH:mm"),
        },
      ],
      includeScore: true,
      threshold: 0.4, // Lower = more strict matching
      shouldSort: true,
      ignoreLocation: true, // Better for searching through large text
      useExtendedSearch: true, // Allow for more advanced search patterns
    };
  }, []);

  // Use useMemo to avoid recreating the filtered list on every render
  const filteredHistory = useMemo(() => {
    // If no search query, return all history
    if (!searchQuery.trim()) {
      return history;
    }

    // Initialize Fuse with our history and configuration
    const fuse = new Fuse<HistoryEntry>(history, fuseConfig);

    // Return the search results
    const result = fuse.search(searchQuery).map((result) => result.item);
    const sortedLastByTimestamp = result.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return sortedLastByTimestamp;
  }, [history, searchQuery, fuseConfig]);

  return filteredHistory;
}

export default useFuzzySearch;
