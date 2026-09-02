/**
 * @file usage.parsers.ts
 * @description PURE, defensive parsers for the OpenAI Admin usage/costs API.
 * Each takes ALREADY-parsed JSON (`unknown`) — fetch belongs to the client — and
 * returns a `CardResult` so one failing endpoint cannot sink the panel. Never
 * throws on shape drift: garbage yields `{ ok:false, reason:"parse_error" }`.
 *
 * MONEY RULE: OpenAI reports cost only via `/organization/costs`, which groups by
 * `line_item` or `project_id` and NEVER by model, and this app holds no OpenAI
 * price table. So per-model rows carry `costUsd: null` — the panel renders "—".
 * Deriving a per-model cost by splitting the day's total across token share
 * would put an estimate next to real billed dollars with nothing marking it as
 * one; that is deliberately not done here.
 */
import type { UsageCostSlice, UsageDailyPoint, UsageModelRow } from "~/features/usage/shared/usage";

/** Independent per-card result — mirrors the OpenRouter parsers' contract. */
export type CardResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unauthorized" | "unavailable" | "parse_error" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
};

const asString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/**
 * A `{ object: "page", data: [buckets] }` envelope. Returns null (→ parse_error
 * upstream) rather than an empty list for a non-page payload: "no buckets" and
 * "not a page at all" must not read identically.
 */
const bucketsOf = (json: unknown): Record<string, unknown>[] | null => {
  if (!isRecord(json) || !Array.isArray(json.data)) return null;
  return json.data.filter(isRecord);
};

/** Items of a `{ object: "list", data: [...] }` envelope — same guard as a page. */
const itemsOf = bucketsOf;

/** Cursor for the next page, or null when the page is the last one. */
export const nextPageCursor = (json: unknown): string | null => {
  if (!isRecord(json)) return null;
  if (json.has_more !== true) return null;
  return asString(json.next_page);
};

/**
 * Cursor for the next page of a LIST envelope. Deliberately distinct from
 * `nextPageCursor`: the usage/costs endpoints paginate with `next_page`, the
 * admin list endpoints with `after=<last_id>`. Swapping the two silently
 * re-requests page one forever instead of erroring.
 */
export const nextAfterCursor = (json: unknown): string | null => {
  if (!isRecord(json)) return null;
  if (json.has_more !== true) return null;
  return asString(json.last_id);
};

/** UTC day key of a bucket's `start_time` (unix seconds). */
const bucketDay = (bucket: Record<string, unknown>): string | null => {
  const startTime = asNumber(bucket.start_time);
  if (startTime === null) return null;
  return new Date(startTime * 1000).toISOString().slice(0, 10);
};

