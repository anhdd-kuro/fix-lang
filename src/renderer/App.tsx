import React, { useState, useEffect } from "react";
import SettingsModal from "./components/SettingsModal"; // Import the modal component

type AppProps = {};

// Simple Gear SVG Icon Component
const GearIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
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

const App: React.FC<AppProps> = () => {
  // State to hold the text
  const [originalText, setOriginalText] = useState<string>("");
  const [fixedText, setFixedText] = useState<string>("");
  // State to control settings modal visibility
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Listen for text updates from the main process via preload script
  useEffect(() => {
    // Check if the API is available (it should be in Electron context)
    if (window.electronAPI?.onUpdateText) {
      console.log("Renderer: Setting up IPC listener for text updates...");
      // Register the callback and get the cleanup function
      const removeListener = window.electronAPI.onUpdateText(
        ({ original, fixed }) => {
          console.log("Renderer: Received text update via IPC:");
          console.log("Original:", original);
          console.log("Fixed:", fixed);
          setOriginalText(original);
          setFixedText(fixed);
        }
      );

      // Cleanup function to remove the listener when the component unmounts
      return () => {
        console.log("Renderer: Cleaning up IPC listener.");
        removeListener();
      };
    } else {
      console.warn(
        "Renderer: window.electronAPI.onUpdateText is not available. IPC setup skipped."
      );
      // Handle cases where the app might run outside Electron or preload fails
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 font-sans flex flex-col">
      {/* Header with Settings Button */}
      <div className="flex justify-between items-center mb-6">
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
        <div>
          <label
            htmlFor="originalText"
            className="block text-sm font-medium text-gray-400 mb-2"
          >
            Original Text
          </label>
          <textarea
            id="originalText"
            rows={10}
            className="w-full p-3 bg-gray-800 border border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-100 resize-none"
            placeholder="Text before correction appears here..."
            value={originalText}
            readOnly // For now, make it read-only until interaction logic is added
          />
        </div>

        {/* Fixed Text Area */}
        <div>
          <label
            htmlFor="fixedText"
            className="block text-sm font-medium text-gray-400 mb-2"
          >
            Corrected Text
          </label>
          <textarea
            id="fixedText"
            rows={10}
            className="w-full p-3 bg-gray-800 border border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-100 resize-none"
            placeholder="Corrected text appears here..."
            value={fixedText}
            readOnly // For now, make it read-only
          />
        </div>
      </div>
      {/* TODO: Add buttons for actions like Retry, Accept, etc. */}
      {/* Settings Modal - Rendered conditionally */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
