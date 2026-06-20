import { format } from "date-fns";
import React from "react";
import { TrashButton } from "./TrashButton";
import type { HistoryEntry, HistoryStoreType } from "~/stores/historyStore";

// Define UI-specific history type for frontend use
type UiHistoryType = "corrections" | "translations" | "summarize" | "promptGen";

type HistoryEntryItemProps = {
  entry: HistoryEntry;
  featureMap: {
    id: HistoryStoreType;
    uiKey: UiHistoryType;
    label: string;
  }[];
  activeHistoryType: UiHistoryType;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry, featureType: string) => void;
};

const HistoryEntryItem: React.FC<HistoryEntryItemProps> = ({
  entry,
  featureMap,
  activeHistoryType,
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
          <span className="text-label-secondary">
            {format(new Date(entry.timestamp), "MM/dd HH:mm")}
          </span>
          <span className="px-1.5 py-0.5 bg-accent text-label-primary rounded-sm ml-auto text-[0.692rem]">
            {
              featureMap.find(
                (feature) =>
                  feature.uiKey === (entry.featureType || activeHistoryType)
              )?.label || "Unknown"
            }
          </span>
        </div>
        <p
          className="text-[0.846rem] text-label-primary line-clamp-1"
          title={entry.original}
        >
          {entry.original.slice(0, 50)}...
        </p>
        <p
          className="text-[0.846rem] text-label-secondary line-clamp-1"
          title={entry.model}
        >
          {entry.model}
        </p>
      </div>
      <TrashButton
        className="invisible absolute right-2 bottom-2 group-hover/history-entry:visible"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(entry, entry.featureType || activeHistoryType);
        }}
        size="sm"
      />
    </div>
  );
};

export default HistoryEntryItem;
