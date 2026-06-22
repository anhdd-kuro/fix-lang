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
      <span className="text-sm text-gray-400">
        Add provisioning key in Settings
      </span>
    );
  } else if (loading && !credits) {
    content = <span className="text-sm text-gray-400">Loading…</span>;
  } else if (credits?.ok) {
    content = (
      <div className="flex items-baseline gap-2">
        <span
          className={twJoin(
            "text-lg font-semibold tabular-nums",
            credits.data.lowBalance ? "text-red-400" : "text-gray-100"
          )}
        >
          {formatOpenRouterUsd(credits.data.availableUsd)}
        </span>
        {credits.data.lowBalance && (
          <span className="text-xs text-red-400">Low balance</span>
        )}
      </div>
    );
  } else {
    const reason = (credits?.reason ?? "unavailable") as OpenRouterDegradedReason;
    content = (
      <span className="text-sm text-gray-400">
        {openRouterDegradedMessage(reason)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={openOpenRouterTab}
      className={twJoin(
        "w-full rounded-lg border border-gray-700 bg-gray-800/80 px-3 py-2",
        "text-left hover:border-gray-600 hover:bg-gray-800 transition-colors"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-blue-400 mb-1">
        OpenRouter credit
      </div>
      {content}
    </button>
  );
};
