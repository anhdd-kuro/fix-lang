/*
 * FixLang — local macOS AI writing assistant
 * Copyright (C) 2026 Anhdd Kuro
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge } from "electron";
import {
  apiFeature,
  correctionFeature,
  correctionResultFeature,
  localeFeature,
  logsFeature,
  openaiUsageFeature,
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
  LocaleFeature,
  LogsFeature,
  OpenAIUsageFeature,
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
  ...localeFeature,
  ...logsFeature,
  ...promptGenFeature,
  ...profilesFeature,
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
  PromptGenFeature &
  CorrectionFeature &
  CorrectionResultFeature &
  ApiFeature &
  LocaleFeature &
  LogsFeature &
  ProfilesFeature &
  SettingsFeature &
  ThemeFeature &
  UIFeature &
  OpenAIUsageFeature &
  OpenRouterFeature &
  UpdateFeature;
