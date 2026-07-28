/**
 * @file OpenRouterUsagePanel.tsx
 * @description OpenRouter panel of the Usage tab (#59). Account-level: available
 * credit (+ low-balance warning), key usage, token totals, per-model activity
 * (7d/30d), the enabled-key count, and the three shared charts — each card
 * degrades independently from its CardResult. Data is fetched on panel-open,
 * range change, and explicit Refresh (60s TTL cache, no background polling).
 * When no provisioning key is set, an empty state prompts the user to add one in
 * General settings.
 *
 * The provisioning key never reaches this component — only key-free parsed
 * view-models arrive via the combined IPC.
 */
import { useState } from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "../Button";
import {
  formatOpenRouterUsd,
  openRouterDegradedMessage,
  type OpenRouterDegradedReason,
} from "../openRouterFormat";
import {
  UsageCostShareChart,
  UsageDailyCostChart,
  UsageDailyTokenChart,
} from "./UsageCharts";
import { useOpenRouterAnalytics } from "../../hooks/useOpenRouterAnalytics";
import { useI18n } from "../../i18n/useI18n";
import type {
  Activity,
  CardResult,
  Credits,
  EnabledKeys,
  KeyUsage,
} from "~/main/llm/providers/openrouter/parsers";
import type { OpenRouterRange } from "~/preload/features/openrouter";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { Translator } from "~/shared/i18n/translate";

type OpenRouterUsagePanelProps = {
  /** Opens the Settings modal (General tab) for the empty-state affordance. */
  onOpenSettings: () => void;
};

const RANGES: { id: OpenRouterRange; labelKey: TranslationKey }[] = [
  { id: "7d", labelKey: "models.openrouter.range.7d" },
  { id: "30d", labelKey: "models.openrouter.range.30d" },
];

type Card = { ok: false; reason: string } | { ok: true };

