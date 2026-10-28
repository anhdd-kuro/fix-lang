// electron.d.ts

import type { ElectronAPI } from "./src/preload";

// Extend the global Window interface
declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- only an interface can merge into the global Window
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// This export statement makes the file a module, which is necessary for global declarations
export {};
