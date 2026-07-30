/**
 * @file historySession.ts
 * @description Raw completion-session snapshot stored on history rows for the
 * "Show details" transparency UI. Electron-free — shared by main writers and
 * renderer readers.
 */
import { isProviderId, type ProviderId } from "~/shared/providers";
import {
  isReasoningEffort,
  type ReasoningEffort,
} from "~/shared/reasoningEffort";

/** One message as sent to (or returned from) the model. */
export type HistorySessionMessage = {
  role: string;
  content: unknown;
};

/**
 * Full completion session: prompts sent, reasoning effort, responses, and
 * optional model reasoning text / usage. Serialized as JSON on `HistoryEntry`.
 */
export type HistorySessionData = {
  messages: HistorySessionMessage[];
  reasoningEffort?: ReasoningEffort;
  topP?: number;
  model: string;
  provider: ProviderId;
  resolvedModel?: string;
  responses: string[];
  reasoningTexts?: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens?: number;
  cacheWriteTokens?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asSessionMessage = (value: unknown): HistorySessionMessage | undefined => {
  if (!isRecord(value) || typeof value.role !== "string") {
    return undefined;
  }
  return { role: value.role, content: value.content };
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item): item is string => typeof item === "string")) {
    return undefined;
  }
  return value;
};

const asNullableNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
};

/** Serialize a session for SQLite TEXT storage. */
export const serializeHistorySession = (session: HistorySessionData): string =>
  JSON.stringify(session);

/**
 * Parse a stored session JSON string. Returns undefined for missing / corrupt
 * payloads so legacy history rows stay readable.
 */
export const parseHistorySession = (
  raw: string | undefined | null,
): HistorySessionData | undefined => {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    if (typeof parsed.model !== "string") return undefined;
    if (!isProviderId(parsed.provider)) return undefined;
    if (!Array.isArray(parsed.messages)) return undefined;

    const messages: HistorySessionMessage[] = [];
    for (const item of parsed.messages) {
      const message = asSessionMessage(item);
      if (!message) return undefined;
      messages.push(message);
    }

    const responses = asStringArray(parsed.responses);
    if (!responses) return undefined;

    const promptTokens = asNullableNumber(parsed.promptTokens);
    const completionTokens = asNullableNumber(parsed.completionTokens);
    if (promptTokens === undefined || completionTokens === undefined) {
      return undefined;
    }

    const session: HistorySessionData = {
      messages,
      model: parsed.model,
      provider: parsed.provider,
      responses,
      promptTokens,
      completionTokens,
    };

    if (isReasoningEffort(parsed.reasoningEffort)) {
      session.reasoningEffort = parsed.reasoningEffort;
    }
    if (typeof parsed.topP === "number") {
      session.topP = parsed.topP;
    }
    if (typeof parsed.resolvedModel === "string") {
      session.resolvedModel = parsed.resolvedModel;
    }
    const reasoningTexts = asStringArray(parsed.reasoningTexts);
    if (reasoningTexts) {
      session.reasoningTexts = reasoningTexts;
    }
    if (typeof parsed.cachedTokens === "number") {
      session.cachedTokens = parsed.cachedTokens;
    }
    if (typeof parsed.cacheWriteTokens === "number") {
      session.cacheWriteTokens = parsed.cacheWriteTokens;
    }

    return session;
  } catch {
    return undefined;
  }
};
