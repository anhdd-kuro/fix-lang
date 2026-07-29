/**
 * @file AboutPanel.tsx
 * @description The dashboard's About tab: a sub-tab bar over one panel at a
 * time — **App updates** (version, check/install, how-to-update commands) and
 * **User guide** (onboarding). Same shell pattern as `usage/UsagePanel.tsx`,
 * with the tab table and fallback rules in the pure `aboutTabs.ts`.
 *
 * `SettingUpdates` keeps its own card wrapper here so the update controls look
 * exactly as they did when they were the whole tab.
 */
import { useState } from "react";
import { twJoin } from "tailwind-merge";
import { ABOUT_TABS, resolveActiveAboutTab, type AboutTabId } from "./aboutTabs";
import { UserGuidePanel } from "./UserGuidePanel";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { SettingUpdates } from "../SettingUpdates";
import type { DashboardTabId } from "../../MainWindow/dashboardTabs";
import type { SettingsTabId } from "../SettingsModal";

export const AboutPanel = ({
  onOpenSettings,
  onNavigateToTab,
}: {
  /**
   * Opens the Settings modal — used by the guide's setup affordances. Pass a
   * tab id to land on that tab directly.
   */
  onOpenSettings: (tabId?: SettingsTabId) => void;
  /** Switches the dashboard to `tabId` — used by the guide's dashboard links. */
  onNavigateToTab: (tabId: DashboardTabId) => void;
}) => {
  const { t } = useI18n();
  const [requestedTab, setRequestedTab] = useState<AboutTabId | null>(null);
  const activeTab = resolveActiveAboutTab(requestedTab);

  return (
    <div className="flex h-full flex-col gap-3">
      <nav
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label={t("about.subTabs.ariaLabel")}
      >
        {ABOUT_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Button
              key={tab.id}
              variant={isActive ? "primary" : "ghost"}
              role="tab"
              id={`about-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`about-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setRequestedTab(tab.id)}
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
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-card-control-border bg-card p-4"
        role="tabpanel"
        id={`about-panel-${activeTab}`}
        aria-labelledby={`about-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "updates" && <SettingUpdates />}
        {activeTab === "guide" && (
          <UserGuidePanel
            onOpenSettings={onOpenSettings}
            onNavigateToTab={onNavigateToTab}
          />
        )}
      </div>
    </div>
  );
};
