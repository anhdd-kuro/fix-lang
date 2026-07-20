import { format } from "date-fns";
import React from "react";
import { formatCost } from "./historyCost";
import { formatModelLineage } from "./historyModel";
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
          <span className="text-muted-foreground">
            {format(new Date(entry.timestamp), "MM/dd HH:mm")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded-sm">
              {entry.presetName ?? "Unknown"}
            </span>
            <TrashButton
              onClick={(e) => {
                e.stopPropagation();
                onDelete(entry, getFeatureId(entry));
              }}
              size="sm"
            />
          </div>
        </div>
        <p
          className="text-sm text-foreground line-clamp-1"
          title={entry.original}
        >
          {entry.original.slice(0, 50)}...
        </p>
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-sm text-foreground line-clamp-1"
            title={formatModelLineage(entry.model, entry.resolvedModel)}
          >
            {formatModelLineage(entry.model, entry.resolvedModel)}
          </p>
          <span
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
            title="Estimated cost at time of correction"
          >
            {formatCost(entry)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HistoryEntryItem;
