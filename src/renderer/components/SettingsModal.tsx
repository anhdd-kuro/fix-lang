import React, { useState } from "react";
import { SettingCorrect } from "./SettingCorrect";
import { SettingGeneral } from "./SettingGeneral";
import { SettingKeyBinding } from "./SettingKeyBinding";
import { SettingPrompt } from "./SettingPrompt";
import { SettingPromptGen } from "./SettingPromptGen";
import { SettingSummarize } from "./SettingSummarize";
import { SettingTabBtn } from "./SettingTabBtn";
import { SettingTranslate } from "./SettingTranslate";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Initial active tab: 0=General,1=KeyBindings,2=Prompt */
  initialTab?: number;
  /** Callback when overlay is clicked */
  onOverlayClick?: () => void;
};

/**
 * A modal component for application settings.
 * Contains tabs for different settings categories.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 0,
  onOverlayClick,
}) => {
  // Tab state: 0=General, 1=Key Bindings, 2=Prompt
  const [activeTab, setActiveTab] = useState<number>(initialTab);
  const handleClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (e.target === e.currentTarget) {
      onOverlayClick?.();
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm bg-opacity-50 flex justify-center items-center z-50"
      onClick={handleClick}
    >
      <div className="flex flex-col bg-gray-800 p-6 rounded-lg shadow-xl w-3/4 max-w-200 h-[85vh] min-h-120 max-h-250 overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-blue-300">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 text-2xl font-bold"
            aria-label="Close settings modal"
            title="Close settings modal"
          >
            &times;
          </button>
        </div>

        {/* Tab Navigation (DaisyUI/Tailwind) */}
        <div className="mb-6">
          <div
            role="tablist"
            className="grid grid-cols-5 gap-x-4 gap-y-2 w-full rounded-lg p-1"
          >
            <SettingTabBtn
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
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
              }
              label="General"
              active={activeTab === 0}
              ariaControls="settings-general"
              tabIndex={0}
              id="tab-general"
              onClick={() => setActiveTab(0)}
            />
            <SettingTabBtn
              icon={
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
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
              }
              label="Key Bindings"
              active={activeTab === 1}
              ariaControls="settings-keybindings"
              tabIndex={1}
              id="tab-keybindings"
              onClick={() => setActiveTab(1)}
            />
            <SettingTabBtn
              icon={<></>}
              label="Global Prompts"
              active={activeTab === 2}
              ariaControls="settings-prompt"
              tabIndex={2}
              id="tab-prompt"
              onClick={() => setActiveTab(2)}
            />
            <SettingTabBtn
              icon={<></>}
              label="Correct"
              active={activeTab === 3}
              ariaControls="settings-correct"
              tabIndex={3}
              id="tab-correct"
              onClick={() => setActiveTab(3)}
            />
            <SettingTabBtn
              icon={<></>}
              label="Summarize"
              active={activeTab === 4}
              ariaControls="settings-summarize"
              tabIndex={4}
              id="tab-summarize"
              onClick={() => setActiveTab(4)}
            />
            <SettingTabBtn
              icon={<></>}
              label="Translate"
              active={activeTab === 5}
              ariaControls="settings-translate"
              tabIndex={5}
              id="tab-translate"
              onClick={() => setActiveTab(5)}
            />
            <SettingTabBtn
              icon={<></>}
              label="PromptGen"
              active={activeTab === 6}
              ariaControls="settings-promptgen"
              tabIndex={6}
              id="tab-promptgen"
              onClick={() => setActiveTab(6)}
            />
          </div>
        </div>

        {/* Tab Panels */}
        <div className="flex-1 flex flex-col">
          {activeTab === 0 && (
            <div
              id="settings-general"
              role="tabpanel"
              aria-labelledby="tab-general"
            >
              <SettingGeneral />
            </div>
          )}
          {activeTab === 1 && (
            <div
              id="settings-keybindings"
              role="tabpanel"
              aria-labelledby="tab-keybindings"
            >
              <SettingKeyBinding />
            </div>
          )}
          {activeTab === 2 && (
            <div
              id="settings-prompt"
              role="tabpanel"
              aria-labelledby="tab-prompt"
            >
              <SettingPrompt />
            </div>
          )}
          {activeTab === 3 && (
            <div
              id="settings-correct"
              role="tabpanel"
              aria-labelledby="tab-correct"
            >
              <SettingCorrect />
            </div>
          )}
          {activeTab === 4 && (
            <div
              id="settings-summarize"
              role="tabpanel"
              aria-labelledby="tab-summarize"
            >
              <SettingSummarize />
            </div>
          )}
          {activeTab === 5 && (
            <div
              id="settings-translate"
              role="tabpanel"
              aria-labelledby="tab-translate"
            >
              <SettingTranslate />
            </div>
          )}
          {activeTab === 6 && (
            <div
              id="settings-promptgen"
              role="tabpanel"
              aria-labelledby="tab-promptgen"
            >
              <SettingPromptGen />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
