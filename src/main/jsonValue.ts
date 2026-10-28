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
