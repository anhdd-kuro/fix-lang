/**
 * @file tray.ts
 * @description Tray icon, menu, and related logic for FixLang.
 */
import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import appIcon from "../../../resources/icon-16.png?asset";
import { getMainWindow } from "./mainWindow";

let appTray: Tray | null = null;
let trayMenu: Menu | null = null;

export const buildTrayMenu = (): Electron.Menu =>
  Menu.buildFromTemplate([
    {
      label: "Open Settings",
      click: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("open-settings");
      },
    },
    {
      label: "Quick Review Last Correction",
      click: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("quick-review");
      },
    },
    { type: "separator" },
    {
      label: "Quick Settings",
      submenu: [
        {
          label: "Tone",
          click: () =>
            BrowserWindow.getAllWindows()[0]?.webContents.send(
              "quick-setting",
              "tone"
            ),
        },
        {
          label: "Model",
          click: () =>
            BrowserWindow.getAllWindows()[0]?.webContents.send(
              "quick-setting",
              "model"
            ),
        },
        {
          label: "Prompt",
          click: () =>
            BrowserWindow.getAllWindows()[0]?.webContents.send(
              "quick-setting",
              "prompt"
            ),
        },
      ],
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

export const updateTrayMenu = () => {
  if (appTray) {
    trayMenu = buildTrayMenu();
    appTray.setContextMenu(trayMenu);
  }
};

export const setupTray = () => {
  try {
    const trayIcon = nativeImage.createFromPath(appIcon);
    appTray = new Tray(trayIcon);
    appTray.setToolTip("FixLang");
    updateTrayMenu();
    appTray.on("click", () => {
      const mainWindow = getMainWindow();
      if (mainWindow)
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
  } catch (err) {
    console.error("Failed to initialize app tray:", err);
  }
};
