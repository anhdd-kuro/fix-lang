import React from "react";
import { Button } from "./Button";
import { useModalDismiss } from "../hooks/useModalDismiss";
import { useI18n } from "../i18n/useI18n";

type DialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  const { t } = useI18n();
  const dialogRef = useModalDismiss<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        ref={dialogRef}
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-medium text-foreground">{title}</h3>
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
};
