import React from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "../../components/Button";
import {
  formatOpenRouterUsd,
  openRouterDegradedMessage,
  type OpenRouterDegradedReason,
} from "../../components/openRouterFormat";
import { useOpenRouterAnalytics } from "../../hooks/useOpenRouterAnalytics";
import { useI18n } from "../../i18n/useI18n";
import type { CardResult, Credits } from "~/main/llm/openrouter/parsers";

const openOpenRouterTab = (): void => {
  window.electronAPI.hideTray();
  window.electronAPI.showMainWindowTab("openrouter");
};

export const TrayCreditBalance: React.FC = () => {
  const { t } = useI18n();
  const { data, loading, hasKey } = useOpenRouterAnalytics("7d");

  const credits = data?.credits as CardResult<Credits> | undefined;

  let content: React.ReactNode;

  if (hasKey === false) {
    content = (
      <span className="text-sm text-muted-foreground">
        {t("tray.credit.missingKey")}
      </span>
    );
  } else if (loading && !credits) {
    content = (
      <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
    );
  } else if (credits?.ok) {
    content = (
      <div className="flex items-baseline gap-2">
        <span
          className={twJoin(
            "text-lg font-semibold tabular-nums",
            credits.data.lowBalance ? "text-destructive" : "text-foreground"
          )}
        >
          {formatOpenRouterUsd(credits.data.availableUsd)}
        </span>
        {credits.data.lowBalance && (
          <span className="text-xs text-destructive">
            {t("tray.credit.lowBalance")}
          </span>
        )}
      </div>
    );
  } else {
    const reason = (credits?.reason ?? "unavailable") as OpenRouterDegradedReason;
    content = (
      <span className="text-sm text-muted-foreground">
        {openRouterDegradedMessage(reason, t)}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={openOpenRouterTab}
      className={twJoin(
        "w-full rounded-lg border border-card-control-border bg-card px-3 py-2",
        "text-left hover:bg-accent transition-colors"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
        {t("tray.credit.title")}
      </div>
      {content}
    </Button>
  );
};
