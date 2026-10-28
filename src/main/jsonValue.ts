/**
 * @file jsonValue.ts
 * @description The shape of anything `JSON.parse` (and therefore
 * `Response.json()`) can produce. HTTP response bodies and JSON files on disk
 * are typed as this until a schema narrows them to a domain type, so a parser
 * states which raw shape it reads instead of accepting `unknown`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object: the top level of most API responses. */
export type JsonObject = Record<string, JsonValue>;

/**
 * True for a JSON object (not an array, not `null`, not a primitive). Exact on
 * the `JsonValue` domain: `JSON.parse` only ever builds ordinary objects, and
 * primitives are never `instanceof Object`.
 */
export const isJsonObject = (
  value: JsonValue | undefined,
): value is JsonObject => value instanceof Object && !Array.isArray(value);

/**
 * Reads one named field of a parsed JSON value the way a plain property access
 * would: an object yields the field (or `undefined`), arrays and primitives
 * have no such field, and `null` throws the same TypeError the engine throws.
 * For field names only — not built-in members such as `length`.
 */
export const jsonField = (
  value: JsonValue | undefined,
  key: string,
): JsonValue | undefined => {
  if (value === null || value === undefined) {
    throw new TypeError(
      `Cannot read properties of ${String(value)} (reading '${key}')`,
    );
  }
  return isJsonObject(value) ? value[key] : undefined;
};
