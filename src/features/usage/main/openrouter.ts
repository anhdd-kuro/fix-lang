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
import { UsageRangeSchema } from "~/features/usage/shared/usage";
import { createOpenRouterClient } from "~/main/llm/providers/openrouter/client";

export const registerOpenRouterHandlers = (): void => {
  const client = createOpenRouterClient();

  ipcMain.handle(
    "openrouter-analytics",
    async (_event: Electron.IpcMainInvokeEvent, range) => {
      // Re-validate the range at the boundary (preload also guards): an
      // untrusted arg coerces to the valid union, default 7d.
      return client.getAnalytics(UsageRangeSchema.parse(range));
    },
  );
};
