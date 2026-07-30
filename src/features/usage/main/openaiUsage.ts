/**
 * @file openaiUsage.ts
 * @description IPC handler for the OpenAI panel of the Usage tab.
 *
 * A single combined `openai-usage` handle returns both key-free `CardResult`
 * view-models in one round-trip per refresh. The admin key is read PURELY in the
 * main-process client (via getProvisioningKey("openai")) and never crosses to the
 * renderer — the payload carries only parsed usage data.
 *
 * Kept separate from `openrouter-analytics` on purpose: the two providers report
 * different cards (OpenAI has no credit balance, OpenRouter no line items), and
 * folding them into one channel would force a union type through every existing
 * OpenRouter test for no gain.
 */
import { ipcMain } from "electron";
import { normalizeUsageRange } from "~/features/usage/shared/usage";
import { createOpenAIUsageClient } from "~/main/llm/providers/openai/usage.client";

export const registerOpenAIUsageHandlers = (): void => {
  const client = createOpenAIUsageClient();

  ipcMain.handle(
    "openai-usage",
    async (_event: Electron.IpcMainInvokeEvent, range: unknown) =>
      // Re-validate the range at the boundary (preload also guards).
      client.getUsage(normalizeUsageRange(range)),
  );
};