const Card = ({
  title,
  result,
  t,
  children,
}: {
  title: string;
  result: Card;
  t: Translator;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-card-control-border bg-card p-3">
    <div className="mb-1 text-xs uppercase tracking-wide text-primary">
      {title}
    </div>
    {result.ok ? (
      children
    ) : (
      <div className="text-sm text-muted-foreground">
        {openRouterDegradedMessage(
          (result as { reason: OpenRouterDegradedReason }).reason,
          t,
        )}
      </div>
    )}
  </div>
);

export const OpenRouterUsagePanel = ({ onOpenSettings }: OpenRouterUsagePanelProps) => {
  const { t, formatNumber } = useI18n();
  const [range, setRange] = useState<OpenRouterRange>("7d");
  const { data, loading, hasKey, refresh } = useOpenRouterAnalytics(range);

  // Empty state: no key configured.
  if (hasKey === false) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-xs rounded-lg border border-card-control-border bg-card px-6 py-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-primary">
            OpenRouter
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {t("models.openrouter.emptyState.description")}
          </p>
          <Button
            onClick={onOpenSettings}
            className="rounded px-3 py-1.5 text-sm"
          >
            {t("models.openrouter.emptyState.openSettings")}
          </Button>
        </div>
      </div>
    );
  }

  const credits = data?.credits as CardResult<Credits> | undefined;
  const keyUsage = data?.keyUsage as CardResult<KeyUsage> | undefined;
  const activity = data?.activity as CardResult<Activity> | undefined;
  const enabledKeys = data?.enabledKeys as CardResult<EnabledKeys> | undefined;

  const fallback = { ok: false as const, reason: "unavailable" as const };
  const rangeLabel = t(
    RANGES.find((r) => r.id === range)?.labelKey ?? RANGES[0].labelKey,
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
      <div className="flex items-center gap-2">
        <div
          className="flex gap-1"
          role="group"
          aria-label={t("models.openrouter.rangeGroupLabel")}
        >
          {RANGES.map((r) => (
            <Button
              key={r.id}
              variant={range === r.id ? "primary" : "secondary"}
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={twJoin(
                "px-2 py-0.5 text-xs rounded-sm",
              )}
            >
              {t(r.labelKey)}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={refresh}
          disabled={loading}
          className="ml-auto rounded-sm px-2 py-0.5 text-xs"
        >
          {loading ? t("models.openrouter.refreshing") : t("common.refresh")}
        </Button>
      </div>

      {/* Available credit */}
      <Card
        title={t("models.openrouter.credits.title")}
        result={credits ?? fallback}
        t={t}
      >
        {credits?.ok && (
          <div>
            <div
              className={twJoin(
                "text-xl font-semibold tabular-nums",
                credits.data.lowBalance
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {formatOpenRouterUsd(credits.data.availableUsd)}
            </div>
            {credits.data.lowBalance && (
              <div className="mt-0.5 text-xs text-destructive">
                {t("models.openrouter.credits.lowBalance")}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Key usage */}
      <Card
        title={t("models.openrouter.keyUsage.title")}
        result={keyUsage ?? fallback}
        t={t}
      >
        {keyUsage?.ok && (
          <div className="text-sm text-card-foreground">
            <div>
              {t("models.openrouter.keyUsage.used")}{" "}
              <span className="tabular-nums">
                {formatOpenRouterUsd(keyUsage.data.usageUsd)}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t("models.openrouter.keyUsage.limit")}{" "}
              {keyUsage.data.limitUsd === null
                ? t("models.openrouter.keyUsage.unlimited")
                : formatOpenRouterUsd(keyUsage.data.limitUsd)}
              {keyUsage.data.limitReached &&
                ` ${t("models.openrouter.keyUsage.limitReached")}`}
            </div>
          </div>
        )}
      </Card>

      {/* Token totals — summed from the same activity rows, so it degrades with
          them rather than pretending to be an independent endpoint. */}
      <Card
        title={t("usage.tokens.title", { range: rangeLabel })}
        result={activity ?? fallback}
        t={t}
      >
        {activity?.ok && (
          <div className="flex gap-6 text-sm text-card-foreground">
            <div>
              <div className="text-xs text-muted-foreground">
                {t("usage.columns.inputTokens")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(
                  activity.data.rows.reduce((sum, row) => sum + row.promptTokens, 0),
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("usage.columns.outputTokens")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(
                  activity.data.rows.reduce(
                    (sum, row) => sum + row.completionTokens,
                    0,
                  ),
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("models.openrouter.activity.columns.requests")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(
                  activity.data.rows.reduce((sum, row) => sum + row.requests, 0),
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Per-model activity */}
      <Card
        title={t("models.openrouter.activity.title", { range: rangeLabel })}
        result={activity ?? fallback}
        t={t}
      >
        {activity?.ok &&
          (activity.data.rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("models.openrouter.activity.empty")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">
                    {t("models.openrouter.activity.columns.model")}
                  </th>
                  <th className="py-1 px-2 text-right font-medium">
                    {t("models.openrouter.activity.columns.requests")}
                  </th>
                  <th className="py-1 px-2 text-right font-medium">
                    {t("usage.columns.inputTokens")}
                  </th>
                  <th className="py-1 px-2 text-right font-medium">
                    {t("usage.columns.outputTokens")}
                  </th>
                  <th className="py-1 pl-2 text-right font-medium">
                    {t("models.openrouter.activity.columns.cost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activity.data.rows.map((row) => (
                  <tr
                    key={row.model}
                    className="border-t border-card-control-border"
                  >
                    <td
                      className="py-1 pr-2 text-foreground max-w-[10rem] truncate"
                      title={row.model}
                    >
                      {row.model}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.requests)}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.promptTokens)}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.completionTokens)}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums text-card-foreground">
                      {formatOpenRouterUsd(row.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </Card>

      {/* Enabled keys */}
      <Card
        title={t("models.openrouter.enabledKeys.title")}
        result={enabledKeys ?? fallback}
        t={t}
      >
        {enabledKeys?.ok && (
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {enabledKeys.data.enabledCount}
            <span className="ml-1 text-xs text-muted-foreground">
              {t("models.openrouter.enabledKeys.of", {
                total: enabledKeys.data.totalCount,
              })}
            </span>
          </div>
        )}
      </Card>

      {/* Charts — only once the activity card itself parsed; a degraded card
          would otherwise paint three empty frames saying nothing useful. */}
      {activity?.ok && (
        <>
          <UsageDailyCostChart points={activity.data.daily} />
          <UsageDailyTokenChart points={activity.data.daily} />
          <UsageCostShareChart
            slices={activity.data.rows.map((row) => ({
              label: row.model,
              costUsd: row.costUsd,
            }))}
            titleKey="usage.chart.costShare.byModel"
          />
        </>
      )}
    </div>
  );
};
