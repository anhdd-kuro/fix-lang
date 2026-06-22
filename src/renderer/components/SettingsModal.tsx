import React, { useState } from "react";
import { twJoin } from "tailwind-merge";
import ProfileManager from "./ProfileManager";
import { SettingAppearance } from "./SettingAppearance";
import { SettingCorrection } from "./SettingCorrection";
import { SettingGeneral } from "./SettingGeneral";
import { SettingPromptGen } from "./SettingPromptGen";

// Define the tab configuration type
type SettingsTab = {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ReactNode;
};

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Initial active tab index (0-based). Tabs: Profiles, General, Correction, PromptGen. */
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
  // Define all tab configurations - you can easily reorder these tabs by changing their position in the array
  const tabs: SettingsTab[] = [
    {
      id: "profiles",
      label: "Profiles",
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
      label: "General",
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
      id: "appearance",
      label: "Appearance",
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

    {
      id: "correction",
      label: "Correction",
      icon: <></>,
      component: <SettingCorrection />,
    },
    {
      id: "promptGen",
      label: "PromptGen",
      icon: <></>,
      component: <SettingPromptGen />,
    },
  ];

  // Tab state now uses the initialTab to index into the tabs array
  const [activeTab, setActiveTab] = useState<number>(initialTab);

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
          <h2 className="text-xl font-semibold text-primary">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-2xl font-bold"
            aria-label="Close settings modal"
            title="Close settings modal"
          >
            &times;
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-4 shrink-0">
          <div
            className="grid w-full grid-cols-2 gap-2 rounded-lg p-1 sm:grid-cols-3 lg:grid-cols-5"
            role="tablist"
            aria-label="Settings tabs"
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
                <button
                  key={tab.id}
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
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
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
