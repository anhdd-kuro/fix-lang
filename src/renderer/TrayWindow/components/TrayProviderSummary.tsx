/**
 * @file TrayProviderSummary.tsx
 * @description The tray's Providers card: one sub-tab per connected,
 * usage-capable provider over a single account figure.
 *
 * The tab list comes from the Usage tab's own `buildUsageSubTabs`, so the tray and
 * the dashboard can never disagree about which providers have an account to
 * report on. Only the ACTIVE tab's body is rendered, which is what keeps opening
 * the tray to one request instead of one per provider.
 *
 * The figures are deliberately asymmetric, because the providers are: OpenRouter
 * exposes a prepaid credit balance, while OpenAI exposes no balance at all — only
 * billed spend, and per project only when the user has said which project
 * (an admin key is organization-scoped; see `~/shared/openaiProject`).
 */
import React, { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import { selectProjectSpend } from "./trayProviderSummaryView";
import { Button } from "../../components/Button";
import {
  formatOpenRouterUsd,
  openRouterDegradedMessage,
  type OpenRouterDegradedReason,
} from "../../components/openRouterFormat";
import {
  usageDegradedMessage,
  type UsageDegradedReason,
} from "../../components/usage/usageFormat";
import {
  buildUsageSubTabs,
  resolveActiveUsageProvider,
  type UsageSubTab,
} from "../../components/usage/usageTabs";
import { useOpenAIProjectId } from "../../hooks/useOpenAIProjectId";
import { useOpenAIUsage } from "../../hooks/useOpenAIUsage";
import { useOpenRouterAnalytics } from "../../hooks/useOpenRouterAnalytics";
import { useI18n } from "../../i18n/useI18n";
import type { CardResult, Credits } from "~/main/llm/providers/openrouter/parsers";
import type { ProviderId } from "~/shared/providers";

/** The tray's own window is not the dashboard, so opening a tab closes it. */
const openUsageTab = (provider: ProviderId): void => {
  window.electronAPI.hideTray();
  window.electronAPI.showMainWindowTab("usage", provider);
};

type BodyProps = {
  /** Rendered above the figure; states what the number actually measures. */
  label: string;
};

const SummaryLine: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <>
    <div className="text-xs text-muted-foreground">{label}</div>
    {children}
  </>
);

const MutedMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-sm text-muted-foreground">{children}</span>
);

const Figure: React.FC<{ emphasize?: boolean; children: React.ReactNode }> = ({
  emphasize = false,
  children,
}) => (
  <span
    className={twJoin(
      "text-lg font-semibold tabular-nums",
      emphasize ? "text-destructive" : "text-foreground",
    )}
  >
    {children}
  </span>
);

const OpenRouterCreditBody: React.FC<BodyProps> = ({ label }) => {
  const { t } = useI18n();
  const { data, loading, hasKey } = useOpenRouterAnalytics("7d");
  const credits = data?.credits as CardResult<Credits> | undefined;

  if (hasKey === false) {
    return <MutedMessage>{t("tray.credit.missingKey")}</MutedMessage>;
  }
  if (loading && !credits) {
    return <MutedMessage>{t("common.loading")}</MutedMessage>;
  }
  if (!credits?.ok) {
    const reason = (credits?.reason ?? "unavailable") as OpenRouterDegradedReason;
    return <MutedMessage>{openRouterDegradedMessage(reason, t)}</MutedMessage>;
  }

  return (
    <SummaryLine label={label}>
      <div className="flex items-baseline gap-2">
        <Figure emphasize={credits.data.lowBalance}>
          {formatOpenRouterUsd(credits.data.availableUsd)}
        </Figure>
        {credits.data.lowBalance && (
          <span className="text-xs text-destructive">
            {t("tray.credit.lowBalance")}
          </span>
        )}
      </div>
    </SummaryLine>
  );
};

