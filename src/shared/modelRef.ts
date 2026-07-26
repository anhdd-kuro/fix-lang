/**
 * @file modelRef.ts
 * @description Parse/format/resolve kernel for composite model refs of the
 * form `<providerId>::<rawModelId>`. `::` is the separator because Ollama tags
 * use `:` (`llama3.2:3b`) and OpenRouter ids use `/` (`openai/gpt-4o`), so
 * neither character alone is safe as a delimiter.
 *
 * Must stay Electron-free, like `./providers`.
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
 * Splits on the FIRST `::` only, so a tail's own separators survive untouched,
 * and only when the head is a known provider id (`"bogus::x"` stays bare).
 * Empty/nullish input is the *inherit* sentinel, never "unavailable".
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
 * Precondition: `modelId` is a raw id, never itself a ref — unchecked, so a
 * caller holding either shape must guard with
 * `isModelRef(v) ? v : formatModelRef(provider, v)`. An empty `modelId` yields
 * the inherit sentinel rather than a degenerate `"openai::"`.
 */
export const formatModelRef = (provider: ProviderId, modelId: string): string =>
  modelId === "" ? "" : `${provider}${MODEL_REF_SEPARATOR}${modelId}`;

/**
 * Attribution runs through `isModelForProvider`, not `providerOfModel`, whose
 * openrouter fallback ignores the `local` descriptor and would bill an untagged
 * local model to OpenRouter. The `??` arm only fires on an unrecognized tag.
 */
export const modelRefForModel = (model: Model): string =>
  formatModelRef(
    PROVIDER_ORDER.find((provider) => isModelForProvider(model, provider)) ??
      providerOfModel(model),
    model.id,
  );

export const isModelRef = (raw: string): boolean => parseModelRef(raw).provider !== null;

/**
 * Single-pass by design — do not make this loop. A nested ref strips to the
 * inner ref, so it stays visibly corrupt to `resolveModelRef` and the request
 * path instead of being silently laundered into a valid-looking id.
 */
export const stripModelRefPrefix = (raw: string): string => parseModelRef(raw).modelId;

/**
 * A prefixed ref checks only its own provider and then stops: widening the
 * candidate list would route `ollama::gpt-4o` to OpenAI and bill its key. Only
 * a bare id scans `PROVIDER_ORDER`.
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
