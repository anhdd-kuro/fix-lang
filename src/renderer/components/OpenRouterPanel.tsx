/**
 * @file OpenRouterPanel.tsx
 * @description OpenRouter account-analytics tab (#59). Account-level: shows
 * available credit (+ low-balance warning), key usage, per-model activity
 * (7d/30d), and the enabled-key count — each card degrades independently from
 * its CardResult. Data is fetched on tab-open, range change, and explicit
 * Refresh (60s TTL cache, no background polling). When no provisioning key is
 * set, an empty state prompts the user to add one in General settings.
 *
 * The provisioning key never reaches this component — only key-free parsed
 * view-models arrive via the combined IPC.
 */
import { useState } from "react";
import { twJoin } from "tailwind-merge";
import {
  formatOpenRouterUsd,
  openRouterDegradedMessage,
  type OpenRouterDegradedReason,
} from "./openRouterFormat";
import { useOpenRouterAnalytics } from "../hooks/useOpenRouterAnalytics";
import type {
  Activity,
  CardResult,
  Credits,
  EnabledKeys,
  KeyUsage,
} from "~/main/llm/openrouter/parsers";
import type { OpenRouterRange } from "~/preload/features/openrouter";

type OpenRouterPanelProps = {
  /** Opens the Settings modal (General tab) for the empty-state affordance. */
  onOpenSettings: () => void;
};

const RANGES: { id: OpenRouterRange; label: string }[] = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

type Card = { ok: false; reason: string } | { ok: true };

const Card = ({
  title,
  result,
  children,
}: {
  title: string;
  result: Card;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
    <div className="mb-1 text-xs uppercase tracking-wide text-blue-400">
      {title}
    </div>
    {result.ok ? (
      children
    ) : (
      <div className="text-sm text-gray-400">
        {openRouterDegradedMessage(
          (result as { reason: OpenRouterDegradedReason }).reason
        )}
      </div>
    )}
  </div>
);

export const OpenRouterPanel = ({ onOpenSettings }: OpenRouterPanelProps) => {
  const [range, setRange] = useState<OpenRouterRange>("7d");
  const { data, loading, hasKey, refresh } = useOpenRouterAnalytics(range);

  // Empty state: no key configured.
  if (hasKey === false) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-xs rounded-lg border border-gray-700 bg-gray-800 px-6 py-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-blue-400">
            OpenRouter
          </h2>
          <p className="mb-3 text-sm text-gray-400">
            Add an OpenRouter provisioning key in General settings to see your
            account credit, usage, and activity.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const credits = data?.credits as CardResult<Credits> | undefined;
  const keyUsage = data?.keyUsage as CardResult<KeyUsage> | undefined;
  const activity = data?.activity as CardResult<Activity> | undefined;
  const enabledKeys = data?.enabledKeys as CardResult<EnabledKeys> | undefined;

  const fallback = { ok: false as const, reason: "unavailable" as const };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
      <div className="flex items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="OpenRouter range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={twJoin(
                "px-2 py-0.5 text-xs rounded-sm",
                range === r.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ml-auto rounded-sm bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Available credit */}
      <Card title="Available credit" result={credits ?? fallback}>
        {credits?.ok && (
          <div>
            <div
              className={twJoin(
                "text-xl font-semibold tabular-nums",
                credits.data.lowBalance ? "text-red-400" : "text-gray-100"
              )}
            >
              {formatOpenRouterUsd(credits.data.availableUsd)}
            </div>
            {credits.data.lowBalance && (
              <div className="mt-0.5 text-xs text-red-400">
                Low balance — consider topping up.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Key usage */}
      <Card title="Key usage" result={keyUsage ?? fallback}>
        {keyUsage?.ok && (
          <div className="text-sm text-gray-200">
            <div>
              Used:{" "}
              <span className="tabular-nums">{formatOpenRouterUsd(keyUsage.data.usageUsd)}</span>
            </div>
            <div className="text-gray-400">
              Limit:{" "}
              {keyUsage.data.limitUsd === null
                ? "Unlimited"
                : formatOpenRouterUsd(keyUsage.data.limitUsd)}
              {keyUsage.data.limitReached && " (reached)"}
            </div>
          </div>
        )}
      </Card>

      {/* Per-model activity */}
      <Card title={`Activity (${range})`} result={activity ?? fallback}>
        {activity?.ok &&
          (activity.data.rows.length === 0 ? (
            <div className="text-sm text-gray-400">No activity in range.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-1 pr-2 font-medium">Model</th>
                  <th className="py-1 px-2 text-right font-medium">Requests</th>
                  <th className="py-1 pl-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {activity.data.rows.map((row) => (
                  <tr key={row.model} className="border-t border-gray-700">
                    <td
                      className="py-1 pr-2 text-gray-100 max-w-[10rem] truncate"
                      title={row.model}
                    >
                      {row.model}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-gray-300">
                      {row.requests}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums text-gray-300">
                      {formatOpenRouterUsd(row.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </Card>

      {/* Enabled keys */}
      <Card title="Enabled keys" result={enabledKeys ?? fallback}>
        {enabledKeys?.ok && (
          <div className="text-xl font-semibold tabular-nums text-gray-100">
            {enabledKeys.data.enabledCount}
            <span className="ml-1 text-xs text-gray-500">
              of {enabledKeys.data.totalCount}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};
