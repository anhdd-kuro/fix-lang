import React from "react";
import { twJoin } from "tailwind-merge";
import {
  formatOpenRouterUsd,
  openRouterDegradedMessage,
  type OpenRouterDegradedReason,
} from "../../components/openRouterFormat";
import { useOpenRouterAnalytics } from "../../hooks/useOpenRouterAnalytics";
import type { CardResult, Credits } from "~/main/llm/openrouter/parsers";

const openOpenRouterTab = (): void => {
  window.electronAPI.hideTray();
  window.electronAPI.showMainWindowTab("openrouter");
};

export const TrayCreditBalance: React.FC = () => {
  const { data, loading, hasKey } = useOpenRouterAnalytics("7d");

  const credits = data?.credits as CardResult<Credits> | undefined;

  let content: React.ReactNode;

  if (hasKey === false) {
    content = (
      <span className="text-sm text-muted-foreground">
        Add provisioning key in Settings
      </span>
    );
  } else if (loading && !credits) {
    content = <span className="text-sm text-muted-foreground">Loading…</span>;
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
          <span className="text-xs text-destructive">Low balance</span>
        )}
      </div>
    );
  } else {
    const reason = (credits?.reason ?? "unavailable") as OpenRouterDegradedReason;
    content = (
      <span className="text-sm text-muted-foreground">
        {openRouterDegradedMessage(reason)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={openOpenRouterTab}
      className={twJoin(
        "w-full rounded-lg border border-border bg-card px-3 py-2",
        "text-left hover:bg-accent transition-colors"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
        OpenRouter credit
      </div>
      {content}
    </button>
  );
};
