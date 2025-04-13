import { globalShortcut, clipboard, BrowserWindow, Notification } from 'electron';
import { fixGrammar } from './openai';
import { store } from '../main';

// State to store the last operation's text for Undo/Retry
let lastOriginalText: string | null = null;
let lastFixedText: string | null = null;

/**
 * Registers global shortcuts for the application.
 * @param mainWindow The main browser window instance.
 */
export const registerHotkeys = (mainWindow: BrowserWindow): void => {
  console.log('Attempting to register hotkeys...');

  // Get key bindings from the store
  const bindings = store.get('keyBindings');
  console.log('Using Key Bindings:', bindings);

  // Define shortcuts using stored bindings
  const fixShortcut = bindings.fix; // e.g., 'Control+Shift+F'
  const undoShortcut = bindings.undo; // e.g., 'Control+Shift+Z'
  const retryShortcut = bindings.retry; // e.g., 'Control+Shift+A'

  // -- Register Fix Shortcut --
  const retFix = globalShortcut.register(fixShortcut, async () => {
    console.log(`${fixShortcut} is pressed`);
    const text = clipboard.readText();

    // Get API Key from store
    const apiKey = store.get('apiKey');
    if (!apiKey) {
      console.error('OpenAI API Key not set in settings. Cannot fix grammar.');
      // Optionally show a notification to the user
      new Notification({
        title: 'API Key Missing',
        body: 'Please set your OpenAI API Key in the settings.',
      }).show();
      return; // Stop execution if no API key
    }

    if (!text || !text.trim()) {
      console.log('Clipboard is empty or contains only whitespace.');
      return;
    }
    console.log(`Original text from clipboard: ${text}`);
    try {
      // Call fixGrammar with the API key
      const fixed = await fixGrammar(apiKey, text);
      clipboard.writeText(fixed);
      console.log('✅ Text corrected and copied to clipboard!');

      // Store texts for potential Undo/Retry
      lastOriginalText = text;
      lastFixedText = fixed;

      // Send the original and fixed text to the renderer process for preview
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('Sending text update via IPC to renderer...');
        mainWindow.webContents.send('update-text', { original: text, fixed });
      } else {
        console.warn('Cannot send IPC message: mainWindow is null or destroyed.');
      }

      // Optional: Show notification
      // new Notification({ title: 'Fixkey Clone', body: 'Text corrected and copied!' }).show();
    } catch (error) {
      console.error('Error during grammar fixing or IPC send:', error);
      // Optional: Show error notification
    }
  });

  if (!retFix) {
    console.error(`Failed to register fix shortcut: ${fixShortcut}`);
  } else if (!globalShortcut.isRegistered(fixShortcut)) {
    console.error(`Shortcut ${fixShortcut} registration reported success but is not registered.`);
  } else {
    console.log(`Global shortcut ${fixShortcut} registered successfully.`);
  }

  // -- Register Undo Shortcut --
  const retUndo = globalShortcut.register(undoShortcut, () => {
    console.log(`${undoShortcut} (Undo) is pressed`);
    if (lastOriginalText !== null) {
      console.log('Restoring original text to clipboard...');
      clipboard.writeText(lastOriginalText);
      console.log('✅ Original text restored to clipboard.');

      // Update UI to show original text in both panes (or clear fixed pane)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-text', { original: lastOriginalText, fixed: '' }); // Clear fixed text on undo
      }

      // Clear last state after undoing to prevent multiple undos without new operation
      // lastOriginalText = null; // Optional: Uncomment to allow only one undo
      // lastFixedText = null;
    } else {
      console.log('Nothing to undo.');
    }
  });

  if (!retUndo) {
    console.error(`Failed to register undo shortcut: ${undoShortcut}`);
  } else {
    console.log(`Global shortcut ${undoShortcut} registered successfully.`);
  }

  // -- Register Retry Shortcut --
  const retRetry = globalShortcut.register(retryShortcut, async () => {
    console.log(`${retryShortcut} (Retry) is pressed`);
    if (lastOriginalText !== null) {
      console.log('Retrying last correction...');

      // Get API Key from store
      const apiKey = store.get('apiKey');
      if (!apiKey) {
        console.error('OpenAI API Key not set in settings. Cannot retry.');
        new Notification({
          title: 'API Key Missing',
          body: 'Cannot retry. Please set your OpenAI API Key in the settings.',
        }).show();
        return; // Stop execution if no API key
      }

      try {
        // Call fixGrammar with the API key and last original text
        const newFixed = await fixGrammar(apiKey, lastOriginalText);
        clipboard.writeText(newFixed);
        console.log('✅ Text re-corrected and copied to clipboard!');

        // Update lastFixedText with the new result
        lastFixedText = newFixed;

        // Send update to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-text', {
            original: lastOriginalText,
            fixed: newFixed,
          });
        }
      } catch (error) {
        console.error('Error during retry correction:', error);
      }
    } else {
      console.log('No previous correction to retry.');
    }
  });

  if (!retRetry) {
    console.error(`Failed to register retry shortcut: ${retryShortcut}`);
  } else {
    console.log(`Global shortcut ${retryShortcut} registered successfully.`);
  }

  console.log(
    `Hotkeys registered: Fix (${fixShortcut}), Undo (${undoShortcut}), Retry (${retryShortcut})`,
  );
};

/**
 * Unregisters all global shortcuts when the app quits.
 */
export const unregisterHotkeys = () => {
  globalShortcut.unregisterAll();
  console.log('All global shortcuts unregistered.');
};
