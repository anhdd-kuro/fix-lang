/**
 * @file message.ts
 * @description Locale-free "descriptor" types the aggregation layer returns
 * instead of prose (Chunk 8, dashboard). A `Message` pairs a translation key
 * with raw params; turning it into a display string is the renderer's job
 * (`tm`/`tl` on `useI18n()`), never the aggregation layer's.
 *
 * `import type` only for the key types below — this module has ZERO runtime
 * dependency on the JSON catalogs (`locales/index.ts` and every namespace
 * file under it). That matters because pure aggregation modules
 * (`overviewAggregations.ts`, `modelsAggregations.ts`) import `msg`/`Message`
 * directly; if this file pulled in the catalogs at runtime, importing it
 * would drag the entire translation dataset into a module that is supposed
 * to stay locale-free.
 *
 * `MessageKey`/`TKey` are re-exported from `keys.ts` rather than redeclared
 * here — `keys.ts` already re-exports `PluralBaseKey`/`TKey` from
 * `translate.ts`, which is the single source of truth for the
 * plural-stripping ladder. A second ladder here would drift from it silently.
 */
import type { TKey } from "./keys";

/** Every key a `Message` may carry — full keys and plural bases (from `translate.ts`). */
export type MessageKey = TKey;

/** Raw values interpolated into `{token}` placeholders by `t()`/`tm()`/`tl()`. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A locale-free descriptor: a translation key plus the raw params it needs.
 * Aggregation code returns these instead of formatted prose; the renderer
 * resolves them via `tm()` (see `useI18n.ts`).
 */
export type Message = { readonly key: MessageKey; readonly params?: MessageParams };

/**
 * A display value that is EITHER user data (never translated, e.g. a preset
 * name the user typed) OR UI chrome (always translated, e.g. the "Other"
 * fallback bucket). Never collapse this into `string | Message` — a bare
 * `string` cannot distinguish "user data" from "English we forgot to
 * migrate", and this tagged union stays greppable.
 */
export type Label =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "message"; readonly message: Message };

/** Builds a `Message`. Omits `params` entirely when absent (cleaner equality checks in tests). */
export const msg = (key: MessageKey, params?: MessageParams): Message =>
  params === undefined ? { key } : { key, params };

/** Wraps verbatim user data as a `Label` — never passed through `t()`. */
export const textLabel = (text: string): Label => ({ kind: "text", text });

/** Wraps a translation key as a `Label` — always resolved through `t()`. */
export const messageLabel = (key: MessageKey, params?: MessageParams): Label => ({
  kind: "message",
  message: msg(key, params),
});

/** The shape of `useI18n().t` — the only function that may resolve a `Message`/`Label` to a string. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Resolves a `Message` to a display string via `t`. Thin — kept so call sites don't hand-roll `t(m.key, m.params)`. */
export const resolveMessage = (m: Message, t: Translate): string => t(m.key, m.params);

/** Resolves a `Label` to a display string: verbatim for `"text"`, translated for `"message"`. */
export const resolveLabel = (l: Label, t: Translate): string =>
  l.kind === "text" ? l.text : resolveMessage(l.message, t);

// ---------------------------------------------------------------------------
// Runtime validation — for IPC boundaries that carry a `Message`/`Label`
// across preload (see `isMessage` in `src/shared/update.ts` for the
// established shape this mirrors). Kept here, next to the types themselves,
// so every preload feature validating a `Label`-bearing result shares one
// definition instead of re-deriving the same structural checks per file.
// Plain JS narrowing only — no catalog import, preserving this module's
// zero-runtime-catalog-dependency contract (see file doc above).
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMessageParams = (value: unknown): value is MessageParams =>
  isRecord(value) &&
  Object.values(value).every(
    (param) => typeof param === "string" || typeof param === "number",
  );

/**
 * Validates a `Message` descriptor's shape. `key` can only be checked as a
 * non-empty string here — `MessageKey` is a compile-time union derived from
 * the JSON catalogs, not a runtime-enumerable set.
 */
export const isMessage = (value: unknown): value is Message => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "key" && key !== "params")) return false;
  if (typeof value.key !== "string" || value.key.length === 0) return false;
  return value.params === undefined || isMessageParams(value.params);
};

/** Validates a `Label`'s shape: a `"text"` case or a `"message"` case, never both/neither. */
export const isLabel = (value: unknown): value is Label => {
  if (!isRecord(value)) return false;
  if (value.kind === "text") {
    const keys = Object.keys(value);
    return (
      keys.length === 2 &&
      keys.includes("kind") &&
      keys.includes("text") &&
      typeof value.text === "string"
    );
  }
  if (value.kind === "message") {
    const keys = Object.keys(value);
    return (
      keys.length === 2 &&
      keys.includes("kind") &&
      keys.includes("message") &&
      isMessage(value.message)
    );
  }
  return false;
};
