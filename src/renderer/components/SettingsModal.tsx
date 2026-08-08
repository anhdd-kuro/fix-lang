import React, { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import { isPromptGenEnabled } from "~/features/core/shared/features";
import { Button } from "./Button";
import ProfileManager from "./ProfileManager";
import { SettingAppearance } from "./SettingAppearance";
import { SettingAutocomplete } from "./SettingAutocomplete";
import { SettingCorrection } from "./SettingCorrection";
import { SettingGeneral } from "./SettingGeneral";
import { SettingPromptGen } from "./SettingPromptGen";
import { useI18n } from "../i18n/useI18n";
import type { TranslationKey } from "~/features/i18n/shared/keys";

// Define the tab configuration type
// `labelKey` (not a translated string) is resolved via `t()` at render time,
// so the tab table itself stays locale-free — the same pattern used for the
// dashboard tab table (see `dashboardTabs.ts`).
type SettingsTab = {
  id: string;
  labelKey: TranslationKey;
  icon: React.ReactNode;
  component: React.ReactNode;
};

/** Stable ids for the settings tabs, in display order — mirrors the `id`s below. */
export type SettingsTabId =
  | "profiles"
  | "general"
  | "appearance"
  | "correction"
  | "autocomplete"
  | "promptGen";

/**
 * Visible tab ids for the current build (promptGen only when the feature tag
 * is on). Lets callers outside this file (e.g. the user guide) resolve a tab
 * id to an index without importing the tabs' JSX.
 *
 * `autocomplete` is listed unconditionally, unlike `promptGen`: it has no
 * build-time feature tag, only a runtime `enabled` toggle that ships OFF —
 * and this tab is where that toggle lives, so hiding it while the feature is
 * off would leave no route to turning it on.
 */
export const visibleSettingsTabIds = (): SettingsTabId[] => {
  const ids: SettingsTabId[] = [
    "profiles",
    "general",
    "correction",
    "autocomplete",
    "appearance",
  ];
  if (isPromptGenEnabled()) {
    ids.push("promptGen");
  }
  return ids;
};

/** Index of `id` in the visible tab list, or 0 (Profiles) when not found. */
export const settingsTabIndex = (id: SettingsTabId): number => {
  const index = visibleSettingsTabIds().indexOf(id);
  return index >= 0 ? index : 0;
};

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Initial active tab index (0-based) into the *visible* tab list
   * (Profiles, General, Transform, Autocomplete, Appearance, and PromptGen
   * only when the PromptGen feature tag is built in). Out-of-range values are
   * clamped.
   */
  initialTab?: number;
};

/**
 * A modal component for application settings.
 * Contains tabs for different settings categories.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 0,
}) => {
  const { t } = useI18n();
  // Define all tab configurations - you can easily reorder these tabs by changing their position in the array
  const tabs: SettingsTab[] = [
    {
      id: "profiles",
      labelKey: "settings.modal.tabs.profiles",
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
      component: <ProfileManager />,
    },
    {
      id: "general",
      labelKey: "settings.modal.tabs.general",
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
      component: <SettingGeneral />,
    },
    {
      id: "correction",
      labelKey: "settings.modal.tabs.correction",
      icon: <></>,
      component: <SettingCorrection />,
    },
    // Beside Transform, not inside General: both are per-feature areas, and
    // an icon-less tab matches its Transform/PromptGen siblings.
    {
      id: "autocomplete",
      labelKey: "settings.modal.tabs.autocomplete",
      icon: <></>,
      component: <SettingAutocomplete />,
    },
    {
      id: "appearance",
      labelKey: "settings.modal.tabs.appearance",
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
      ),
      component: <SettingAppearance />,
    },
    // Build-time feature tag: no `--promptgen` => no PromptGen tab at all.
    ...(isPromptGenEnabled()
      ? ([
          {
            id: "promptGen",
            labelKey: "settings.modal.tabs.promptGen",
            icon: <></>,
            component: <SettingPromptGen />,
          },
        ] satisfies SettingsTab[])
      : []),
  ];

  // Tab state indexes into the (possibly filtered) tabs array, so clamp the
  // caller-supplied index — a disabled feature must not strand the modal on a
  // tab that no longer exists.
  const [activeTab, setActiveTab] = useState<number>(() =>
    Math.min(Math.max(initialTab, 0), tabs.length - 1),
  );

  // The modal stays mounted between opens (`isOpen` only gates the render
  // below), so the lazy initializer above only ever captures the FIRST
  // `initialTab`. Re-sync every time the modal opens so a caller that asks
  // for a specific tab (e.g. the user guide) actually lands on it, without
  // clobbering a tab the user picks manually while it stays open.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(Math.min(Math.max(initialTab, 0), tabs.length - 1));
    }
  }, [isOpen, initialTab, tabs.length]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-backdrop backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="flex h-[85vh] min-h-120 max-h-250 w-[80%] max-w-250 flex-col overflow-hidden rounded-lg bg-card p-6 shadow-xl">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-xl font-semibold text-primary">{t("settings.modal.title")}</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={t("settings.modal.close")}
            title={t("settings.modal.close")}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-4 shrink-0">
          <div
            className="grid w-full grid-cols-2 gap-2 rounded-lg p-1 sm:grid-cols-3 md:grid-cols-4"
            role="tablist"
            aria-label={t("settings.modal.tabsAriaLabel")}
          >
            {tabs.map((tab, index) => {
              const isActive = activeTab === index;
              const btnClass = twJoin(
                "tab transition-all duration-200 rounded-md font-medium text-sm flex items-center justify-center gap-1 py-1 min-w-min",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-card-foreground hover:bg-secondary hover:text-foreground",
              );

              return (
                <Button
                  key={tab.id}
                  variant={isActive ? "primary" : "ghost"}
                  role="tab"
                  id={`tab-${tab.id}`}
                  {...(isActive
                    ? { "aria-selected": true }
                    : { "aria-selected": false })}
                  aria-controls={`settings-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  className={btnClass}
                  onClick={() => setActiveTab(index)}
                  type="button"
                >
                  {tab.icon}
                  <span className="whitespace-nowrap">{t(tab.labelKey)}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tabs.map(
            (tab, index) =>
              activeTab === index && (
                <div
                  key={tab.id}
                  id={`settings-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`tab-${tab.id}`}
                  tabIndex={0}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
                >
                  {tab.component}
                </div>
              ),
          )}
        </div>
      </div>
    </div>
  );
};
