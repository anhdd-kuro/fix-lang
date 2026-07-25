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
