/**
 * @file window.ts
 * @description Main window creation/config for FixLang.
 */
import { BrowserWindow } from "electron";
import path from "node:path";

export const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "../../out/preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5175");
    mainWindow.webContents.openDevTools();
  } else {
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    mainWindow.loadFile(rendererPath);
  }

  return mainWindow;
};
