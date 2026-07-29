/**
 * @file HistorySessionDetailsModal.tsx
 * @description Shows the raw completion session JSON for a history entry.
 */
import React from "react";
import { Button } from "./Button";
import CopyButton from "./CopyButton";
import { useI18n } from "../i18n/useI18n";

type HistorySessionDetailsModalProps = {
  isOpen: boolean;
  sessionJson: string;
  onClose: () => void;
};

export const HistorySessionDetailsModal: React.FC<
  HistorySessionDetailsModalProps
> = ({ isOpen, sessionJson, onClose }) => {
  const { t } = useI18n();

  if (!isOpen) return null;

  let pretty = sessionJson;
  try {
    pretty = JSON.stringify(JSON.parse(sessionJson), null, 2);
  } catch {
    // Keep the raw string when it is not valid JSON.
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-backdrop">
      <div className="flex max-h-[90vh] w-2/3 max-w-3xl flex-col overflow-hidden rounded-lg bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl text-card-foreground">
            {t("history.details.title")}
          </h2>
          <CopyButton
            value={pretty}
            label={t("history.details.copy")}
            className="shrink-0"
          />
        </div>
        <pre
          className="min-h-0 flex-1 overflow-auto rounded-md bg-secondary p-3 text-xs text-foreground whitespace-pre-wrap break-words"
          aria-label={t("history.details.ariaLabel")}
        >
          {pretty}
        </pre>
        <div className="mt-4 text-right">
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
            className="rounded px-4 py-2"
            aria-label={t("history.details.closeAriaLabel")}
          >
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HistorySessionDetailsModal;
