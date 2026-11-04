/**
 * @file usageFieldReaders.ts
 * @description Field readers shared by the OpenAI and OpenRouter usage
 * parsers. Both APIs send amounts either as JSON numbers or as numeric
 * strings, so a reader takes either and never throws.
 */
import { z } from "zod";
import type { JsonValue } from "~/main/jsonValue";

/** `z.number()` refuses NaN and ±Infinity: only finite numbers pass. */
const FiniteNumberSchema = z.number();
const TextSchema = z.string();

/**
 * A finite number, or a non-blank string that converts to one (`"12"`,
 * `" 1e1 "`, `"0x10"`); null for anything else.
 */
export const readUsageNumber = (
  value: JsonValue | undefined,
): number | null => {
  const number = FiniteNumberSchema.safeParse(value);
  if (number.success) return number.data;
  const text = TextSchema.safeParse(value);
  if (
    text.success &&
    text.data.trim() !== "" &&
    Number.isFinite(Number(text.data))
  ) {
    return Number(text.data);
  }
  return null;
};

/** The string itself, or null for any other JSON value. */
export const readUsageString = (
  value: JsonValue | undefined,
): string | null => {
  const text = TextSchema.safeParse(value);
  return text.success ? text.data : null;
};
