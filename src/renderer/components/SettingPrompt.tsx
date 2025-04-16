import React from "react";

/**
 * Prompt settings tab for managing custom prompts.
 */
export const SettingPrompt: React.FC = () => (
  <div>
    <h3 className="text-lg font-medium text-gray-300 mb-2">Custom Prompts</h3>
    <p className="text-sm text-gray-400 mb-4">
      Manage and select different system prompts for OpenAI.
      <br />
      <span className="italic text-gray-500">(Prompt management UI coming soon)</span>
    </p>
    {/* Minimal stub for prompt UI, ready for future expansion */}
    <input
      type="text"
      className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Enter custom prompt..."
      aria-label="Custom prompt input"
      disabled
    />
  </div>
);