const OpenAIProjectSpendBody: React.FC<BodyProps> = ({ label }) => {
  const { t } = useI18n();
  const projectId = useOpenAIProjectId();
  const { data, loading, hasKey } = useOpenAIUsage("7d");
  const projectCosts = data?.projectCosts;

  if (hasKey === false) {
    return <MutedMessage>{t("tray.providers.openai.missingKey")}</MutedMessage>;
  }
  // `undefined` is "not read yet" — only a resolved `null` means unconfigured.
  if (projectId === null) {
    return <MutedMessage>{t("tray.providers.openai.missingProject")}</MutedMessage>;
  }
  if (projectId === undefined || (loading && !projectCosts)) {
    return <MutedMessage>{t("common.loading")}</MutedMessage>;
  }
  if (!projectCosts?.ok) {
    const reason = (projectCosts?.reason ?? "unavailable") as UsageDegradedReason;
    return <MutedMessage>{usageDegradedMessage(reason, t)}</MutedMessage>;
  }

  const spend = selectProjectSpend(projectCosts.data, projectId);
  if (spend.kind === "no-spend") {
    return <MutedMessage>{t("tray.providers.openai.noSpend")}</MutedMessage>;
  }

  return (
    <SummaryLine label={label}>
      <div className="flex flex-col">
        <Figure>{formatOpenRouterUsd(spend.costUsd)}</Figure>
        {/* Falls back to the raw id: an unresolved name still identifies the
            project, where a blank line would leave the figure unattributed. */}
        <span className="truncate text-xs text-muted-foreground">
          {spend.name ?? projectId}
        </span>
      </div>
    </SummaryLine>
  );
};

export const TrayProviderSummary: React.FC = () => {
  const { t } = useI18n();
  const [subTabs, setSubTabs] = useState<UsageSubTab[]>([]);
  const [chosenProvider, setChosenProvider] = useState<ProviderId | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = (): void => {
      void Promise.resolve(window.electronAPI.getProviderStates?.())
        .then((states) => {
          if (mounted) setSubTabs(buildUsageSubTabs(states ?? {}));
        })
        .catch(() => {
          // No provider states means no tabs; the empty state below says what
          // to do, and a thrown IPC must not blank the whole tray.
          if (mounted) setSubTabs([]);
        });
    };

    load();
    const offSettings = window.electronAPI.onSettingsUpdated?.(load);

    return () => {
      mounted = false;
      offSettings?.();
    };
  }, []);

  // Derived, not synced: an effect writing this would cascade a render, and
  // `resolveActiveUsageProvider` already drops a choice whose tab disappeared.
  const activeProvider = resolveActiveUsageProvider(subTabs, chosenProvider);

  return (
    <div className="rounded-lg border border-card-control-border bg-card px-3 py-2">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {t("tray.providers.title")}
      </div>

      {activeProvider === null ? (
        <MutedMessage>{t("tray.providers.empty")}</MutedMessage>
      ) : (
        <>
          <nav
            className="mb-1.5 flex gap-1"
            role="tablist"
            aria-label={t("tray.providers.tabsAriaLabel")}
          >
            {subTabs.map((tab) => {
              const isActive = tab.provider === activeProvider;
              return (
                <Button
                  key={tab.provider}
                  type="button"
                  variant={isActive ? "primary" : "ghost"}
                  role="tab"
                  id={`tray-provider-tab-${tab.provider}`}
                  aria-selected={isActive}
                  aria-controls={`tray-provider-panel-${tab.provider}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setChosenProvider(tab.provider)}
                  className={twJoin(
                    "rounded-md px-2 py-0.5 text-xs font-medium",
                    isActive
                      ? "shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(tab.labelKey)}
                </Button>
              );
            })}
          </nav>

          {/* The panel is the `tabpanel`, not the button inside it: a `role` on
              the button would strip the semantics that make it activatable. */}
          <div
            role="tabpanel"
            id={`tray-provider-panel-${activeProvider}`}
            aria-labelledby={`tray-provider-tab-${activeProvider}`}
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => openUsageTab(activeProvider)}
              className="-mx-1 w-full rounded-md px-1 py-0.5 text-left hover:bg-accent"
            >
              {activeProvider === "openrouter" && (
                <OpenRouterCreditBody
                  label={t("tray.providers.openrouter.creditLabel")}
                />
              )}
              {activeProvider === "openai" && (
                <OpenAIProjectSpendBody
                  label={t("tray.providers.openai.projectSpendLabel")}
                />
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
