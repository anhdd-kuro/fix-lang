/**
 * @file UsagePanel.tsx
 * @description The dashboard's Usage tab: a sub-tab bar of connected,
 * usage-capable providers over one provider panel at a time.
 *
 * Which sub-tabs exist and their order live in the pure `usageTabs.ts` so the
 * rules are unit-tested without a DOM. Each panel owns its own range pills,
 * fetch, and 60s cache — the providers report different cards, and a shared range
 * would force OpenRouter's 7d/30d cap onto everything.
 *
 * Provider state is re-read on `settings-updated`, so connecting a provider or
 * storing an admin key updates the bar without reopening the dashboard.
 */
import { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import { OpenAIUsagePanel } from "./OpenAIUsagePanel";
import { OpenRouterUsagePanel } from "./OpenRouterUsagePanel";
import { buildUsageSubTabs, resolveActiveUsageProvider } from "./usageTabs";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import type { ProviderId } from "~/shared/providers";

type UsagePanelProps = {
  /** Opens the Settings modal (General tab) for every empty-state affordance. */
  onOpenSettings: () => void;
};

export const UsagePanel = ({ onOpenSettings }: UsagePanelProps) => {
  const { t } = useI18n();
  const [subTabs, setSubTabs] = useState<ReturnType<typeof buildUsageSubTabs>>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const [profileId, setProfileId] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    const load = (): void => {
      // Read as a pair, but let the profile read fail on its own: losing it
      // must not blank a sub-tab bar the provider states could still describe.
      const currentProfile = Promise.resolve(
        window.electronAPI.getCurrentProfile?.(),
      ).catch(() => undefined);

      void Promise.resolve(window.electronAPI.getProviderStates?.())
        .then(async (states) => {
          const profile = await currentProfile;
          if (!mounted) return;
          const next = buildUsageSubTabs(states ?? {});
          setSubTabs(next);
          // Keep the user on their provider when a refresh reorders the bar.
          setActiveProvider((current) => resolveActiveUsageProvider(next, current));
          setProfileId(profile?.currentProfileId ?? "");
        })
        .catch(() => {
          // No provider states means no sub-tabs: the empty state below already
          // says what to do, and a thrown IPC must not blank the whole tab.
          if (mounted) setSubTabs([]);
        });
    };

    load();
    const offSettingsUpdated = window.electronAPI.onSettingsUpdated(load);
    // A profile switch does NOT emit `settings-updated`, and it changes which
    // account every panel below is reporting on. Both subscriptions are needed.
    const offProfileChanged = window.electronAPI.onActiveProfileChanged?.(load);

    return () => {
      mounted = false;
      offSettingsUpdated();
      offProfileChanged?.();
    };
  }, []);

  if (subTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-xs rounded-lg border border-card-control-border bg-card px-6 py-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-primary">
            {t("dashboard.tab.usage")}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {t("usage.emptyState.description")}
          </p>
          <Button onClick={onOpenSettings} className="rounded px-3 py-1.5 text-sm">
            {t("usage.emptyState.openSettings")}
          </Button>
        </div>
      </div>
    );
  }

  // Remount the panel whenever the ACCOUNT behind it changes: each panel caches
  // account data for 60s and latches `hasKey`, so a preserved instance would
  // keep showing the previous profile's spend, or stay stuck on its no-key
  // empty state after a key is added. Rebuilding an identical tab list is not
  // enough — React keeps the child, and its cache, without a changed key.
  const activeTab = subTabs.find((tab) => tab.provider === activeProvider);
  const accountKey = `${profileId}:${activeTab?.hasAdminKey === true}`;

  return (
    <div className="flex h-full flex-col gap-3">
      <nav
        className="flex gap-1"
        role="tablist"
        aria-label={t("usage.subTabs.ariaLabel")}
      >
        {subTabs.map((tab) => {
          const isActive = tab.provider === activeProvider;
          return (
            <Button
              key={tab.provider}
              variant={isActive ? "primary" : "ghost"}
              role="tab"
              id={`usage-tab-${tab.provider}`}
              aria-selected={isActive}
              aria-controls={`usage-panel-${tab.provider}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveProvider(tab.provider)}
              type="button"
              className={twJoin(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {t(tab.labelKey)}
            </Button>
          );
        })}
      </nav>

      <div
        className="min-h-0 flex-1"
        role="tabpanel"
        id={`usage-panel-${activeProvider ?? "none"}`}
        aria-labelledby={`usage-tab-${activeProvider ?? "none"}`}
      >
        {activeProvider === "openai" && (
          <OpenAIUsagePanel key={accountKey} onOpenSettings={onOpenSettings} />
        )}
        {activeProvider === "openrouter" && (
          <OpenRouterUsagePanel key={accountKey} onOpenSettings={onOpenSettings} />
        )}
      </div>
    </div>
  );
};
