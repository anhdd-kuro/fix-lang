// electron.d.ts

// Define the shape of the data expected from the main process
type TextUpdatePayload = {
  original: string;
  fixed: string;
};

// Define the shape for key bindings configuration globally
type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

// Extend the global Window interface
declare global {
  interface Window {
    // Define the structure of the API exposed by the preload script
    electronAPI: {
      /**
       * Registers a callback function to be executed when the 'update-text' IPC message
       * is received from the main process.
       * @param callback The function to call with the received text payload.
       * @returns A cleanup function to remove the IPC listener.
       */
      onUpdateText: (callback: (payload: TextUpdatePayload) => void) => () => void;
      /**
       * Fetches the stored OpenAI API key from the main process.
       * @returns A promise resolving to the API key string.
       */
      getApiKey: () => Promise<string>;

      /**
       * Stores the provided OpenAI API key in the main process.
       * @param apiKey The API key to store.
       * @returns A promise resolving to an object indicating success/failure.
       */
      setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

      /**
       * Fetches the stored key bindings object from the main process.
       * @returns A promise resolving to the KeyBindings object.
       */
      getKeyBindings: () => Promise<KeyBindings>;

      /**
       * Stores the provided key bindings object in the main process.
       * @param bindings The KeyBindings object to store.
       * @returns A promise resolving to an object indicating success/failure.
       */
      setKeyBindings: (bindings: KeyBindings) => Promise<{ success: boolean; error?: string }>;
      // Add other exposed functions here if needed
    };
  }
}

// This export statement makes the file a module, which is necessary for global declarations
export {};
