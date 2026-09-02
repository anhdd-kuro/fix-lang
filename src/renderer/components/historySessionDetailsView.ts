import {
  type ReasoningEffort,
  type ReasoningEffortStep,
} from "~/features/correction/shared/reasoningEffort";
import {
  parseHistorySession,
  serializeHistorySession,
  type HistorySessionMessage,
} from "~/features/history/shared/historySession";
import type { TKey } from "~/features/i18n/shared/translate";

export type HistorySessionDetailsTab = "json" | "chat";

export const HISTORY_SESSION_DETAILS_TABS: readonly {
  id: HistorySessionDetailsTab;
  labelKey: TKey;
}[] = [
  { id: "json", labelKey: "history.details.viewJson" },
  { id: "chat", labelKey: "history.details.viewChat" },
];

export const formatHistorySessionJson = (raw: string): string => {
  const session = parseHistorySession(raw);
  if (session) {
    return JSON.stringify(JSON.parse(serializeHistorySession(session)), null, 2);
  }

  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

export type HistoryChatSessionMeta = {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningEffort?: ReasoningEffort;
};

export const historyChatSessionMeta = (
  raw: string,
): HistoryChatSessionMeta | undefined => {
  const session = parseHistorySession(raw);
  if (!session) return undefined;

  return {
    promptTokens: session.promptTokens,
    completionTokens: session.completionTokens,
    reasoningEffort: session.reasoningEffort,
  };
};

export const reasoningEffortDisplayKey = (
  effort: ReasoningEffort,
):
  | "history.details.reasoning.providerDefault"
  | "settings.correction.reasoning.none"
  | `settings.correction.reasoning.step.${ReasoningEffortStep}` => {
  if (effort === "provider-default") {
    return "history.details.reasoning.providerDefault";
  }
  if (effort === "none") return "settings.correction.reasoning.none";
  return `settings.correction.reasoning.step.${effort}`;
};

export const historyChatMessages = (raw: string): HistorySessionMessage[] => {
  const session = parseHistorySession(raw);
  if (!session) return [];

  return [
    ...session.messages,
    ...(session.reasoningTexts ?? []).map((content) => ({
      role: "reasoning",
      content,
    })),
    ...session.responses.map((content) => ({ role: "assistant", content })),
  ];
};

export const displayHistoryMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2) ?? "";
  } catch {
    return String(content);
  }
};
