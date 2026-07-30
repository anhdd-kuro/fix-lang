/**
 * @file prewarm.ts
 * @description Fire-and-forget connection prewarmer for the transform hotkey
 * path. `prewarmProviderConnection` is called at the very top of the hotkey
 * handler (`~/main/keybindings/correction.ts`), before the AppleScript
 * selection read, so the provider's TCP+TLS handshake overlaps that ~150-250ms
 * of local work instead of happening serially in front of the real request.
 *
 * Contract: synchronous to call, never throws, never rejects unhandled, never
 * shows a user-facing error. A dead prewarm must be completely invisible — it
 * only ever shaves latency off a request that would have opened the same
 * connection anyway; it never gates or blocks that request. Failures are
 * therefore logged at debug only, never warn/error.
 *
 * Routing reuses the exact same logic `makeAIRequest` (`ai.request/shared.ts`)
 * uses: `resolveModelRef`/`parseModelRef` from `~/features/providers/shared/modelRef`, over the
 * same cached model list (`getCachedModels`). Nothing here re-derives which
 * provider a ref belongs to.
 */
import { getCachedModels } from "~/main/ai.request/shared";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import { logger } from "~/main/logging/logService";
import { parseModelRef, resolveModelRef } from "~/features/providers/shared/modelRef";
import { getApiKey } from "~/features/providers/store/apiKeyStore";
import { getCurrentProfileId } from "~/features/providers/store/apiStore";
import { getProfileSecret } from "~/features/providers/store/profileSecretStore";
import type { Model, ProviderId } from "~/features/providers/shared/providers";

const LOG_SCOPE = "prewarm.connection";

/** Loopback providers gain nothing from a TCP/TLS prewarm. */
const LOCAL_PROVIDERS: ReadonlySet<ProviderId> = new Set(["ollama", "lmstudio"]);

/**
 * How long a successful prewarm suppresses the next one for that provider.
 *
 * Without this, every hotkey press fires a real `GET /v1/models` even when the
 * socket from ten seconds ago is still pooled — a wasted round trip that warms
 * nothing and spends the provider's rate limit. Deliberately far shorter than
 * `httpKeepAlive`'s `keepAliveTimeout`, because a pooled socket can still die
 * early (provider-side idle close, network change, laptop sleep); the window
 * only has to be long enough to absorb a burst of presses, not to track the
 * socket's real lifetime. A stale guard costs one cold handshake on the real
 * request — exactly what the code did before prewarming existed.
 */
const PREWARM_TTL_MS = 60 * 1000;

/**
 * Last SUCCESSFUL prewarm per provider. Failures are never recorded: a failed
 * warm left no usable socket, so suppressing the next attempt would make one
 * transient error disable prewarming for the whole window.
 */
const lastPrewarmAt = new Map<ProviderId, number>();

/**
 * Resolves the ref exactly like `makeAIRequest` does: a prefixed ref
 * (`"openai::gpt-4o"`) checks only its own provider against the cached model
 * list; a bare id scans `PROVIDER_ORDER`. Falls back to the ref's own prefix
 * (when it has one) when no cached model matches yet — an unpopulated or
 * stale model cache must not silently disable prewarming a provider the ref
 * already names explicitly.
 */
export const resolveProviderForModelRef = (
  modelRef: string,
  models: readonly Model[],
): ProviderId | null => {
  const resolved = resolveModelRef(modelRef, models);
  if (resolved) return resolved.provider;
  return parseModelRef(modelRef).provider;
};

/**
 * Establishes the connection with a cheap, non-billable, non-side-effectful
 * GET against the provider's model-list endpoint — never a completion. Uses
 * `fetch` directly rather than `fetchOpenAIModels`/`fetchAvailableModels`, so
 * the response is discarded and never written into the app's model cache.
 * Missing key just returns early: with no key the real request would fail
 * anyway, so there is nothing useful to warm.
 */
/**
 * Drains the response so undici can return the socket to the pool.
 *
 * `fetch` resolves as soon as the response HEADERS arrive; the body is still
 * streaming. A `Response` that is dropped without its body being read or
 * cancelled leaves that connection outstanding, so the real completion moments
 * later opens a SECOND connection — the prewarm would hold a socket instead of
 * handing one over, defeating its own purpose. Reading to completion (rather
 * than cancelling) is what actually frees the socket for reuse; cancelling can
 * tear the connection down instead, which is the opposite of the goal.
 */
const drain = async (response: { arrayBuffer: () => Promise<unknown> }): Promise<void> => {
  await response.arrayBuffer();
};

const warmOpenAI = async (): Promise<void> => {
  const profileId = getCurrentProfileId();
  const apiKey = profileId ? await getProfileSecret(profileId, "openai", "api") : null;
  if (!apiKey) return;
  const response = await keepAliveFetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(5000),
  });
  await drain(response);
};

/**
 * Mirrors `makeOpenRouterAIRequest`'s own key fallback chain.
 *
 * Hits `/credits` rather than `/models`: the body has to be drained to free
 * the socket (see `drain`), and OpenRouter's model list is megabytes, which
 * would make every warm-up download far more than the handshake it saves.
 * `/credits` is the same origin, equally read-only, and a few bytes. The
 * response is discarded either way — only the connection matters here.
 */
const warmOpenRouter = async (): Promise<void> => {
  const apiKey = await getApiKey();
  if (!apiKey) return;
  const response = await keepAliveFetch("https://openrouter.ai/api/v1/credits", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(5000),
  });
  await drain(response);
};

/**
 * Providers this module knows how to warm with a cheap, non-billable request.
 * Bedrock is cloud too but goes through the AWS SDK's SigV4-signed client
 * rather than a plain `fetch`, so it has no warm-up implementation here and is
 * skipped like a local provider — see this file's own report for the call.
 */
const WARM_BY_PROVIDER: Readonly<Partial<Record<ProviderId, () => Promise<void>>>> = {
  openai: warmOpenAI,
  openrouter: warmOpenRouter,
};

export const prewarmProviderConnection = (modelRef: string): void => {
  try {
    if (!modelRef) return;
    const provider = resolveProviderForModelRef(modelRef, getCachedModels());
    if (provider === null || LOCAL_PROVIDERS.has(provider)) return;

    const warm = WARM_BY_PROVIDER[provider];
    if (!warm) return;

    const warmedAt = lastPrewarmAt.get(provider);
    if (warmedAt !== undefined && Date.now() - warmedAt < PREWARM_TTL_MS) {
      logger.debug(LOG_SCOPE, "Prewarm skipped, connection recently warmed", {
        provider,
        ageMs: Date.now() - warmedAt,
      });
      return;
    }

    warm().then(
      () => {
        lastPrewarmAt.set(provider, Date.now());
        logger.debug(LOG_SCOPE, "Prewarm connection established", { provider });
      },
      (error: unknown) => {
        logger.debug(LOG_SCOPE, "Prewarm request failed", {
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  } catch (error) {
    logger.debug(LOG_SCOPE, "Prewarm setup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
