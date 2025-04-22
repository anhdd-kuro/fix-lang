// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge } from "electron";
import {
  apiFeature,
  correctionFeature,
  translationFeature,
  summarizationFeature,
  promptGenFeature,
  settingsFeature,
  uiFeature,
} from "./features";
import type { ElectronAPI } from "./preload-api.types";

// Log that preload script is being executed
console.log("Preload script is being executed");

// Expose a controlled API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  ...apiFeature,
  ...correctionFeature,
  ...translationFeature,
  ...summarizationFeature,
  ...promptGenFeature,
  ...settingsFeature,
  ...uiFeature,
} satisfies ElectronAPI);

console.log(
  "Preload script executed and electronAPI exposed with the following methods:"
);
console.log(Object.keys(window.electronAPI).join("\n"));
