/**
 * @file openrouter.ts
 * @description IPC handlers for the OpenRouter analytics tab (#59).
 *
 * A single combined `openrouter-analytics` handle returns the four key-free
 * `CardResult` view-models in one round-trip per refresh. The provisioning key
 * is read PURELY in the main-process client (via getProvisioningKey) and never
 * crosses to the renderer — the payload contains only parsed analytics data.
 */
import { ipcMain } from "electron";
import { createOpenRouterClient } from "~/main/llm/openrouter/client";

/** Coerce an untrusted IPC range arg to the valid union (default 7d). */
const normalizeRange = (raw: unknown): "7d" | "30d" =>
  raw === "30d" ? "30d" : "7d";

export const registerOpenRouterHandlers = (): void => {
  const client = createOpenRouterClient();

  ipcMain.handle(
    "openrouter-analytics",
    async (_event: Electron.IpcMainInvokeEvent, range: unknown) => {
      // Re-validate the range at the boundary (preload also guards).
      return client.getAnalytics(normalizeRange(range));
    }
  );
};
