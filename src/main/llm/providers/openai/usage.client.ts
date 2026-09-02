/**
 * @file usage.client.ts
 * @description Main-process client for the OpenAI Admin usage/costs API.
 *
 * SECURITY (load-bearing): the admin key is read ONLY here via
 * `getProvisioningKey("openai")` and used solely as the `Authorization: Bearer`
 * header. It is NEVER returned to a caller, logged, or embedded in an error. The
 * renderer receives only key-free `CardResult` view-models. There is deliberately
 * no IPC that reads the key back out.
 *
 * `fetch` and `getKey` are INJECTED so unit tests pass stubs and never hit the
 * network or need electron. All I/O is async with a 5s AbortController timeout,
 * mirroring the OpenRouter client.
 */
import { describeKeyShape, findKeyShapeMismatch } from "~/features/providers/shared/providerKeyShapes";
import { getProvisioningKey } from "~/features/providers/store/provisioningKeyStore";
import { usageRangeDays, usageRangeStartUnix, type UsageRange } from "~/features/usage/shared/usage";
import { logger } from "~/main/logging/logService";
import {
  nextAfterCursor,
  nextPageCursor,
  parseCompletionsUsage,
  parseCosts,
  parseProjectCosts,
  parseProjectNames,
  withProjectNames,
  type CardResult,
  type OpenAICompletionsUsage,
  type OpenAICosts,
  type OpenAIProjectCosts,
} from "./usage.parsers";

/** Adds the `no_key` reason (admin key not configured) to the per-card result. */
export type ClientCardResult<T> =
  | CardResult<T>
  | { ok: false; reason: "no_key" };

export type OpenAIUsage = {
  hasKey: boolean;
  costs: ClientCardResult<OpenAICosts>;
  completions: ClientCardResult<OpenAICompletionsUsage>;
  projectCosts: ClientCardResult<OpenAIProjectCosts>;
};

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type ClientDeps = {
  fetch?: FetchLike;
  getKey?: () => Promise<string | null>;
  now?: () => Date;
};

const BASE = "https://api.openai.com/v1/organization";
const TIMEOUT_MS = 5000;
const NO_KEY = { ok: false, reason: "no_key" } as const;
const LOG_SCOPE = "provider.openai.admin";

/**
 * Logs one line per admin request with the key's SHAPE label, never the key. A
 * 401 carrying `keyShape: "openai-project"` says outright that a project key is
 * sitting in the admin slot — the panel's "check your admin key" cannot.
 */
const logAdminRequest = (
  path: string,
  key: string,
  outcome: { ok: boolean; status?: number; reason?: string },
): void => {
  const foreign = findKeyShapeMismatch("openai", "provisioning", key) !== null;
  const context = {
    endpoint: path,
    keyShape: describeKeyShape(key),
    ...(outcome.status !== undefined ? { status: outcome.status } : {}),
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    // Only ever true for a key stored before the write-time shape guard existed.
    ...(foreign ? { storedKeyBelongsToAnotherSlot: true } : {}),
  };

  if (outcome.ok) {
    logger.debug(LOG_SCOPE, "OpenAI admin request succeeded", context);
    return;
  }
  logger.warn(LOG_SCOPE, "OpenAI admin request failed", context);
};

/**
 * Page cap. 31 daily buckets cover the widest range, so one page normally
 * suffices; the cap only bounds a pathological `has_more` loop. Reaching it
 * degrades the card to `unavailable` rather than reporting a partial total.
 */
const MAX_PAGES = 4;

/** 401/403 → unauthorized; everything else (network, abort, 5xx) → unavailable. */
const reasonForStatus = (status: number): "unauthorized" | "unavailable" =>
  status === 401 || status === 403 ? "unauthorized" : "unavailable";

export type OpenAIUsageClient = {
  getCosts: (range: UsageRange) => Promise<ClientCardResult<OpenAICosts>>;
  getCompletionsUsage: (
    range: UsageRange,
  ) => Promise<ClientCardResult<OpenAICompletionsUsage>>;
  getProjectCosts: (
    range: UsageRange,
  ) => Promise<ClientCardResult<OpenAIProjectCosts>>;
  getUsage: (range: UsageRange) => Promise<OpenAIUsage>;
};

/** One request's outcome, before any endpoint-specific parsing. */
type FetchOutcome =
  | { ok: true; json: unknown }
  | { ok: false; reason: "unauthorized" | "unavailable" };

