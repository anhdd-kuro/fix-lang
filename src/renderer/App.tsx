import React, { useState, useEffect } from "react";
import CopyButton from "./components/CopyButton";
import { SettingsModal } from "./components/SettingsModal";

// Simple Gear SVG Icon Component
const GearIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/icon.icns"
    className="h-6 w-6"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
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
);

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
const App: React.FC = () => {
  // State for text areas
  const [originalText, setOriginalText] = useState<string>("");
  const [fixedText, setFixedText] = useState<string>("");
  // Token counts for OpenAI usage
  const [promptTokens, setPromptTokens] = useState<number | null>(null);
  const [completionTokens, setCompletionTokens] = useState<number | null>(null);
  // Settings modal visibility
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  // Loading state for API call
  const [_loading, setLoading] = useState<boolean>(false);

  // Listen for text updates from main process via preload script
  useEffect(() => {
    if (window.electronAPI?.onUpdateText) {
      const removeListener = window.electronAPI.onUpdateText(
        ({ original, corrected, promptTokens, completionTokens }) => {
          setOriginalText(original);
          setFixedText(corrected);
          setPromptTokens(promptTokens ?? null);
          setCompletionTokens(completionTokens ?? null);
        }
      );
      return () => removeListener();
    }
  }, []);

  // Error state for IPC issues
  const [error, _setError] = useState<string>("");

  // Listen for IPC events from Electron main/preload
  useEffect(() => {
    // Start loading on shortcut/API call
    const removeStartLoading = window.electronAPI?.onStartLoading?.(() => {
      console.log("Preload: Starting loading...");
      setLoading(true);
    });

    const removeUpdateText = window.electronAPI?.onUpdateText?.(
      ({ original, corrected }) => {
        setOriginalText(original);
        setFixedText(corrected);
        setLoading(false);
      }
    );
    return () => {
      removeStartLoading?.();
      removeUpdateText?.();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 font-sans flex flex-col">
      {/* Header with Settings Button */}
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold text-blue-400">FixLang Preview</h1>
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 text-gray-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-full"
          aria-label="Open settings"
          title="Open settings"
        >
          <GearIcon />
        </button>
      </div>

      {/* Text Areas */}
      <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Original Text Area */}
        <div className="relative">
          <label
            htmlFor="originalText"
            className="block text-sm font-medium text-gray-400 mb-2"
          >
            Original Text
          </label>
          <CopyButton
            value={originalText}
            label="Copy original text"
            className="absolute -top-[1em] right-0 z-10"
          />
          <div className="relative">
            <textarea
              id="originalText"
              rows={10}
              className="w-full pt-2 px-2 pb-4 bg-gray-800 border border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-100 resize-none"
              placeholder="Text before correction appears here..."
              value={originalText}
              readOnly
              aria-label="Original text area"
            />
            {/* Prompt token count display for original text */}
            <TextCount
              textOrCount={promptTokens}
              className="absolute bottom-0 right-0"
              aria-live="polite"
              aria-label="Prompt tokens for original text"
              titleAttribute="Input + Prompt tokens"
            />
          </div>
        </div>

        {/* Fixed Text Area */}
        <div className="relative">
          <label
            htmlFor="fixedText"
            className="block text-sm font-medium text-gray-400 mb-2"
          >
            Corrected Text
          </label>
          <CopyButton
            value={fixedText}
            label="Copy corrected text"
            className="absolute -top-[1em] right-0 z-10"
          />
          <div className="relative">
            <textarea
              id="fixedText"
              rows={10}
              className="w-full pt-2 px-2 pb-4 bg-gray-800 border border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-100 resize-none"
              placeholder="Corrected text appears here..."
              value={fixedText}
              readOnly // For now, make it read-only
              aria-label="Corrected text area"
            />
            {/* Completion token count display for corrected text */}
            <TextCount
              textOrCount={completionTokens}
              className="absolute bottom-0 right-0 "
              aria-live="polite"
              aria-label="Completion tokens for corrected text"
              titleAttribute="Returned from api"
            />
          </div>
        </div>
      </div>
      {/* Error message from IPC, if any */}
      {error && (
        <div className="mt-4 text-red-400 text-center" role="alert">
          {error}
        </div>
      )}

      {/* Settings Modal - Rendered conditionally */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

const TextCount = ({
  textOrCount,
  className,
  label = "Tokens used:",
  titleAttribute,
}: {
  textOrCount: string | number | null;
  className?: string;
  label?: string;
  titleAttribute?: string;
}) => {
  if (textOrCount === null) {
    return null;
  }

  return (
    <span
      className={`text-xs text-gray-400 p-2 rounded-md cursor-help ${className}`}
      aria-live="polite"
      aria-label="Text length"
      title={titleAttribute}
    >
      {label}{" "}
      {typeof textOrCount === "number" ? textOrCount : textOrCount.length}
    </span>
  );
};

export default App;
