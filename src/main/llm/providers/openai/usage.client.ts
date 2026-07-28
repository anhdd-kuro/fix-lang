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
import { usageRangeDays, usageRangeStartUnix, type UsageRange } from "~/shared/usage";
import { getProvisioningKey } from "~/stores/provisioningKeyStore";
import {
  nextPageCursor,
  parseCompletionsUsage,
  parseCosts,
  type CardResult,
  type OpenAICompletionsUsage,
  type OpenAICosts,
} from "./usage.parsers";

/** Adds the `no_key` reason (admin key not configured) to the per-card result. */
export type ClientCardResult<T> =
  | CardResult<T>
  | { ok: false; reason: "no_key" };

export type OpenAIUsage = {
  hasKey: boolean;
  costs: ClientCardResult<OpenAICosts>;
  completions: ClientCardResult<OpenAICompletionsUsage>;
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
  getUsage: (range: UsageRange) => Promise<OpenAIUsage>;
};

export const createOpenAIUsageClient = (
  deps: ClientDeps = {},
): OpenAIUsageClient => {
  const doFetch = (deps.fetch ?? (globalThis.fetch as unknown)) as FetchLike;
  const getKey = deps.getKey ?? (() => getProvisioningKey("openai"));
  const now = deps.now ?? (() => new Date());

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
    if (!key) return NO_KEY;

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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let json: unknown;
      try {
        const response = await doFetch(`${BASE}${path}?${query.toString()}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          return { ok: false, reason: reasonForStatus(response.status) };
        }
        json = await response.json();
      } catch {
        // Network error / abort / bad JSON — degrade without leaking anything.
        return { ok: false, reason: "unavailable" };
      } finally {
        clearTimeout(timeout);
      }

      const parsedPage = parse(json);
      if (!parsedPage.ok) return parsedPage;

      const data = (json as { data?: unknown }).data;
      if (Array.isArray(data)) buckets.push(...data);

      page = nextPageCursor(json);
      if (page === null) {
        return parse({ object: "page", data: buckets });
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

  const getUsage = async (range: UsageRange): Promise<OpenAIUsage> => {
    const hasKey = (await getKey()) !== null;
    const [costs, completions] = await Promise.all([
      getCosts(range),
      getCompletionsUsage(range),
    ]);
    return { hasKey, costs, completions };
  };

  return { getCosts, getCompletionsUsage, getUsage };
};
