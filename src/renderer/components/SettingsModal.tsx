import React, { useState, useEffect } from 'react';

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
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [keyBindingsStatus, setKeyBindingsStatus] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<string>(''); // For feedback

  // Fetch API Key and Key Bindings when modal opens
  useEffect(() => {
    if (isOpen) {
      setSaveStatus(''); // Clear status on open
      setKeyBindingsStatus(''); // Clear key binding status
      console.log('SettingsModal: Fetching API key and Key Bindings...');

      // Fetch API Key
      window.electronAPI?.getApiKey()
        .then(key => {
          console.log(`SettingsModal: Received key (length: ${key?.length ?? 0})`);
          setApiKeyInput(key || ''); // Set input value, default to empty string
        })
        .catch(error => {
          console.error('SettingsModal: Error fetching API key:', error);
          setSaveStatus('Error fetching key');
        });

      // Fetch Key Bindings
      window.electronAPI?.getKeyBindings()
        .then(bindings => {
          console.log('SettingsModal: Received key bindings:', bindings);
          setKeyBindings(bindings);
        })
        .catch(error => {
          console.error('SettingsModal: Error fetching key bindings:', error);
          // Handle error appropriately, maybe show a message
        });
    }
  }, [isOpen]); // Dependency array includes isOpen

  // Handle changes to the input field
  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(event.target.value);
    setSaveStatus(''); // Clear status on change
  };

  // Handle saving the API Key when the input loses focus
  const handleApiKeyBlur = async () => {
    if (!window.electronAPI?.setApiKey) {
      console.error('setApiKey function not available on electronAPI');
      setSaveStatus('Error: Cannot save key');
      return;
    }
    // Only save if the input has a value (or allow clearing)
    console.log(`SettingsModal: Attempting to save API key (length: ${apiKeyInput.length})`);
    setSaveStatus('Saving...');
    try {
      const result = await window.electronAPI.setApiKey(apiKeyInput);
      if (result.success) {
        console.log('SettingsModal: API Key saved successfully.');
        setSaveStatus('Saved!');
      } else {
        console.error('SettingsModal: Failed to save API Key:', result.error);
        setSaveStatus(`Error: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('SettingsModal: Error calling setApiKey:', error);
      setSaveStatus('Error saving key');
    }
  };

  // Handle changes to key binding inputs
  const handleKeyBindingChange = (event: React.ChangeEvent<HTMLInputElement>, action: keyof KeyBindings) => {
    const newValue = event.target.value;
    setKeyBindings(prev => (prev ? { ...prev, [action]: newValue } : null));
    setKeyBindingsStatus(''); // Clear status on change
  };

  // Handle saving key bindings when an input loses focus
  const handleKeyBindingBlur = async () => {
    if (!keyBindings) {
      console.error('Cannot save null key bindings');
      setKeyBindingsStatus('Error: No bindings loaded');
      return;
    }
    if (!window.electronAPI?.setKeyBindings) {
      console.error('setKeyBindings function not available on electronAPI');
      setKeyBindingsStatus('Error: Cannot save bindings');
      return;
    }
    
    // TODO: Add validation for Electron Accelerator format before saving
    console.log('SettingsModal: Attempting to save key bindings:', keyBindings);
    setKeyBindingsStatus('Saving...');
    try {
      const result = await window.electronAPI.setKeyBindings(keyBindings);
      if (result.success) {
        console.log('SettingsModal: Key bindings saved successfully.');
        setKeyBindingsStatus('Saved! Restart required.');
      } else {
        console.error('SettingsModal: Failed to save key bindings:', result.error);
        setKeyBindingsStatus(`Error: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('SettingsModal: Error calling setKeyBindings:', error);
      setKeyBindingsStatus('Error saving bindings');
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
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-300 mb-1">
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
              Stored securely. Used for OpenAI requests. <span className="text-blue-400 font-medium">{saveStatus}</span>
            </p>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">Key Bindings</h3>
            <p className="text-sm text-gray-400">
              Fix: <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Ctrl</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Shift</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">F</kbd>
            </p>
            <p className="text-sm text-gray-400">
              Undo: <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Ctrl</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Shift</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Z</kbd>
            </p>
            <p className="text-sm text-gray-400">
              Retry: <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Ctrl</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">Shift</kbd> + <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">A</kbd>
            </p>
            {/* TODO: Add functionality to change key bindings */}
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">Custom Prompts</h3>
            <p className="text-sm text-gray-400">Manage and select different system prompts for OpenAI.</p>
            {/* TODO: Add prompt management UI */}
          </div>

          {/* --- Key Bindings --- */}
          <div>
            <h4 className="text-lg font-semibold text-gray-100 mb-3">Key Bindings</h4>
            {keyBindings ? (
              <>
                <div className="mb-3">
                  <label htmlFor="fixBinding" className="block text-sm font-medium text-gray-300 mb-1">Fix Grammar</label>
                  <input
                    type="text"
                    id="fixBinding"
                    value={keyBindings.fix}
                    onChange={(e) => handleKeyBindingChange(e, 'fix')}
                    onBlur={handleKeyBindingBlur}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="Control+Shift+F"
                  />
                </div>
                <div className="mb-3">
                  <label htmlFor="undoBinding" className="block text-sm font-medium text-gray-300 mb-1">Undo Last Fix</label>
                  <input
                    type="text"
                    id="undoBinding"
                    value={keyBindings.undo}
                    onChange={(e) => handleKeyBindingChange(e, 'undo')}
                    onBlur={handleKeyBindingBlur}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="Control+Shift+Z"
                  />
                </div>
                <div className="mb-3">
                  <label htmlFor="retryBinding" className="block text-sm font-medium text-gray-300 mb-1">Retry Last Fix</label>
                  <input
                    type="text"
                    id="retryBinding"
                    value={keyBindings.retry}
                    onChange={(e) => handleKeyBindingChange(e, 'retry')}
                    onBlur={handleKeyBindingBlur}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="Control+Shift+A"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Loading bindings...</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Changes require an app restart. <span className="text-blue-400 font-medium">{keyBindingsStatus}</span>
            </p>
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
