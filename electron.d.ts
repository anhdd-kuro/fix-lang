// electron.d.ts

import type { ElectronAPI } from "./src/preload/preload-api.types";

// Extend the global Window interface
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// This export statement makes the file a module, which is necessary for global declarations
export {};
