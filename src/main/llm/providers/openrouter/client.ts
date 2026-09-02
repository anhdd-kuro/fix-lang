/**
 * @file client.ts
 * @description Main-process OpenRouter account-analytics client (#59).
 *
 * SECURITY (load-bearing): the provisioning key is read ONLY here in the main
 * process via `getProvisioningKey()` and used solely as the `Authorization:
 * Bearer` header. It is NEVER returned to a caller, logged, or placed in an
 * error. The renderer receives only the parsed, key-free `CardResult` view
 * models. There is deliberately no `get-provisioning-key` IPC.
 *
 * `fetch` and `getKey` are INJECTED so unit tests pass stubs and never hit the
 * network / never need electron. All I/O is async with a 5s AbortController
 * timeout (mirrors the existing model-list fetch in ai.request/shared.ts).
 */
import { describeKeyShape, findKeyShapeMismatch } from "~/features/providers/shared/providerKeyShapes";
import { getProvisioningKey } from "~/features/providers/store/provisioningKeyStore";
import { logger } from "~/main/logging/logService";
import {
  parseActivity,
  parseCredits,
  parseKeyUsage,
  parseProvisioningKeys,
  type Activity,
  type CardResult,
  type Credits,
  type EnabledKeys,
  type KeyUsage,
} from "./parsers";

/** Adds the `no_key` reason (key not configured) to the per-endpoint result. */
export type ClientCardResult<T> =
  | CardResult<T>
  | { ok: false; reason: "no_key" };

export type OpenRouterAnalytics = {
  hasKey: boolean;
  credits: ClientCardResult<Credits>;
  keyUsage: ClientCardResult<KeyUsage>;
  activity: ClientCardResult<Activity>;
  enabledKeys: ClientCardResult<EnabledKeys>;
};

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type ClientDeps = {
  fetch?: FetchLike;
  getKey?: () => Promise<string | null>;
};

const BASE = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 5000;
const NO_KEY = { ok: false, reason: "no_key" } as const;
const LOG_SCOPE = "provider.openrouter.admin";

/**
 * Logs one line per account request. The key is never logged — only its SHAPE
 * label, which is what a 401 investigation actually needs: an OpenRouter 401
 * with `keyShape: "openai-admin"` names the cause outright, where the bare
 * "Unauthorized — check your provisioning key" in the panel could not.
 */
const logAdminRequest = (
  path: string,
  key: string,
  outcome: { ok: boolean; status?: number; reason?: string },
): void => {
  const shape = describeKeyShape(key);
  const foreign = findKeyShapeMismatch("openrouter", "provisioning", key) !== null;
  const context = {
    endpoint: path,
    keyShape: shape,
    ...(outcome.status !== undefined ? { status: outcome.status } : {}),
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    // Only ever true for a key stored before the write-time shape guard existed.
    ...(foreign ? { storedKeyBelongsToAnotherProvider: true } : {}),
  };

  if (outcome.ok) {
    logger.debug(LOG_SCOPE, "OpenRouter account request succeeded", context);
    return;
  }
  logger.warn(LOG_SCOPE, "OpenRouter account request failed", context);
};

/**
 * Map a transport failure to a degraded reason. 401/403 → unauthorized;
 * anything else (incl. network/abort) → unavailable. Never includes the key.
 */
const reasonForStatus = (status: number): "unauthorized" | "unavailable" =>
  status === 401 || status === 403 ? "unauthorized" : "unavailable";

export type OpenRouterClient = {
  getCredits: () => Promise<ClientCardResult<Credits>>;
  getKeyUsage: () => Promise<ClientCardResult<KeyUsage>>;
  getActivity: (range: "7d" | "30d") => Promise<ClientCardResult<Activity>>;
  getEnabledKeyCount: () => Promise<ClientCardResult<EnabledKeys>>;
  getAnalytics: (range: "7d" | "30d") => Promise<OpenRouterAnalytics>;
};

export const createOpenRouterClient = (
  deps: ClientDeps = {}
): OpenRouterClient => {
  const doFetch = (deps.fetch ?? (globalThis.fetch as unknown)) as FetchLike;
  const getKey = deps.getKey ?? (() => getProvisioningKey("openrouter"));

  /**
   * Fetch `path` with the Bearer key + 5s timeout, then hand the parsed JSON to
   * `parse`. Returns `no_key` when unconfigured; maps !ok / errors to a reason.
   * The key never escapes this function.
   */
  const call = async <T>(
    path: string,
    parse: (json: unknown) => CardResult<T>
  ): Promise<ClientCardResult<T>> => {
    const key = await getKey();
    if (!key) {
      logger.debug(LOG_SCOPE, "OpenRouter account request skipped — no key stored", {
        endpoint: path,
      });
      return NO_KEY;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason = reasonForStatus(response.status);
        logAdminRequest(path, key, { ok: false, status: response.status, reason });
        return { ok: false, reason };
      }
      const json = await response.json();
      const parsed = parse(json);
      logAdminRequest(path, key, {
        ok: parsed.ok,
        status: response.status,
        ...(parsed.ok ? {} : { reason: parsed.reason }),
      });
      return parsed;
    } catch {
      // Network error / abort / bad JSON — degrade without leaking anything.
      logAdminRequest(path, key, { ok: false, reason: "unavailable" });
      return { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  };

  const getCredits = () => call("/credits", parseCredits);
  const getKeyUsage = () => call("/key", parseKeyUsage);
  const getActivity = (range: "7d" | "30d") =>
    call("/activity", (json) => parseActivity(json, range));
  const getEnabledKeyCount = () => call("/keys", parseProvisioningKeys);

  const getAnalytics = async (
    range: "7d" | "30d"
  ): Promise<OpenRouterAnalytics> => {
    const hasKey = (await getKey()) !== null;
    const [credits, keyUsage, activity, enabledKeys] = await Promise.all([
      getCredits(),
      getKeyUsage(),
      getActivity(range),
      getEnabledKeyCount(),
    ]);
    return { hasKey, credits, keyUsage, activity, enabledKeys };
  };

  return {
    getCredits,
    getKeyUsage,
    getActivity,
    getEnabledKeyCount,
    getAnalytics,
  };
};
