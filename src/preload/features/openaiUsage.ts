// OpenAI usage preload functionality (Usage tab)
import { ipcRenderer } from "electron";
import { normalizeUsageRange, type UsageRange } from "~/shared/usage";
import type { OpenAIUsage } from "~/main/llm/providers/openai/usage.client";

/**
 * Exposes the OpenAI usage fetch to the renderer. The renderer never sees the
 * admin key — only the parsed, key-free combined view-model. The `range` arg is
 * normalized to the valid union here at the preload boundary before invoking
 * (the main handler re-validates too).
 */
export const openaiUsageFeature = {
  getOpenAIUsage: (range: UsageRange): Promise<OpenAIUsage> =>
    ipcRenderer.invoke("openai-usage", normalizeUsageRange(range)),
};

export type OpenAIUsageFeature = typeof openaiUsageFeature;
