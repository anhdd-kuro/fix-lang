/**
 * @file index.ts
 * @description Main entry point for IPC handlers registration
 */
import {
  registerApiHandlers,
  registerCorrectionHandlers,
  registerPromptGenHandlers,
  registerSettingsHandlers,
  registerSummarizationHandlers,
  registerTranslationHandlers,
  registerUiHandlers,
} from "./features";

/**
 * Registers all IPC handlers for the application
 */
export const registerIpcHandlers = (): void => {
  // Register all feature handlers in a specific order (UI-first approach)
  registerUiHandlers();
  registerApiHandlers();
  registerSettingsHandlers();
  registerCorrectionHandlers();
  registerTranslationHandlers();
  registerSummarizationHandlers();
  registerPromptGenHandlers();

  console.log("All IPC handlers registered successfully");
};
