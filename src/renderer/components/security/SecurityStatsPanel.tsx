/**
 * @file SecurityStatsPanel.tsx
 * @description Security dashboard tab: what the guard rails did over the shared
 * analytics range. Read-only — the controls live in Settings → Security
 * (`SettingSecurity.tsx`).
 *
 * The preload bridge REJECTS a malformed reply rather than returning zeros (see
 * `~/features/guards/preload/guards.ts`), so a failure shows the error state
 * instead of rendering as "no guard ever fired".
 */
import { useEffect, useMemo, useState } from "react";
import { resolveSecurityStatsView } from "./securityStatsView";
import { useI18n } from "../../i18n/useI18n";
import { resolveStatus, type StatusDescriptor } from "../statusDescriptor";
import type { SecurityStatCard } from "./securityStatsView";
import type { AnalyticsRange } from "../../analytics/shared";
import type { SecurityStats } from "~/features/guards/shared/securityStats";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; stats: SecurityStats };

type SecurityStatsPanelProps = {
  range: AnalyticsRange;
};

export const SecurityStatsPanel = ({ range }: SecurityStatsPanelProps) => {
  const { t, tm, tl, formatNumber, formatDate } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setState({ status: "loading" });
      try {
        const stats = await window.electronAPI.getSecurityStats(range);
        if (!cancelled) {
          setState({ status: "ready", stats });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const view = useMemo(
    () => (state.status === "ready" ? resolveSecurityStatsView(state.stats) : null),
    [state],
  );

  const resolve = (status: StatusDescriptor | null): string => resolveStatus(status, t, tm, tl);

  if (state.status === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">{t("security.stats.loading")}</p>;
  }

  if (state.status === "error" || view === null) {
    return <p className="p-4 text-sm text-muted-foreground">{t("security.stats.error")}</p>;
  }

  const renderCard = (card: SecurityStatCard) => (
    <div
      key={card.id}
      className="flex flex-col gap-1 rounded-lg border border-card-control-border bg-card p-4"
    >
      <span className="text-sm text-muted-foreground">{t(card.labelKey)}</span>
      <span className="text-2xl font-semibold text-foreground">{formatNumber(card.value)}</span>
      {card.details.map((detail, index) => (
        <span key={`${card.id}-detail-${index}`} className="text-xs text-muted-foreground">
          {resolve(detail)}
        </span>
      ))}
      <span className="text-xs text-muted-foreground">{t(card.hintKey)}</span>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t("security.stats.secretSection.title")}
          </h2>
          {view.lastEventAt !== null && (
            <span className="text-xs text-muted-foreground">
              {t("security.stats.lastEvent", { date: formatDate(new Date(view.lastEventAt)) })}
            </span>
          )}
        </div>
        {!view.hasActivity && (
          <p className="text-sm text-muted-foreground">{resolve(view.emptyHint)}</p>
        )}
        {view.legacyNotice !== null && (
          <p className="text-sm text-muted-foreground">{resolve(view.legacyNotice)}</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.secretCards.map(renderCard)}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("security.stats.selectionSection.title")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.selectionCards.map(renderCard)}
        </div>
      </section>

      {view.ruleRows.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-card-control-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            {t("security.stats.rules.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{resolve(view.rulesHint)}</p>
          <ul className="flex flex-col gap-1">
            {view.ruleRows.map((row) => (
              <li key={row.ruleId} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-card-foreground">
                  {row.labelKey === null ? row.ruleId : t(row.labelKey)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(row.count)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">{t("security.stats.footnote")}</p>
    </div>
  );
};
