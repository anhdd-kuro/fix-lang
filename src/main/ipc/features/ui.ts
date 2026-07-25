/**
 * @file ui.ts
 * @description IPC handlers for UI-related functionality
 */
import {
  ipcMain,
  app,
  BrowserWindow,
  clipboard,
  dialog,
  shell,
} from "electron";
import {
  getMainWindow,
  createMainWindow,
} from "../../webViewWindows/mainWindow";

/**
 * Registers UI-related IPC handlers
 */

/**
 * Focuses or creates the main window, then runs a callback once it is ready.
 */
const withMainWindow = (onReady: (win: BrowserWindow) => void): void => {
  try {
    const mainWindow = getMainWindow();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      onReady(mainWindow);
      return;
    }

    const existingWindow = BrowserWindow.getAllWindows().find((win) => {
      return win.webContents.getURL().includes("MainWindow");
    });

    if (existingWindow) {
      existingWindow.show();
      existingWindow.focus();
      onReady(existingWindow);
      return;
    }

    console.log("No main window found, creating a new one");
    const createdWindow = createMainWindow();
    createdWindow.webContents.once("did-finish-load", () => {
      createdWindow.show();
      createdWindow.focus();
      onReady(createdWindow);
    });
  } catch (error) {
    console.error("Error showing main window:", error);
  }
};

export const registerUiHandlers = () => {
  // App control handlers
  ipcMain.on("quit-app", (_event: Electron.IpcMainEvent) => {
    app.quit();
  });

  ipcMain.on("minimize-window", (_event: Electron.IpcMainEvent) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  ipcMain.on("toggle-maximize-window", (_event: Electron.IpcMainEvent) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on("close-window", (_event: Electron.IpcMainEvent) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.close();
    }
  });

  // Get app version
  ipcMain.handle("get-app-version", (_event: Electron.IpcMainInvokeEvent) => {
    return app.getVersion();
  });

  // Clipboard handlers
  ipcMain.handle(
    "get-clipboard-text",
    async (_event: Electron.IpcMainInvokeEvent) => {
      try {
        return clipboard.readText();
      } catch (error) {
        console.error("Error reading clipboard:", error);
        return "";
      }
    }
  );

  ipcMain.handle(
    "set-clipboard-text",
    async (_event: Electron.IpcMainInvokeEvent, text: string) => {
      try {
        clipboard.writeText(text);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Dialog handlers
  ipcMain.handle(
    "show-message-box",
    async (
      event: Electron.IpcMainInvokeEvent,
      options: Electron.MessageBoxOptions
    ) => {
      try {
        const parentWindow =
          BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
        if (!parentWindow) {
          throw new Error("Parent window not found");
        }
        return await dialog.showMessageBox(parentWindow, options);
      } catch (error) {
        console.error("Error showing message box:", error);
        return { response: 0, checkboxChecked: false };
      }
    }
  );

  // External links
  ipcMain.handle(
    "open-external-link",
    async (_event: Electron.IpcMainInvokeEvent, url: string) => {
      try {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { success: false, error: "Unsupported URL scheme" };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { success: false, error: "Unsupported URL scheme" };
        }
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Window handling
  ipcMain.handle(
    "get-current-window-id",
    (_event: Electron.IpcMainInvokeEvent) => {
      try {
        const webContents = _event.sender;
        const win = BrowserWindow.fromWebContents(webContents);
        return win?.id;
      } catch (error) {
        console.error("Error getting window ID:", error);
        return null;
      }
    }
  );

  ipcMain.on("restart-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on("show-main-window-settings", (_event: Electron.IpcMainEvent) => {
    withMainWindow((win) => {
      win.webContents.send("open-settings");
    });
  });

  ipcMain.on(
    "show-main-window-tab",
    (_event: Electron.IpcMainEvent, tabId: string) => {
      withMainWindow((win) => {
        win.webContents.send("open-dashboard-tab", tabId);
      });
    }
  );

  ipcMain.handle("close-current-window", (_event) => {
    try {
      const webContents = _event.sender;
      const win = BrowserWindow.fromWebContents(webContents);
      if (win) {
        win.close();
        return { success: true };
      }
      return { success: false, error: "Window not found" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
};
