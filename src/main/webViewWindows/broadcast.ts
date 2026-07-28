/**
 * @file broadcast.ts
 * @description Fan a main-process event out to every live window (Main, Tray,
 * PromptGen, …).
 *
 * A renderer that only reacts to events raised inside its own window misses
 * state that changed elsewhere — another window, or a global hotkey that never
 * passes through preload at all. Sending to one window is the silent-breakage
 * shape this app treats as worse than a loud failure.
 */
import { BrowserWindow } from "electron";

export const broadcastToAllWindows = (channel: string): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel);
    }
  });
};
