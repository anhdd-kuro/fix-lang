import React, { useState } from "react";
import { Dialog } from "./Dialog";
import ProfileManager from "./ProfileManager";
import { SettingCorrection } from "./SettingCorrection";
import { SettingGeneral } from "./SettingGeneral";
import { SettingGlobalPrompt } from "./SettingGlobalPrompt";
import { SettingKeyBinding } from "./SettingKeyBinding";
import { SettingPromptGen } from "./SettingPromptGen";
import { SettingTranslate } from "./SettingTranslate";
import { Tab } from "./Tab";
import type { TabItem } from "./Tab";

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
  /** Initial active tab: 0=Profiles,1=General,2=KeyBindings,... */
  initialTab?: number;
  /** Callback when overlay is clicked */
  onOverlayClick?: () => void;
};

/**
 * Settings modal — dark-native sheet wrapping all settings panels.
 * Uses the Dialog + Tab primitives for consistent macOS styling.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 0,
  onOverlayClick,
}) => {
  const tabs: SettingsTab[] = [
    {
      id: "profiles",
      label: "Profiles",
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          className="size-full"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
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
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          className="size-full"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
      component: <SettingGeneral />,
    },
    {
      id: "keybindings",
      label: "Key Bindings",
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          className="size-full"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
          />
        </svg>
      ),
      component: <SettingKeyBinding />,
    },
    {
      id: "global-prompt",
      label: "Global Prompts",
      icon: null,
      component: <SettingGlobalPrompt />,
    },
    {
      id: "correction",
      label: "Correction",
      icon: null,
      component: <SettingCorrection />,
    },
    {
      id: "translate",
      label: "Translate",
      icon: null,
      component: <SettingTranslate />,
    },
    {
      id: "promptGen",
      label: "PromptGen",
      icon: null,
      component: <SettingPromptGen />,
    },
  ];

  const [activeIndex, setActiveIndex] = useState<number>(initialTab);

  const tabItems: TabItem[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon ?? undefined,
  }));

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      onOverlayClick={onOverlayClick}
      title="Settings"
      widthClassName="w-3/4 max-w-[800px]"
      maxHeightClassName="h-[85vh] min-h-[480px] max-h-[1000px]"
    >
      {/* Tab navigation */}
      <div className="mb-4">
        <Tab
          tabs={tabItems}
          activeId={tabs[activeIndex]?.id ?? tabs[0].id}
          onSelect={(id) => {
            const idx = tabs.findIndex((t) => t.id === id);
            if (idx !== -1) setActiveIndex(idx);
          }}
        />
      </div>

      {/* Tab panels */}
      {tabs.map((tab, index) =>
        activeIndex === index ? (
          <div
            key={tab.id}
            id={`tabpanel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab.id}`}
            tabIndex={0}
          >
            {tab.component}
          </div>
        ) : null,
      )}
    </Dialog>
  );
};
