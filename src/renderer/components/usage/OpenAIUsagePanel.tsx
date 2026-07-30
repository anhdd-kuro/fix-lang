/**
 * @file OpenAIUsagePanel.tsx
 * @description OpenAI panel of the Usage tab. Shows billed spend for the range
 * with its per-project breakdown in the SAME card (both from
 * `/organization/costs` — one total and the projects it splits into, so they read
 * as one figure rather than two competing spend headings), token + request totals
 * and a per-model table (from `/organization/usage/completions`), plus the shared
 * charts. Every card — and each half of the spend card — degrades independently
 * from its own CardResult.
 *
 * DELIBERATE ASYMMETRY with the OpenRouter panel:
 * - No credit-balance or key-limit card — OpenAI's API exposes neither. The
 *   per-project card reports what a project SPENT, never what it has left.
 * - The per-model table has NO cost column, and the donut slices billed LINE
 *   ITEMS rather than models: cost cannot be grouped by model, and this app holds
 *   no OpenAI price table, so a per-model dollar figure could only be an estimate
 *   sitting next to real billed totals.
 *
 * The admin key never reaches this component — only key-free parsed view-models.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  UsageCostShareChart,
  UsageDailyCostChart,
  UsageDailyTokenChart,
} from "./UsageCharts";
import {
  formatUsageUsd,
  usageDegradedMessage,
  type UsageDegradedReason,
} from "./usageFormat";
import { useOpenAIUsage } from "../../hooks/useOpenAIUsage";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { SegmentedControl } from "../SegmentedControl";
import { UsagePanelSkeleton } from "../Skeleton";
import type {
  CardResult,
  OpenAICompletionsUsage,
  OpenAICosts,
  OpenAIProjectCosts,
  OpenAIProjectSpendRow,
} from "~/main/llm/providers/openai/usage.parsers";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { Translator } from "~/shared/i18n/translate";
import type { UsageRange } from "~/shared/usage";

type OpenAIUsagePanelProps = {
  /** Opens the Settings modal (General tab) for the empty-state affordance. */
  onOpenSettings: () => void;
};

const RANGES: { id: UsageRange; labelKey: TranslationKey }[] = [
  { id: "7d", labelKey: "usage.range.7d" },
  { id: "30d", labelKey: "usage.range.30d" },
];

type CardShape = { ok: false; reason: string } | { ok: true };

const CardShell = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-card-control-border bg-card p-3">
    <div className="mb-1 text-xs uppercase tracking-wide text-primary">{title}</div>
    {children}
  </div>
);

/**
 * Content gated on ONE `CardResult`. Split out from `Card` so the spend card can
 * hold two of them: its total and its per-project breakdown arrive from separate
 * requests, and either must be able to degrade while the other still shows real
 * billed dollars.
 */
const CardBody = ({
  result,
  t,
  children,
}: {
  result: CardShape;
  t: Translator;
  children: React.ReactNode;
}) =>
  result.ok ? (
    <>{children}</>
  ) : (
    <div className="text-sm text-muted-foreground">
      {usageDegradedMessage((result as { reason: UsageDegradedReason }).reason, t)}
    </div>
  );

const Card = ({
  title,
  result,
  t,
  children,
}: {
  title: string;
  result: CardShape;
  t: Translator;
  children: React.ReactNode;
}) => (
  <CardShell title={title}>
    <CardBody result={result} t={t}>
      {children}
    </CardBody>
  </CardShell>
);

/**
 * The project's own name, falling back to the raw `proj_…` id when the name
 * lookup came back empty, and to a labelled bucket for spend OpenAI reported
 * with no project at all. Never renders a blank cell.
 */
const projectLabel = (row: OpenAIProjectSpendRow, t: Translator): string => {
  if (row.name !== null) return row.name;
  if (row.projectId === "") return t("usage.openai.projectSpend.unattributed");
  return row.projectId;
};