export const createOpenAIUsageClient = (
  deps: ClientDeps = {},
): OpenAIUsageClient => {
  const doFetch = (deps.fetch ?? (globalThis.fetch as unknown)) as FetchLike;
  const getKey = deps.getKey ?? (() => getProvisioningKey("openai"));
  const now = deps.now ?? (() => new Date());

  /**
   * One request with the Bearer key + 5s timeout, mapping every failure to a
   * reason. The ONLY place the key touches a header; it never enters the return
   * value, so a caller cannot leak it even by accident.
   */
  const fetchJson = async (
    path: string,
    query: URLSearchParams,
    key: string,
  ): Promise<FetchOutcome> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${BASE}${path}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason = reasonForStatus(response.status);
        logAdminRequest(path, key, { ok: false, status: response.status, reason });
        return { ok: false, reason };
      }
      return { ok: true, json: await response.json() };
    } catch {
      // Network error / abort / bad JSON — degrade without leaking anything.
      logAdminRequest(path, key, { ok: false, reason: "unavailable" });
      return { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  };

  /**
   * Fetch every page of `path` with the Bearer key + 5s timeout per request, then
   * hand the concatenated buckets to `parse` as one synthetic page. Returns
   * `no_key` when unconfigured and maps any failure to a reason. The key never
   * escapes this function.
   */
  const call = async <T>(
    path: string,
    range: UsageRange,
    parse: (json: unknown) => CardResult<T>,
    groupBy?: string,
  ): Promise<ClientCardResult<T>> => {
    const key = await getKey();
    if (!key) {
      logger.debug(LOG_SCOPE, "OpenAI admin request skipped — no key stored", {
        endpoint: path,
      });
      return NO_KEY;
    }

    const params = new URLSearchParams({
      start_time: String(usageRangeStartUnix(range, now())),
      bucket_width: "1d",
      // One bucket per day of the range, +1 so today's partial day still fits.
      limit: String(usageRangeDays(range) + 1),
    });
    // `group_by` is an array parameter; a single repeated key is how the API
    // reads one grouping. An unsupported value would make the endpoint return
    // ungrouped buckets, which both parsers already tolerate.
    if (groupBy !== undefined) params.append("group_by", groupBy);

    const buckets: unknown[] = [];
    let page: string | null = null;

    for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
      const query = new URLSearchParams(params);
      if (page !== null) query.set("page", page);

      const outcome = await fetchJson(path, query, key);
      if (!outcome.ok) return outcome;
      const json = outcome.json;

      const parsedPage = parse(json);
      if (!parsedPage.ok) {
        logAdminRequest(path, key, { ok: false, reason: parsedPage.reason });
        return parsedPage;
      }

      const data = (json as { data?: unknown }).data;
      if (Array.isArray(data)) buckets.push(...data);

      page = nextPageCursor(json);
      if (page === null) {
        const result = parse({ object: "page", data: buckets });
        logAdminRequest(path, key, {
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
        });
        return result;
      }
    }

    // Cap reached with the API still reporting more pages. Returning what was
    // collected would print a TRUNCATED dollar total as though it were the whole
    // range — for a billing figure, no number beats a quietly wrong one.
    return { ok: false, reason: "unavailable" };
  };

  // Cost can be grouped by line item or project — never by model. The panel's
  // per-model table therefore carries tokens only (see usage.parsers MONEY RULE).
  const getCosts = (range: UsageRange) =>
    call("/costs", range, parseCosts, "line_item");

  const getCompletionsUsage = (range: UsageRange) =>
    call("/usage/completions", range, parseCompletionsUsage, "model");

  /**
   * id → display name for every project, archived included: a project can be
   * archived and still carry spend inside the range. Any failure yields the names
   * gathered so far rather than a reason — an unresolved name only degrades a row
   * to its raw `proj_…` id, and must never sink the spend card itself.
   */
  const getProjectNames = async (): Promise<Record<string, string>> => {
    const key = await getKey();
    if (!key) return {};

    let names: Record<string, string> = {};
    let after: string | null = null;

    for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
      const query = new URLSearchParams({
        limit: "100",
        include_archived: "true",
      });
      if (after !== null) query.set("after", after);

      const outcome = await fetchJson("/projects", query, key);
      if (!outcome.ok) return names;

      const parsed = parseProjectNames(outcome.json);
      if (!parsed.ok) return names;
      names = { ...names, ...parsed.data };

      after = nextAfterCursor(outcome.json);
      if (after === null) {
        logAdminRequest("/projects", key, { ok: true });
        return names;
      }
    }
    return names;
  };

  /**
   * Billed spend per project. `project_id` is the only non-line-item grouping
   * `/costs` accepts, so these ARE real dollars — unlike the per-model table.
   * Requested separately from the line-item card on purpose: one shared request
   * with two `group_by` values would make either card's failure sink both.
   */
  const getProjectCosts = async (
    range: UsageRange,
  ): Promise<ClientCardResult<OpenAIProjectCosts>> => {
    const costs = await call("/costs", range, parseProjectCosts, "project_id");
    if (!costs.ok) return costs;
    // Nothing billed — skip the name lookup instead of paying for a request
    // whose result no row would use.
    if (costs.data.projects.length === 0) return costs;
    return {
      ok: true,
      data: withProjectNames(costs.data, await getProjectNames()),
    };
  };

  const getUsage = async (range: UsageRange): Promise<OpenAIUsage> => {
    const hasKey = (await getKey()) !== null;
    const [costs, completions, projectCosts] = await Promise.all([
      getCosts(range),
      getCompletionsUsage(range),
      getProjectCosts(range),
    ]);
    return { hasKey, costs, completions, projectCosts };
  };

  return { getCosts, getCompletionsUsage, getProjectCosts, getUsage };
};
