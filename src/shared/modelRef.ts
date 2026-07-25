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

export const formatModelRef = (provider: ProviderId, modelId: string): string =>
  `${provider}${MODEL_REF_SEPARATOR}${modelId}`;

/** Composite ref for a cached model, using its provider (falls back to openrouter). */
export const modelRefForModel = (model: Model): string =>
  formatModelRef(providerOfModel(model), model.id);

/** True only when `raw` carries a recognized provider prefix. */
export const isModelRef = (raw: string): boolean => parseModelRef(raw).provider !== null;

/** Idempotent; a no-op on a bare id (nothing to strip). */
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
