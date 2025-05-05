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
      _event: Electron.IpcMainInvokeEvent,
      options: Electron.MessageBoxOptions
    ) => {
      try {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
          throw new Error("Main window not found");
        }
        return await dialog.showMessageBox(mainWindow, options);
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

  // Show main window with settings open
  ipcMain.on("show-main-window-settings", (_event: Electron.IpcMainEvent) => {
    try {
      const mainWindow = getMainWindow();

      if (mainWindow && !mainWindow.isDestroyed()) {
        // Window exists, show and focus it
        mainWindow.show();
        mainWindow.focus();
        // Send event to open settings tab
        mainWindow.webContents.send("open-settings");
        return;
      }

      // Check if there's another main window not tracked by the singleton
      const newMainWindow = BrowserWindow.getAllWindows().find((win) => {
        return win.webContents.getURL().includes("MainWindow");
      });

      if (newMainWindow) {
        newMainWindow.show();
        newMainWindow.focus();
        newMainWindow.webContents.send("open-settings");
        return;
      }

      // No window exists, need to create a new main window
      console.log("No main window found, creating a new one");

      // Use the imported createMainWindow function

      // Create a new main window
      const createdWindow = createMainWindow();

      // Wait for the window to finish loading before sending the settings event
      createdWindow.webContents.once("did-finish-load", () => {
        createdWindow.show();
        createdWindow.focus();
        createdWindow.webContents.send("open-settings");
      });
    } catch (error) {
      console.error("Error showing main window with settings:", error);
    }
  });

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
