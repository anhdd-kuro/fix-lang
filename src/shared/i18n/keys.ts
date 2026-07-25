/**
 * @file keys.ts
 * @description Single import point for the key types call sites use with
 * `t()`. Re-exports rather than redefining, so `TranslationKey` (derived from
 * the JSON catalogs) and `TKey` / `PluralBaseKey` (derived in `translate.ts`)
 * stay in sync automatically.
 */

export type { TranslationKey } from "./locales";
export type { PluralBaseKey, TKey } from "./translate";
