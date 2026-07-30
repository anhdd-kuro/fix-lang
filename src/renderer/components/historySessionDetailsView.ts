import {
  parseHistorySession,
  serializeHistorySession,
  type HistorySessionMessage,
} from "~/shared/historySession";
import type { TKey } from "~/shared/i18n/translate";

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
