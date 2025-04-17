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

// Version entry type for history
type VersionEntry = {
  original: string;
  corrected: string;
  timestamp: string;
};

/**
 * Main App component for FixLang Preview UI.
 * Handles API call loading spinner near the mouse, settings modal, and text display.
 */
const App: React.FC = () => {
  // History of past corrections
  const [history, setHistory] = useState<VersionEntry[]>([]);
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
  // History panel visibility
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);

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

  // Fetch history on mount and when fixedText changes
  useEffect(() => {
    window.electronAPI
      .getHistory()
      .then((h) => setHistory(h))
      .catch((e) => console.error("Failed to load history", e));
  }, [fixedText]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex">
      {/* Sidebar history panel */}
      <aside
        className={`flex flex-col bg-gray-800 border-r border-gray-700 h-screen relative transform transition-all duration-300 ease-in-out group *:transition-opacity *:duration-300 ${historyOpen ? "p-4 translate-x-0 w-64 " : "-translate-x-full w-0 overflow-hidden px-0 py-4 *:opacity-0"}`}
      >
        <div className="flex justify-between items-center mb-2 sticky top-0 bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-200">History</h2>
          {/* Close button (visible on hover) */}
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="absolute right-0 py-2 px-4 bg-gray-700 text-gray-200 hover:bg-gray-600 rounded-lg transition-opacity duration-200"
            aria-label="Close history panel"
          >
            &larr;
          </button>
        </div>
        <ul className="divide-y divide-gray-700 flex-1 overflow-y-auto">
          {history.map((entry, idx) => (
            <li
              key={idx}
              className="py-2 hover:bg-gray-700 cursor-pointer px-2"
              onClick={() => {
                setOriginalText(entry.original);
                setFixedText(entry.corrected);
              }}
            >
              <div className="text-sm text-gray-400">
                {new Date(entry.timestamp).toLocaleString()}
              </div>
              <div className="text-sm text-gray-100">
                {entry.original.slice(0, 50)}...
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            window.electronAPI.clearHistory().then(() => setHistory([]))
          }
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-600 ml-auto mt-4 justify-end"
        >
          <svg
            shapeRendering="geometricPrecision"
            textRendering="geometricPrecision"
            imageRendering="optimizeQuality"
            fillRule="evenodd"
            clipRule="evenodd"
            viewBox="0 0 456 511.82"
            className="size-4"
          >
            <title>Trash icon</title>
            <path
              fill="#FD3B3B"
              d="M48.42 140.13h361.99c17.36 0 29.82 9.78 28.08 28.17l-30.73 317.1c-1.23 13.36-8.99 26.42-25.3 26.42H76.34c-13.63-.73-23.74-9.75-25.09-24.14L20.79 168.99c-1.74-18.38 9.75-28.86 27.63-28.86zM24.49 38.15h136.47V28.1c0-15.94 10.2-28.1 27.02-28.1h81.28c17.3 0 27.65 11.77 27.65 28.01v10.14h138.66c.57 0 1.11.07 1.68.13 10.23.93 18.15 9.02 18.69 19.22.03.79.06 1.39.06 2.17v42.76c0 5.99-4.73 10.89-10.62 11.19-.54 0-1.09.03-1.63.03H11.22c-5.92 0-10.77-4.6-11.19-10.38 0-.72-.03-1.47-.03-2.23v-39.5c0-10.93 4.21-20.71 16.82-23.02 2.53-.45 5.09-.37 7.67-.37zm83.78 208.38c-.51-10.17 8.21-18.83 19.53-19.31 11.31-.49 20.94 7.4 21.45 17.57l8.7 160.62c.51 10.18-8.22 18.84-19.53 19.32-11.32.48-20.94-7.4-21.46-17.57l-8.69-160.63zm201.7-1.74c.51-10.17 10.14-18.06 21.45-17.57 11.32.48 20.04 9.14 19.53 19.31l-8.66 160.63c-.52 10.17-10.14 18.05-21.46 17.57-11.31-.48-20.04-9.14-19.53-19.32l8.67-160.62zm-102.94.87c0-10.23 9.23-18.53 20.58-18.53 11.34 0 20.58 8.3 20.58 18.53v160.63c0 10.23-9.24 18.53-20.58 18.53-11.35 0-20.58-8.3-20.58-18.53V245.66z"
            />
          </svg>
          Clear
        </button>
      </aside>
      {/* Main content area */}
      <main className="flex-1 p-6 flex flex-col relative">
        {/* Open history panel button */}
        {!historyOpen && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="absolute left-4 top-4 p-2 px-4 text-gray-400 hover:text-white rounded-lg bg-gray-700"
            aria-label="Open history panel"
          >
            &rarr;
          </button>
        )}
        {/* Header with Settings Button */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-blue-400 text-center">
            FixLang Preview
          </h1>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="absolute right-4 top-4 p-2 text-gray-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-full"
            aria-label="Open settings"
            title="Open settings"
          >
            <GearIcon />
          </button>
        </div>

        {/* Text Areas */}
        <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-10">
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
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </main>
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
