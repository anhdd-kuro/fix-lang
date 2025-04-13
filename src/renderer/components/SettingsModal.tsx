import React, { useState, useEffect } from "react";
import { KeyBinding } from "./KeyBinding";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

/**
 * A modal component for application settings.
 * Allows setting the OpenAI API Key.
 */
const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // State for the API Key input field
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [keyBindingsStatus, setKeyBindingsStatus] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>(""); // For feedback

  // Check if electronAPI is available
  useEffect(() => {
    // Check if electronAPI is available in the window object
    if (!window.electronAPI) {
      console.error("electronAPI is not available in window object");
      setSaveStatus("Error: API not available. App may need to be restarted.");
    } else {
      console.log(
        "electronAPI is available with methods:",
        Object.keys(window.electronAPI)
      );

      // Check if specific methods exist
      if (!window.electronAPI.getApiKey) {
        console.error("getApiKey method is missing from electronAPI");
      }
      if (!window.electronAPI.setApiKey) {
        console.error("setApiKey method is missing from electronAPI");
      }
    }
  }, []);

  // Fetch API Key and Key Bindings when modal opens
  useEffect(() => {
    if (isOpen) {
      setSaveStatus(""); // Clear status on open
      setKeyBindingsStatus(""); // Clear key binding status
      console.log("SettingsModal: Fetching API key and Key Bindings...");

      // Fetch API Key
      window.electronAPI
        ?.getApiKey()
        .then((key) => {
          console.log(
            `SettingsModal: Received key (length: ${key?.length ?? 0})`
          );
          setApiKeyInput(key || ""); // Set input value, default to empty string
        })
        .catch((error) => {
          console.error("SettingsModal: Error fetching API key:", error);
          setSaveStatus("Error fetching key");
        });

      // Fetch Key Bindings
      window.electronAPI
        ?.getKeyBindings()
        .then((bindings) => {
          console.log("SettingsModal: Received key bindings:", bindings);
          setKeyBindings(bindings);
        })
        .catch((error) => {
          console.error("SettingsModal: Error fetching key bindings:", error);
          // Handle error appropriately, maybe show a message
        });
    }
  }, [isOpen]); // Dependency array includes isOpen

  // Handle changes to the input field
  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(event.target.value);
    setSaveStatus(""); // Clear status on change
  };

  // Handle saving the API Key when the input loses focus
  const handleApiKeyBlur = async () => {
    if (!window.electronAPI?.setApiKey) {
      console.error("setApiKey function not available on electronAPI");
      setSaveStatus("Error: Cannot save key");
      return;
    }

    // Basic validation
    if (
      apiKeyInput &&
      !apiKeyInput.startsWith("sk-") &&
      apiKeyInput.length > 0
    ) {
      console.warn("API key doesn't start with 'sk-', might not be valid");
      // We'll still try to save it, but warn the user
      setSaveStatus("Warning: Key format may be invalid, but saving anyway...");
    } else {
      setSaveStatus("Saving...");
    }

    console.log(
      `SettingsModal: Attempting to save API key (length: ${apiKeyInput.length})`
    );

    try {
      // Add a small delay to ensure UI updates before the potentially blocking IPC call
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await window.electronAPI.setApiKey(apiKeyInput);

      if (result.success) {
        console.log("SettingsModal: API Key saved successfully.");
        setSaveStatus("Saved!");

        // Verify the key was saved by retrieving it again
        const verifiedKey = await window.electronAPI.getApiKey();
        if (verifiedKey !== apiKeyInput) {
          console.error("SettingsModal: API Key verification failed");
          setSaveStatus("Warning: Key saved but verification failed");
        }
      } else {
        console.error("SettingsModal: Failed to save API Key:", result.error);
        setSaveStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingsModal: Error calling setApiKey:", error);
      setSaveStatus("Error saving key");
    }
  };

  // Handle changes to key binding inputs
  const handleKeyBindingChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    action: keyof KeyBindings
  ) => {
    const newValue = event.target.value;
    setKeyBindings((prev) => (prev ? { ...prev, [action]: newValue } : null));
    setKeyBindingsStatus(""); // Clear status on change
  };

  // Handle saving key bindings when an input loses focus
  const handleKeyBindingBlur = async () => {
    if (!keyBindings) {
      console.error("Cannot save null key bindings");
      setKeyBindingsStatus("Error: No bindings loaded");
      return;
    }
    if (!window.electronAPI?.setKeyBindings) {
      console.error("setKeyBindings function not available on electronAPI");
      setKeyBindingsStatus("Error: Cannot save bindings");
      return;
    }

    // TODO: Add validation for Electron Accelerator format before saving
    console.log("SettingsModal: Attempting to save key bindings:", keyBindings);
    setKeyBindingsStatus("Saving...");
    try {
      const result = await window.electronAPI.setKeyBindings(keyBindings);
      if (result.success) {
        console.log("SettingsModal: Key bindings saved successfully.");
        setKeyBindingsStatus("Saved! Restart required.");
      } else {
        console.error(
          "SettingsModal: Failed to save key bindings:",
          result.error
        );
        setKeyBindingsStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingsModal: Error calling setKeyBindings:", error);
      setKeyBindingsStatus("Error saving bindings");
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md">
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

        {/* Settings Content Goes Here */}
        <div className="space-y-4">
          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              OpenAI API Key
            </label>
            <input
              type="password" // Use password type for sensitive keys
              id="apiKey"
              className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="sk-..."
              value={apiKeyInput} // Bind value to state
              onChange={handleApiKeyChange} // Update state on change
              onBlur={handleApiKeyBlur} // Save on blur
            />
            <p className="text-xs text-gray-500 mt-1">
              Stored securely. Used for OpenAI requests.
              <span className="text-blue-400 font-medium">{saveStatus}</span>
            </p>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-lg font-medium text-gray-300 mb-2">
              Key Bindings
            </h3>
            <KeyBinding
              label="Fix"
              keysBinding={["Control", "Shift", "F"]}
              onChange={(keysBinding) => {
                const newKeyBindings = keysBinding.join("+");
                setKeyBindings((prev) =>
                  prev
                    ? { ...prev, fix: newKeyBindings }
                    : { fix: newKeyBindings, undo: "", retry: "" }
                );
                setKeyBindingsStatus(""); // Clear status on change
              }}
            />
            <KeyBinding
              label="Undo"
              keysBinding={["Control", "Shift", "Z"]}
              onChange={(keysBinding) => {
                const newKeyBindings = keysBinding.join("+");
                setKeyBindings((prev) =>
                  prev
                    ? { ...prev, undo: newKeyBindings }
                    : { undo: newKeyBindings, fix: "", retry: "" }
                );
                setKeyBindingsStatus(""); // Clear status on change
              }}
            />
            <KeyBinding
              label="Retry"
              keysBinding={["Control", "Shift", "A"]}
              onChange={(keysBinding) => {
                const newKeyBindings = keysBinding.join("+");
                setKeyBindings((prev) =>
                  prev
                    ? { ...prev, retry: newKeyBindings }
                    : { retry: newKeyBindings, fix: "", undo: "" }
                );
                setKeyBindingsStatus(""); // Clear status on change
              }}
            />
            {/* TODO: Add functionality to change key bindings */}
          </section>

          <div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">
              Custom Prompts
            </h3>
            <p className="text-sm text-gray-400">
              Manage and select different system prompts for OpenAI.
            </p>
            {/* TODO: Add prompt management UI */}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
