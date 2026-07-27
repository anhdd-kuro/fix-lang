import React from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "./Button";
import { useI18n } from "../i18n/useI18n";

type TrashButtonProps = {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
};

export const TrashButton: React.FC<TrashButtonProps> = ({
  onClick,
  className = "",
  showLabel = false,
  size = "sm",
}) => {
  const { t } = useI18n();
  const iconSize = size === "sm" ? "size-4" : "size-6";

  return (
    <Button
      type="button"
      variant="destructive"
      onClick={onClick}
      className={twJoin(
        "p-1 transition-colors flex items-center gap-2",
        className
      )}
      aria-label={t("common.trashButton.ariaLabel")}
    >
      <svg
        className={iconSize}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      {showLabel && <span>{t("common.trashButton.clearLabel")}</span>}
    </Button>
  );
};

export default TrashButton;
