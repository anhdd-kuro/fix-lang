/**
 * @file historySession.ts
 * @description Raw completion-session snapshot stored on history rows for the
 * "Show details" transparency UI. Electron-free — shared by main writers and
 * renderer readers.
 */
import { z } from "zod";
import {
  isReasoningEffort,
  type ReasoningEffort,
} from "~/features/correction/shared/reasoningEffort";
import {
  isProviderId,
  type ProviderId,
} from "~/features/providers/shared/providers";

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

/**
 * Any JSON number. `JSON.parse` turns an overflowing literal such as `1e999`
 * into ±Infinity, which `z.number()` alone would refuse.
 */
const StoredNumberSchema = z.union([
  z.number(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
]);

/** A message object with a string `role`; `content` is carried as stored. */
const StoredSessionMessageSchema = z.looseObject({ role: z.string() });

/**
 * A stored snapshot. A wrong REQUIRED field rejects the whole snapshot; a
 * wrong OPTIONAL field is dropped on its own.
 */
const StoredHistorySessionSchema = z.looseObject({
  messages: z.array(StoredSessionMessageSchema),
  model: z.string(),
  provider: z.custom<ProviderId>((value) => isProviderId(value)),
  responses: z.array(z.string()),
  promptTokens: StoredNumberSchema.nullable(),
  completionTokens: StoredNumberSchema.nullable(),
  reasoningEffort: z
    .custom<ReasoningEffort>((value) => isReasoningEffort(value))
    .optional()
    .catch(undefined),
  topP: StoredNumberSchema.optional().catch(undefined),
  resolvedModel: z.string().optional().catch(undefined),
  reasoningTexts: z.array(z.string()).optional().catch(undefined),
  cachedTokens: StoredNumberSchema.optional().catch(undefined),
  cacheWriteTokens: StoredNumberSchema.optional().catch(undefined),
});

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
    const parsed = StoredHistorySessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    const stored = parsed.data;

    const session: HistorySessionData = {
      messages: stored.messages.map((message): HistorySessionMessage => ({
        role: message.role,
        content: message.content,
      })),
      model: stored.model,
      provider: stored.provider,
      responses: stored.responses,
      promptTokens: stored.promptTokens,
      completionTokens: stored.completionTokens,
    };

    if (stored.reasoningEffort !== undefined) {
      session.reasoningEffort = stored.reasoningEffort;
    }
    if (stored.topP !== undefined) {
      session.topP = stored.topP;
    }
    if (stored.resolvedModel !== undefined) {
      session.resolvedModel = stored.resolvedModel;
    }
    if (stored.reasoningTexts !== undefined) {
      session.reasoningTexts = stored.reasoningTexts;
    }
    if (stored.cachedTokens !== undefined) {
      session.cachedTokens = stored.cachedTokens;
    }
    if (stored.cacheWriteTokens !== undefined) {
      session.cacheWriteTokens = stored.cacheWriteTokens;
    }

    return session;
  } catch {
    return undefined;
  }
};
