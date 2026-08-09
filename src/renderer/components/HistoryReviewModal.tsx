import React from "react";
import { Button } from "./Button";
import CopyButton from "./CopyButton";
import { formatCostLabel } from "./historyCost";
import { useI18n } from "../i18n/useI18n";
import type { HistoryEntry } from "~/features/history/store/historyStore";

type HistoryReviewModalProps = {
  isOpen: boolean;
  data: {
    original: string;
    corrected: string;
    modelId?: string;
  } & Pick<HistoryEntry, "costStatus" | "estimatedCostUsd">;
  onClose: () => void;
};

const HistoryReviewModal: React.FC<HistoryReviewModalProps> = ({
  isOpen,
  data,
  onClose,
}) => {
  const { t, formatNumber } = useI18n();

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-backdrop">
      <div className="bg-card rounded-lg shadow-xl p-6 w-2/3 max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl text-card-foreground">
            {t("history.reviewModal.title")}
          </h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {data.modelId && (
              <span>
                {t("history.reviewModal.modelLabel", { modelId: data.modelId })}
              </span>
            )}
            <span title={t("history.cost.tooltip")}>
              {t("history.reviewModal.costLabel", {
                cost: formatCostLabel(data, t, formatNumber),
              })}
            </span>
          </div>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 flex flex-col">
            <h3 className="text-lg text-card-foreground mb-2">
              {t("history.reviewModal.originalHeading")}
            </h3>
            <CopyButton
              value={data.original}
              label={t("history.reviewModal.copyOriginal")}
              className="self-end mb-2"
            />
            <textarea
              readOnly
              value={data.original}
              className="w-full h-48 bg-secondary text-foreground p-2 rounded-md resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("history.reviewModal.originalTextArea")}
            />
          </div>
          <div className="flex-1 flex flex-col">
            <h3 className="text-lg text-card-foreground mb-2">
              {t("history.reviewModal.correctedHeading")}
            </h3>
            <CopyButton
              value={data.corrected}
              label={t("history.reviewModal.copyCorrected")}
              className="self-end mb-2"
            />
            <textarea
              readOnly
              value={data.corrected}
              className="w-full h-48 bg-secondary text-foreground p-2 rounded-md resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("history.reviewModal.correctedTextArea")}
            />
          </div>
        </div>
        <div className="mt-4 text-right">
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary"
            aria-label={t("history.reviewModal.closeAriaLabel")}
          >
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HistoryReviewModal;