export const OpenAIUsagePanel = ({ onOpenSettings }: OpenAIUsagePanelProps) => {
  const { t, formatNumber } = useI18n();
  const [range, setRange] = useState<UsageRange>("7d");
  const { data, loading, hasKey, refresh } = useOpenAIUsage(range);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback((): void => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refresh, 1000);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [range]);

  // Empty state: connected, but no admin key — the request key cannot read the
  // organization endpoints, so there is nothing to show until one is stored.
  if (hasKey === false) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-xs rounded-lg border border-card-control-border bg-card px-6 py-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-primary">OpenAI</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {t("usage.openai.emptyState.description")}
          </p>
          <Button onClick={onOpenSettings} className="rounded px-3 py-1.5 text-sm">
            {t("usage.emptyState.openSettings")}
          </Button>
        </div>
      </div>
    );
  }

  const costs = data?.costs as CardResult<OpenAICosts> | undefined;
  const completions = data?.completions as
    | CardResult<OpenAICompletionsUsage>
    | undefined;
  const projectCosts = data?.projectCosts as
    | CardResult<OpenAIProjectCosts>
    | undefined;

  if (loading && data === null) {
    return <UsagePanelSkeleton ariaLabel={t("usage.loading")} />;
  }

  const fallback = { ok: false as const, reason: "unavailable" as const };
  const rangeLabel = t(
    RANGES.find((r) => r.id === range)?.labelKey ?? RANGES[0].labelKey,
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
      <div className="flex items-center gap-2">
        <SegmentedControl
          value={range}
          onChange={setRange}
          ariaLabel={t("usage.rangeGroupLabel")}
          options={RANGES.map((r) => ({
            value: r.id,
            label: t(r.labelKey),
          }))}
        />
        <Button
          variant="secondary"
          onClick={debouncedRefresh}
          disabled={loading}
          className="ml-auto rounded-sm px-2 py-0.5 text-xs"
        >
          {loading ? t("usage.refreshing") : t("common.refresh")}
        </Button>
      </div>

      {/* Billed spend for the range, with its per-project breakdown in the same
          card — one figure and the projects it splits into. The two arrive from
          separate /costs requests, so each half degrades on its own. */}
      <CardShell title={t("usage.openai.spend.title", { range: rangeLabel })}>
        <CardBody result={costs ?? fallback} t={t}>
          {costs?.ok && (
            <div className="text-xl font-semibold tabular-nums text-foreground">
              {formatUsageUsd(costs.data.totalUsd)}
            </div>
          )}
        </CardBody>

        <div className="mt-3 border-t border-card-control-border pt-2">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {t("usage.openai.projectSpend.subtitle")}
          </div>
          <CardBody result={projectCosts ?? fallback} t={t}>
            {projectCosts?.ok &&
              (projectCosts.data.projects.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t("usage.openai.projectSpend.empty")}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">
                        {t("usage.columns.project")}
                      </th>
                      <th className="py-1 pl-2 text-right font-medium">
                        {t("usage.columns.spend")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectCosts.data.projects.map((row) => {
                      const label = projectLabel(row, t);
                      return (
                        <tr
                          key={row.projectId}
                          className="border-t border-card-control-border"
                        >
                          <td
                            className="py-1 pr-2 text-foreground max-w-[14rem] truncate"
                            title={label}
                          >
                            {label}
                          </td>
                          <td className="py-1 pl-2 text-right tabular-nums text-card-foreground">
                            {formatUsageUsd(row.costUsd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
          </CardBody>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {t("usage.openai.spend.note")}
        </div>
      </CardShell>

      {/* Token + request totals */}
      <Card
        title={t("usage.tokens.title", { range: rangeLabel })}
        result={completions ?? fallback}
        t={t}
      >
        {completions?.ok && (
          <div className="flex gap-6 text-sm text-card-foreground">
            <div>
              <div className="text-xs text-muted-foreground">
                {t("usage.columns.inputTokens")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(completions.data.totalInputTokens)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("usage.columns.outputTokens")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(completions.data.totalOutputTokens)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {t("usage.columns.requests")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(completions.data.totalRequests)}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Per-model activity — tokens and requests only; see the header note. */}
      <Card
        title={t("usage.openai.perModel.title", { range: rangeLabel })}
        result={completions ?? fallback}
        t={t}
      >
        {completions?.ok &&
          (completions.data.perModel.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("usage.perModel.empty")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">
                    {t("usage.columns.model")}
                  </th>
                  <th className="py-1 px-2 text-right font-medium">
                    {t("usage.columns.requests")}
                  </th>
                  <th className="py-1 px-2 text-right font-medium">
                    {t("usage.columns.inputTokens")}
                  </th>
                  <th className="py-1 pl-2 text-right font-medium">
                    {t("usage.columns.outputTokens")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {completions.data.perModel.map((row) => (
                  <tr key={row.model} className="border-t border-card-control-border">
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
                      {formatNumber(row.inputTokens)}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.outputTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </Card>

      {/* Charts. Cost comes from the costs card, tokens from the usage card, so
          each chart renders only when ITS source parsed. */}
      {costs?.ok && <UsageDailyCostChart points={costs.data.daily} />}
      {completions?.ok && <UsageDailyTokenChart points={completions.data.daily} />}
      {costs?.ok && (
        <UsageCostShareChart
          slices={costs.data.lineItems}
          titleKey="usage.chart.costShare.byLineItem"
        />
      )}
      {projectCosts?.ok && (
        <UsageCostShareChart
          slices={projectCosts.data.projects.map((row) => ({
            label: projectLabel(row, t),
            costUsd: row.costUsd,
          }))}
          titleKey="usage.chart.costShare.byProject"
        />
      )}
    </div>
  );
};
