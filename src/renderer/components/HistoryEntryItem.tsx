import { format } from "date-fns";
import React from "react";
import { TrashButton } from "./TrashButton";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

type HistoryEntryItemProps = {
  entry: HistoryEntry;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry, featureId: HistoryFeatureId) => void;
};

/**
 * Derive the store bucket for delete/remove operations from the entry itself.
 * PromptGen entries live in the promptGen bucket; all others in corrections.
 */
const getFeatureId = (entry: HistoryEntry): HistoryFeatureId =>
  entry.presetName === "PromptGen" ? "promptGen" : "corrections";

const HistoryEntryItem: React.FC<HistoryEntryItemProps> = ({
  entry,
  onSelect,
  onDelete,
}) => {
  return (
    <div className="flex justify-between items-start gap-2">
      <div
        className="flex-1 cursor-pointer"
        onClick={() => onSelect(entry)}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">
            {format(new Date(entry.timestamp), "MM/dd HH:mm")}
          </span>
          <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded-sm ml-auto">
            {entry.presetName ?? "Unknown"}
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
          onDelete(entry, getFeatureId(entry));
        }}
        size="sm"
      />
    </div>
  );
};

export default HistoryEntryItem;
