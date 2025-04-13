import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import Store from 'electron-store';
import { registerHotkeys, unregisterHotkeys } from './setup/hotkey';

// Define the type for the store schema
type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

type SettingsStore = {
  apiKey: string;
  keyBindings: KeyBindings;
};

// Define the schema for electron-store
const schema = {
  apiKey: {
    type: 'string',
    default: '', // Default to empty string
  },
  keyBindings: {
    type: 'object',
    properties: {
      fix: { type: 'string', default: 'Control+Shift+F' },
      undo: { type: 'string', default: 'Control+Shift+Z' },
      retry: { type: 'string', default: 'Control+Shift+A' },
    },
    default: {
      fix: 'Control+Shift+F',
      undo: 'Control+Shift+Z',
      retry: 'Control+Shift+A',
    },
  },
};

// Initialize electron-store
export const store = new Store<SettingsStore>({ schema });

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Use the compiled preload script
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load index.html of the app.
  // In production, load the built index.html file
  // In development, load Vite dev server URL (if using Vite for UI)
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: Loading Vite dev server');
    mainWindow.loadURL('http://localhost:5173'); // Default Vite port
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    console.log('Production mode: Loading built file');
    // Assumes index.html is in the root directory alongside the package.json
    // after the Vite build process which should output to a 'dist' folder (common practice)
    // Adjust the path if your build output is different.
    // Vite typically builds to 'dist'. Electron Forge might package differently.
    // Let's assume a standard Vite build output first.
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')); // Adjusted path for typical build
  }

  // Open the DevTools if needed.
  // mainWindow.webContents.openDevTools();

  // Return the window instance so it can be used elsewhere if needed
  return mainWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const mainWindow = createWindow(); // Get the main window instance
  registerHotkeys(mainWindow); // Register global shortcuts, passing the window

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  unregisterHotkeys(); // Unregister shortcuts when closing
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Unregister shortcuts before quitting
app.on('will-quit', () => {
  // Unregister all shortcuts on quit to be safe
  unregisterHotkeys();
});

// --- IPC Handlers for Settings ---

// Handle request to get the API key
ipcMain.handle('get-api-key', async () => {
  try {
    const apiKey = store.get('apiKey');
    console.log(`IPC: Retrieved API Key (length): ${apiKey?.length ?? 0}`);
    return apiKey;
  } catch (error) {
    console.error('IPC Error getting API Key:', error);
    return ''; // Return empty string on error
  }
});

// Handle request to set the API key
ipcMain.handle('set-api-key', async (event, apiKey: string) => {
  try {
    if (typeof apiKey !== 'string') {
      throw new Error('Invalid API key provided. Must be a string.');
    }
    store.set('apiKey', apiKey);
    console.log(`IPC: API Key updated (length): ${apiKey.length}`);
    return { success: true };
  } catch (error) {
    console.error('IPC Error setting API Key:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Handle request to get key bindings
ipcMain.handle('get-key-bindings', async () => {
  try {
    const bindings = store.get('keyBindings');
    console.log('IPC: Retrieved Key Bindings:', bindings);
    // Ensure we return the default if somehow it's not stored correctly (though schema default should prevent this)
    return bindings || schema.keyBindings.default;
  } catch (error) {
    console.error('IPC Error getting Key Bindings:', error);
    return schema.keyBindings.default; // Return default on error
  }
});

// Handle request to set key bindings
ipcMain.handle('set-key-bindings', async (event, bindings: KeyBindings) => {
  try {
    // Basic validation (can be expanded)
    if (!bindings || typeof bindings !== 'object' || !bindings.fix || !bindings.undo || !bindings.retry) {
      throw new Error('Invalid key bindings object received.');
    }
    // TODO: Add validation for Electron Accelerator format if desired

    store.set('keyBindings', bindings);
    console.log('IPC: Key Bindings updated:', bindings);
    // NOTE: Hotkeys are NOT automatically re-registered here.
    // Changes will apply on next app start.
    return { success: true };
  } catch (error) {
    console.error('IPC Error setting Key Bindings:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// --- App Lifecycle ---

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
