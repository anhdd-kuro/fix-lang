/**
 * Shared type definition for all APIs exposed by Electron preload script.
 * Import this type in both preload and global electron.d.ts for DRY and type-safe IPC.
 */
import type {
  ApiFeature,
  CorrectionFeature,
  HistoryFeature,
  PromptGenFeature,
  SettingsFeature,
  SummarizationFeature,
  TranslationFeature,
  UIFeature,
} from "./features";

export type ElectronAPI = HistoryFeature &
  SummarizationFeature &
  PromptGenFeature &
  CorrectionFeature &
  TranslationFeature &
  ApiFeature &
  SettingsFeature &
  UIFeature;