const resultsOf = (bucket: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(bucket.results) ? bucket.results.filter(isRecord) : [];

// ---------------------------------------------------------------------------
// Costs — /v1/organization/costs?group_by=line_item
// ---------------------------------------------------------------------------
export type OpenAICosts = {
  totalUsd: number;
  /** Real billed spend per UTC day. Token fields stay 0 — this endpoint has none. */
  daily: UsageDailyPoint[];
  /** Donut slices by billed line item, descending. Real dollars, not estimates. */
  lineItems: UsageCostSlice[];
};

/**
 * `results[].amount` is `{ value, currency }`. A non-USD currency is summed as
 * reported rather than converted — the app has no FX rate, and silently mixing
 * currencies into one "USD" total would be worse than labelling the account's own
 * numbers.
 */
const amountOf = (result: Record<string, unknown>): number => {
  const amount = result.amount;
  if (isRecord(amount)) return asNumber(amount.value) ?? 0;
  return asNumber(amount) ?? 0;
};

export const parseCosts = (json: unknown): CardResult<OpenAICosts> => {
  const buckets = bucketsOf(json);
  if (buckets === null) return { ok: false, reason: "parse_error" };

  const byDay = new Map<string, number>();
  const byLineItem = new Map<string, number>();
  let totalUsd = 0;

  for (const bucket of buckets) {
    const day = bucketDay(bucket);
    for (const result of resultsOf(bucket)) {
      const value = amountOf(result);
      totalUsd += value;
      if (day !== null) {
        byDay.set(day, (byDay.get(day) ?? 0) + value);
      }
      // An ungrouped page reports one unlabelled result per bucket; keep it
      // under a stable key so the total and the slices still agree.
      const lineItem = asString(result.line_item) ?? "";
      byLineItem.set(lineItem, (byLineItem.get(lineItem) ?? 0) + value);
    }
  }

  const daily: UsageDailyPoint[] = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, costUsd]) => ({
      date,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
    }));

  const lineItems: UsageCostSlice[] = [...byLineItem.entries()]
    .filter(([, costUsd]) => costUsd > 0)
    .map(([label, costUsd]) => ({ label, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return { ok: true, data: { totalUsd, daily, lineItems } };
};

// ---------------------------------------------------------------------------
// Project spend — /v1/organization/costs?group_by=project_id
// ---------------------------------------------------------------------------

/**
 * One project's billed spend for the range. Real dollars from the same endpoint
 * as the total, so the rows sum to it — `project_id` is the ONE non-line-item
 * grouping `/costs` supports, which is why per-project money exists here while
 * per-model money does not (see the MONEY RULE above).
 */
export type OpenAIProjectSpendRow = {
  /** `""` when the bucket carried no `project_id` (ungrouped or unattributed). */
  projectId: string;
  /** Resolved from `/organization/projects`; null when that lookup found nothing. */
  name: string | null;
  costUsd: number;
};

export type OpenAIProjectCosts = {
  totalUsd: number;
  /** Descending by spend. Zero-cost projects are dropped — a $0 row is noise. */
  projects: OpenAIProjectSpendRow[];
};

export const parseProjectCosts = (
  json: unknown,
): CardResult<OpenAIProjectCosts> => {
  const buckets = bucketsOf(json);
  if (buckets === null) return { ok: false, reason: "parse_error" };

  const byProject = new Map<string, number>();
  let totalUsd = 0;

  for (const bucket of buckets) {
    for (const result of resultsOf(bucket)) {
      const value = amountOf(result);
      totalUsd += value;
      // An ungrouped page reports one unlabelled result per bucket; the empty
      // key keeps that spend visible instead of vanishing from the rows.
      const projectId = asString(result.project_id) ?? "";
      byProject.set(projectId, (byProject.get(projectId) ?? 0) + value);
    }
  }

  const projects: OpenAIProjectSpendRow[] = [...byProject.entries()]
    .filter(([, costUsd]) => costUsd > 0)
    .map(([projectId, costUsd]) => ({ projectId, name: null, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return { ok: true, data: { totalUsd, projects } };
};

/** id → display name from `/organization/projects`. Unnamed entries are skipped. */
export const parseProjectNames = (
  json: unknown,
): CardResult<Record<string, string>> => {
  const items = itemsOf(json);
  if (items === null) return { ok: false, reason: "parse_error" };

  const names: Record<string, string> = {};
  for (const item of items) {
    const id = asString(item.id);
    const name = asString(item.name);
    if (id !== null && name !== null && name !== "") names[id] = name;
  }
  return { ok: true, data: names };
};

/** Attaches resolved names without mutating the parsed rows. */
export const withProjectNames = (
  costs: OpenAIProjectCosts,
  names: Readonly<Record<string, string>>,
): OpenAIProjectCosts => ({
  ...costs,
  projects: costs.projects.map((row) => ({
    ...row,
    name: names[row.projectId] ?? null,
  })),
});

// ---------------------------------------------------------------------------
// Completions usage — /v1/organization/usage/completions?group_by=model
// ---------------------------------------------------------------------------
export type OpenAICompletionsUsage = {
  /** Tokens/requests per UTC day. `costUsd` is null — this endpoint has no money. */
  daily: UsageDailyPoint[];
  /** Per-model rows, busiest first. `costUsd` is null — see the MONEY RULE above. */
  perModel: UsageModelRow[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
};

export const parseCompletionsUsage = (
  json: unknown,
): CardResult<OpenAICompletionsUsage> => {
  const buckets = bucketsOf(json);
  if (buckets === null) return { ok: false, reason: "parse_error" };

  const byDay = new Map<string, UsageDailyPoint>();
  const byModel = new Map<string, UsageModelRow>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalRequests = 0;

  for (const bucket of buckets) {
    const day = bucketDay(bucket);
    for (const result of resultsOf(bucket)) {
      const inputTokens = asNumber(result.input_tokens) ?? 0;
      const outputTokens = asNumber(result.output_tokens) ?? 0;
      const requests = asNumber(result.num_model_requests) ?? 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalRequests += requests;

      if (day !== null) {
        const point =
          byDay.get(day) ??
          {
            date: day,
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: null,
          };
        point.requests += requests;
        point.inputTokens += inputTokens;
        point.outputTokens += outputTokens;
        byDay.set(day, point);
      }

      const model = asString(result.model);
      if (model === null) {
        // An ungrouped page has no model field; its totals above still count,
        // but it cannot become a per-model row.
        continue;
      }
      const row =
        byModel.get(model) ??
        {
          model,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
        };
      row.requests += requests;
      row.inputTokens += inputTokens;
      row.outputTokens += outputTokens;
      byModel.set(model, row);
    }
  }

  return {
    ok: true,
    data: {
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      perModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
      totalInputTokens,
      totalOutputTokens,
      totalRequests,
    },
  };
};
