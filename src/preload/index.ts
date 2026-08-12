// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge } from "electron";
import {
  apiFeature,
  appearanceFeature,
  askFeature,
  autocompleteFeature,
  autocompleteSettingsFeature,
  correctionFeature,
  correctionResultFeature,
  localeFeature,
  logsFeature,
  openaiUsageFeature,
  promptGenFeature,
  profilesFeature,
  secretGuardFeature,
  selectionGuardsFeature,
  settingsFeature,
  themeFeature,
  uiFeature,
  historyFeature,
  openrouterFeature,
  updateFeature,
} from "~/features/preload";
import type {
  ApiFeature,
  AppearanceFeature,
  AskFeature,
  AutocompleteFeature,
  AutocompleteSettingsFeature,
  CorrectionFeature,
  CorrectionResultFeature,
  HistoryFeature,
  LocaleFeature,
  LogsFeature,
  OpenAIUsageFeature,
  OpenRouterFeature,
  ProfilesFeature,
  PromptGenFeature,
  SecretGuardFeature,
  SelectionGuardsFeature,
  SettingsFeature,
  ThemeFeature,
  UIFeature,
  UpdateFeature,
} from "~/features/preload";

// Log that preload script is being executed
console.log("Preload script is being executed");

// Expose a controlled API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  ...historyFeature,
  ...appearanceFeature,
  ...apiFeature,
  ...askFeature,
  ...autocompleteFeature,
  ...autocompleteSettingsFeature,
  ...correctionFeature,
  ...correctionResultFeature,
  ...localeFeature,
  ...logsFeature,
  ...promptGenFeature,
  ...profilesFeature,
  ...secretGuardFeature,
  ...selectionGuardsFeature,
  ...settingsFeature,
  ...themeFeature,
  ...uiFeature,
  ...openaiUsageFeature,
  ...openrouterFeature,
  ...updateFeature,
} satisfies ElectronAPI);

console.log(
  "Preload script executed and electronAPI exposed with the following methods:",
);

export type ElectronAPI = HistoryFeature &
  AppearanceFeature &
  PromptGenFeature &
  AskFeature &
  AutocompleteFeature &
  AutocompleteSettingsFeature &
  CorrectionFeature &
  CorrectionResultFeature &
  ApiFeature &
  LocaleFeature &
  LogsFeature &
  ProfilesFeature &
  SecretGuardFeature &
  SelectionGuardsFeature &
  SettingsFeature &
  ThemeFeature &
  UIFeature &
  OpenAIUsageFeature &
  OpenRouterFeature &
  UpdateFeature;
