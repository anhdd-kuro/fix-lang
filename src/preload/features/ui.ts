// UI-related preload functionality
import { ipcRenderer } from "electron";

/**
 * Exposes UI-related functionality to the renderer process
 */
export const uiFeature = {
  /**
   * Registers a callback for the 'start-loading' event from main process.
   * Shows the global spinner overlay when triggered.
   */
  onStartLoading: (callback: () => void) => {
    const listener = () => {
      ipcRenderer.send("show-spinner");
      callback();
    };
    ipcRenderer.on("start-loading", listener);
    return () => {
      ipcRenderer.removeListener("start-loading", listener);
      console.log("Preload: Removed start-loading listener.");
    };
  },

  /**
   * Registers a callback for the 'stop-loading' event from main process.
   * Hides the global spinner overlay when triggered.
   */
  onStopLoading: (callback: () => void) => {
    const listener = () => {
      ipcRenderer.send("hide-spinner");
      callback();
    };
    ipcRenderer.on("stop-loading", listener);
    return () => {
      ipcRenderer.removeListener("stop-loading", listener);
      console.log("Preload: Removed stop-loading listener.");
    };
  },

  /**
   * Registers a callback for opening the main settings modal.
   */
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-settings", listener);
    return () => {
      ipcRenderer.removeListener("open-settings", listener);
    };
  },

  /**
   * Registers a callback for "open-model-dialog" events.
   */
  onOpenModelDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-model-dialog", listener);
    return () => {
      ipcRenderer.removeListener("open-model-dialog", listener);
    };
  },

  /**
   * Registers a callback for "refresh-models" events.
   */
  onRefreshModels: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("refresh-models", listener);
    return () => {
      ipcRenderer.removeListener("refresh-models", listener);
    };
  },

  /**
   * Registers a callback for opening keybindings dialog.
   */
  onOpenKeybindingsDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-keybindings-dialog", listener);
    return () => {
      ipcRenderer.removeListener("open-keybindings-dialog", listener);
    };
  },

  /**
   * Registers a callback for opening prompt settings dialog.
   */
  onOpenPromptDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-prompt-dialog", listener);
    return () => {
      ipcRenderer.removeListener("open-prompt-dialog", listener);
    };
  },

  /**
   * Registers a callback for opening history dialog.
   */
  onOpenHistoryDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-history-dialog", listener);
    return () => {
      ipcRenderer.removeListener("open-history-dialog", listener);
    };
  },

  /**
   * Registers a callback for the 'tray-open' event with view and initialTab.
   */
  onTrayOpen: (
    callback: (args: { view: string; initialTab?: number }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      args: { view: string; initialTab?: number }
    ) => callback(args);
    ipcRenderer.on("tray-open", listener);
    return () => {
      ipcRenderer.removeListener("tray-open", listener);
    };
  },

  /**
   * Hides the tray window.
   */
  hideTray: (): void => {
    ipcRenderer.send("hide-tray");
  },

  /**
   * Copies given text to clipboard.
   */
  copyToClipboard: (text: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("copy-to-clipboard", text);
  },

  /**
   * Quits the application
   */
  quitApp: (): void => {
    ipcRenderer.send("quit-app");
  },

  /**
   * Shows the main window with settings tab open
   */
  showMainWindowSettings: (): void => {
    ipcRenderer.send("show-main-window-settings");
  },
};

export type UIFeature = typeof uiFeature;
