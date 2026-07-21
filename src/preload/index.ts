// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge } from "electron";
import {
  apiFeature,
  correctionFeature,
  correctionResultFeature,
  logsFeature,
  promptGenFeature,
  profilesFeature,
  settingsFeature,
  themeFeature,
  uiFeature,
  historyFeature,
  openrouterFeature,
  updateFeature,
} from "./features";
import type {
  ApiFeature,
  CorrectionFeature,
  CorrectionResultFeature,
  HistoryFeature,
  LogsFeature,
  OpenRouterFeature,
  ProfilesFeature,
  PromptGenFeature,
  SettingsFeature,
  ThemeFeature,
  UIFeature,
  UpdateFeature,
} from "./features";

// Log that preload script is being executed
console.log("Preload script is being executed");

// Expose a controlled API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  ...historyFeature,
  ...apiFeature,
  ...correctionFeature,
  ...correctionResultFeature,
  ...logsFeature,
  ...promptGenFeature,
  ...profilesFeature,
  ...settingsFeature,
  ...themeFeature,
  ...uiFeature,
  ...openrouterFeature,
  ...updateFeature,
} satisfies ElectronAPI);

console.log(
  "Preload script executed and electronAPI exposed with the following methods:",
);

export type ElectronAPI = HistoryFeature &
  PromptGenFeature &
  CorrectionFeature &
  CorrectionResultFeature &
  ApiFeature &
  LogsFeature &
  ProfilesFeature &
  SettingsFeature &
  ThemeFeature &
  UIFeature &
  OpenRouterFeature &
  UpdateFeature;
