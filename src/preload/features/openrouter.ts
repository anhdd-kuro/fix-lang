// OpenRouter analytics preload functionality (#59)
import { ipcRenderer } from "electron";
import type { OpenRouterAnalytics } from "~/main/llm/openrouter/client";

export type OpenRouterRange = "7d" | "30d";

/**
 * Exposes the OpenRouter account-analytics fetch to the renderer. The renderer
 * never sees the provisioning key — it only receives the parsed, key-free
 * combined view-model. The `range` arg is validated to the valid union here at
 * the preload boundary before invoking (the main handler re-validates too).
 */
export const openrouterFeature = {
  getOpenRouterAnalytics: (
    range: OpenRouterRange
  ): Promise<OpenRouterAnalytics> => {
    const safeRange: OpenRouterRange = range === "30d" ? "30d" : "7d";
    return ipcRenderer.invoke("openrouter-analytics", safeRange);
  },
};

export type OpenRouterFeature = typeof openrouterFeature;
