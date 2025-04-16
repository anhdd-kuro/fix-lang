import { globalShortcut, Notification } from "electron";
import { store } from "~/main/partials/store";
import { fixGrammar } from "./openai";
import { showOverlaySpinner, hideOverlaySpinner } from "./overlayWindow";
import { getHighlightedText, pasteText } from "../../utils";
import type { BrowserWindow } from "electron";

// State to store the last operation's text for Undo/Retry
let lastOriginalText: string | null = null;
let lastFixedText: string | null = null;

/**
 * Registers global shortcuts for the application.
 * @param mainWindow The main browser window instance.
 */
export const registerHotkeys = (mainWindow: BrowserWindow): void => {
  console.log("Attempting to register hotkeys...");

  registerFixShortcut(mainWindow);
  registerUndoShortcut(mainWindow);
  registerRetryShortcut(mainWindow);
};

const registerFixShortcut = (mainWindow: BrowserWindow) => {
  const fixShortcut = store.get("keyBindings").fix;
  const retFix = globalShortcut.register(fixShortcut, async () => {
    console.log(`${fixShortcut} is pressed`);

    // Get API Key from store
    try {
      const apiKey = getOpenAIKey();
      const selectedText = await getHighlightedText();

      if (!selectedText || !selectedText.trim()) {
        console.log("No text selected or clipboard is empty.");
        new Notification({
          title: "Error",
          body: "No text selected or clipboard is empty.",
          urgency: "critical",
        }).show();
        return;
      }

      console.log(`Selected text: ${selectedText}`);
      // Send 'start-loading' to renderer before calling fixGrammar
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("start-loading");
      }

      showOverlaySpinner();
      const fixed = await fixGrammar(apiKey, selectedText);

      // Store texts for potential Undo/Retry
      lastOriginalText = selectedText;
      lastFixedText = fixed;
      if (fixed === selectedText) {
        new Notification({
          title: "Good job!",
          body: "Your text is already correct. No changes have been made.",
        }).show();
      }

      await pasteText(fixed);

      // Send the original and fixed text to the renderer process for preview
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("Sending text update via IPC to renderer...");
        mainWindow.webContents.send("update-text", {
          original: selectedText,
          fixed,
        });
        // Hide spinner overlay for renderer UI
        mainWindow.webContents.send("stop-loading");
      } else {
        console.warn(
          "Cannot send IPC message: mainWindow is null or destroyed."
        );
      }
      // Always hide global spinner overlay (robust)
      hideOverlaySpinner();
    } catch (error) {
      // Hide spinner overlay even on error
      hideOverlaySpinner();
      handleError(error);
    }
  });

  checkShortcut(retFix);
};

const checkShortcut = (shortcut: boolean) => {
  if (!shortcut) {
    console.error(`Shortcut ${shortcut} is not set in settings.`);
    handleError(new Error(`Shortcut ${shortcut} is not set in settings.`));
    return false;
  }
  console.log(`Global shortcut ${shortcut} registered successfully.`);
  return true;
};

const registerUndoShortcut = (mainWindow: BrowserWindow) => {
  const undoShortcut = store.get("keyBindings").undo; // e.g., 'Control+Shift+Z'
  const retUndo = globalShortcut.register(undoShortcut, () => {
    console.log(`${undoShortcut} (Undo) is pressed`);
    if (lastOriginalText !== null) {
      // Update UI to show original text in both panes (or clear fixed pane)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-text", {
          original: lastOriginalText,
          fixed: "",
        }); // Clear fixed text on undo
      }
      lastFixedText = null;
    } else {
      console.log("Nothing to undo.");
    }
  });

  checkShortcut(retUndo);
};

const registerRetryShortcut = (mainWindow: BrowserWindow) => {
  const retryShortcut = store.get("keyBindings").retry; // e.g., 'Control+Shift+A'
  const retRetry = globalShortcut.register(retryShortcut, async () => {
    console.log(`${retryShortcut} (Retry) is pressed`);
    if (lastOriginalText !== null) {
      console.log("Retrying last correction...");

      // Show global spinner overlay for retry (independent of mainWindow)
      showOverlaySpinner();
      // Send 'start-loading' to renderer for UI if available
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("start-loading");
      }

      try {
        const apiKey = getOpenAIKey();
        const newFixed = await fixGrammar(apiKey, lastOriginalText);

        // Update lastFixedText with the new result
        lastFixedText = newFixed;

        // Send update to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("update-text", {
            original: lastOriginalText,
            fixed: newFixed,
          });
          // Hide spinner overlay for renderer UI
          mainWindow.webContents.send("stop-loading");
        }
        // Always hide global spinner overlay
        hideOverlaySpinner();
      } catch (error) {
        // Hide spinner overlay even on error
        hideOverlaySpinner();
        // Ensure spinner overlay is hidden on error as well
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("stop-loading");
        }
        handleError(error);
      }
    } else {
      console.log("No previous correction to retry.");
    }
  });

  checkShortcut(retRetry);
};

const handleError = (error: unknown) => {
  console.error("Error during grammar fixing or IPC send:", error);
  // Optional: Show error notification
  new Notification({
    title: "Error",
    body: "Failed to correct text. Please try again.",
    urgency: "critical",
  }).show();
};

const getOpenAIKey = () => {
  const apiKey = store.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API Key not set in settings.");
  }
  return apiKey;
};

/**
 * Unregisters all global shortcuts when the app quits.
 */
export const unregisterHotkeys = () => {
  globalShortcut.unregisterAll();
  console.log("All global shortcuts unregistered.");
};
