/**
 * @file HistoryEntryItem.tsx
 * @description One row in the history sidebar list.
 */
import React, { useState } from "react";
import { Button } from "./Button";
import { formatCostLabel } from "./historyCost";
import { formatModelLineage } from "./historyModel";
import { HistorySessionDetailsModal } from "./HistorySessionDetailsModal";
import Tooltip from "./Tooltip";
import { TrashButton } from "./TrashButton";
import { useI18n } from "../i18n/useI18n";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

type HistoryEntryItemProps = {
  entry: HistoryEntry;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry, featureId: HistoryFeatureId) => void;
};

const getFeatureId = (entry: HistoryEntry): HistoryFeatureId =>
  entry.presetName === "PromptGen" ? "promptGen" : "corrections";

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
    />
  </svg>
);

const HistoryEntryItem: React.FC<HistoryEntryItemProps> = ({
  entry,
  onSelect,
  onDelete,
}) => {
  const { t, formatNumber, formatDateTime } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const sessionJson = entry.sessionJson;
  const hasSession = typeof sessionJson === "string" && sessionJson.length > 0;

  return (
    <div className="flex justify-between items-start gap-2">
      <div
        className="flex-1 cursor-pointer"
        onClick={() => onSelect(entry)}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {formatDateTime(entry.timestamp)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded-sm">
              {entry.presetName ?? t("common.unknown")}
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
        <div className="flex items-center gap-1">
          {hasSession ? (
            <Tooltip
              tooltipText={t("history.details.tooltip")}
              width="w-44"
              portal
              className="shrink-0"
              activator={
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={t("history.details.tooltip")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowDetails(true);
                  }}
                >
                  <EyeIcon className="size-3.5" />
                </Button>
              }
            />
          ) : null}
          <p
            className="min-w-0 text-sm text-foreground line-clamp-1"
            title={entry.original}
          >
            {entry.original.slice(0, 50)}...
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-sm text-foreground line-clamp-1"
            title={formatModelLineage(entry.model, entry.resolvedModel)}
          >
            {formatModelLineage(entry.model, entry.resolvedModel)}
          </p>
          <span
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
            title={t("history.cost.tooltip")}
          >
            {formatCostLabel(entry, t, formatNumber)}
          </span>
        </div>
      </div>
      {hasSession && sessionJson ? (
        <HistorySessionDetailsModal
          isOpen={showDetails}
          sessionJson={sessionJson}
          onClose={() => setShowDetails(false)}
        />
      ) : null}
    </div>
  );
};

export default HistoryEntryItem;
