/**
 * @file messageContentText.ts
 * @description Flattens a chat message's content to the text a provider is
 * sent: string content as-is, anything else (content-part arrays) as JSON.
 */
import { z } from "zod";
import type { CoreMessage } from "~/main/ai.request/requestTypes";

const TextContentSchema = z.string();

export const messageContentText = (content: CoreMessage["content"]): string => {
  const text = TextContentSchema.safeParse(content);
  return text.success ? text.data : JSON.stringify(content);
};
