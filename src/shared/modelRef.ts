/**
 * @file modelRef.ts
 * @description Parse/format/resolve kernel for composite model refs of the
 * form `<providerId>::<rawModelId>`. `::` is the separator because Ollama
 * tags use `:` (`llama3.2:3b`) and OpenRouter ids use `/` (`openai/gpt-4o`) —
 * neither character alone is safe as a delimiter.
 *
 * Free of the Electron runtime — imported by the renderer alongside
 * `./providers`. Never depend on the Electron runtime, its store binding, or
 * any module under the app's stores directory here.
 */
import {
  isModelForProvider,
  isProviderId,
  PROVIDER_ORDER,
  providerOfModel,
  type Model,
  type ProviderId,
} from "./providers";

export const MODEL_REF_SEPARATOR = "::";

export type ModelRef = {
  provider: ProviderId | null;
  modelId: string;
  raw: string;
};

/**
 * Splits on the first `::` only, so an Ollama tag's own `:` in the tail
 * survives untouched. A prefix is honored only when the head is a known
 * provider id — `"bogus::x"` is a bare id whose `modelId` is the whole
 * string, not `"x"`. Empty/nullish input is the **inherit** sentinel
 * (`{ provider: null, modelId: "", raw: "" }`), never "unavailable".
 */
export const parseModelRef = (raw?: string | null): ModelRef => {
  const value = raw ?? "";
  if (value === "") {
    return { provider: null, modelId: "", raw: "" };
  }

  const separatorIndex = value.indexOf(MODEL_REF_SEPARATOR);
  if (separatorIndex === -1) {
    return { provider: null, modelId: value, raw: value };
  }

  const head = value.slice(0, separatorIndex);
  const tail = value.slice(separatorIndex + MODEL_REF_SEPARATOR.length);
  if (!isProviderId(head)) {
    return { provider: null, modelId: value, raw: value };
  }

  return { provider: head, modelId: tail, raw: value };
};

/**
 * Compose a composite ref.
 *
 * **Precondition: `modelId` is a raw model id, never itself a ref.** This
 * function does not check and does not normalize — passing a value for which
 * `isModelRef(modelId)` is true produces a nested ref
 * (`"openai::openrouter::gpt-4o"`) that `resolveModelRef` rejects. A caller
 * that may hold either shape must guard at the call site:
 * `isModelRef(value) ? value : formatModelRef(provider, value)`. That guard is
 * the exact negation of the nesting precondition, so it holds by construction
 * and makes it safe for `stripModelRefPrefix` to stay single-pass.
 *
 * The one value that *is* normalized: `modelId === ""` yields `""`, the inherit
 * sentinel — a ref to no model **is** inherit. Without this, `"openai::"` would
 * be a ref that `isModelRef` calls valid but that strips to the inherit
 * sentinel, so callers would disagree about what the same string means.
 */
export const formatModelRef = (provider: ProviderId, modelId: string): string =>
  modelId === "" ? "" : `${provider}${MODEL_REF_SEPARATOR}${modelId}`;

/**
 * Composite ref for a cached model.
 *
 * Attribution goes through `isModelForProvider` — the same predicate
 * `resolveModelRef`, the request path and the picker match on — so that
 * `resolveModelRef(modelRefForModel(m), [m])` round-trips for every `Model`
 * shape the app produces. `providerOfModel` is **not** used as the primary
 * attribution: its openrouter fallback ignores the `local` descriptor, so an
 * untagged local model (what `discover.ts` builds, and what any pre-tagging
 * cache still holds on disk) would be labelled and billed as OpenRouter.
 *
 * The `??` arm is defensive only: for a well-typed `Model` some provider always
 * matches, so it is reachable only for a cache entry whose `provider` field
 * holds an unrecognized string.
 */
export const modelRefForModel = (model: Model): string =>
  formatModelRef(
    PROVIDER_ORDER.find((provider) => isModelForProvider(model, provider)) ??
      providerOfModel(model),
    model.id,
  );

/** True only when `raw` carries a recognized provider prefix. */
export const isModelRef = (raw: string): boolean => parseModelRef(raw).provider !== null;

/**
 * Remove one recognized provider prefix. A no-op on a bare id (nothing to
 * strip) and on `""`.
 *
 * **Single-pass by design — do not make this loop.** A nested ref strips to the
 * inner ref, not to the raw id: `"openai::ollama::x"` → `"ollama::x"`, so
 * `strip(strip(x)) !== strip(x)` for that one shape. A fixed point *is*
 * guaranteed for every value the system produces, because a nested ref is
 * unreachable by construction: every producer prefixes behind the
 * `isModelRef(v) ? v : formatModelRef(p, v)` guard documented on
 * `formatModelRef`, and the IPC save path independently gates on
 * `resolveModelRef(...) !== null`.
 *
 * A looping strip would make this function's callers the only consumers that
 * silently accept a nested ref, while `resolveModelRef`, the request path and
 * the model picker all still reject it — and the corrupt string would stay
 * persisted, exported and logged. Loud failure beats silent divergence.
 */
export const stripModelRefPrefix = (raw: string): string => parseModelRef(raw).modelId;

/**
 * Resolve a ref against a model cache.
 *
 * - A prefixed ref only ever checks its own provider — an exact
 *   `(provider, id)` match, or `null`. It never falls back to scanning other
 *   providers.
 * - A bare id scans providers in `PROVIDER_ORDER` and returns the first
 *   provider that has a matching cached model.
 * - `""` (the inherit sentinel) always resolves to `null`.
 */
export const resolveModelRef = (
  raw: string,
  models: readonly Model[],
): { provider: ProviderId; model: Model; ref: string } | null => {
  const parsed = parseModelRef(raw);
  if (parsed.modelId === "") return null;

  const candidates = parsed.provider ? [parsed.provider] : PROVIDER_ORDER;
  for (const provider of candidates) {
    const model = models.find(
      (candidate) => candidate.id === parsed.modelId && isModelForProvider(candidate, provider),
    );
    if (model) {
      return { provider, model, ref: formatModelRef(provider, parsed.modelId) };
    }
  }

  return null;
};
