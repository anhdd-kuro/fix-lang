import { describe, expect, it } from "vitest";
import {
  nextPageCursor,
  parseCompletionsUsage,
  parseCosts,
} from "./usage.parsers";

/** 2026-07-01T00:00:00Z and the two following days, as unix seconds. */
const DAY_1 = Date.UTC(2026, 6, 1) / 1000;
const DAY_2 = Date.UTC(2026, 6, 2) / 1000;

const costBucket = (
  startTime: number,
  results: { amount: number; line_item?: string | null }[],
) => ({
  object: "bucket",
  start_time: startTime,
  results: results.map(({ amount, line_item }) => ({
    object: "organization.costs.result",
    amount: { value: amount, currency: "usd" },
    ...(line_item === undefined ? {} : { line_item }),
  })),
});

const usageBucket = (
  startTime: number,
  results: {
    input_tokens?: number;
    output_tokens?: number;
    num_model_requests?: number;
    model?: string;
  }[],
) => ({
  object: "bucket",
  start_time: startTime,
  results: results.map((result) => ({
    object: "organization.usage.completions.result",
    ...result,
  })),
});

const page = (data: unknown[], extra: Record<string, unknown> = {}) => ({
  object: "page",
  data,
  has_more: false,
  next_page: null,
  ...extra,
});

describe("parseCosts", () => {
  it("totals billed spend, per UTC day and per line item", () => {
    const result = parseCosts(
      page([
        costBucket(DAY_1, [
          { amount: 1.25, line_item: "gpt-5, input" },
          { amount: 0.5, line_item: "gpt-5, output" },
        ]),
        costBucket(DAY_2, [{ amount: 2, line_item: "gpt-5, input" }]),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalUsd).toBeCloseTo(3.75, 10);
    expect(result.data.daily.map((point) => [point.date, point.costUsd])).toEqual([
      ["2026-07-01", 1.75],
      ["2026-07-02", 2],
    ]);
    // Descending, so the donut's first slice is the biggest spend.
    expect(result.data.lineItems).toEqual([
      { label: "gpt-5, input", costUsd: 3.25 },
      { label: "gpt-5, output", costUsd: 0.5 },
    ]);
  });

  it("carries no token counts — this endpoint reports money only", () => {
    const result = parseCosts(page([costBucket(DAY_1, [{ amount: 1 }])]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.daily[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    });
  });

  it("keeps an ungrouped page's spend under one unlabelled slice, so slices still sum to the total", () => {
    const result = parseCosts(page([costBucket(DAY_1, [{ amount: 4 }])]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalUsd).toBe(4);
    expect(result.data.lineItems).toEqual([{ label: "", costUsd: 4 }]);
  });

  it("tolerates a bare numeric amount and garbage results without throwing", () => {
    const result = parseCosts({
      object: "page",
      data: [
        { start_time: DAY_1, results: [{ amount: 2 }, "nonsense", null] },
        "not-a-bucket",
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalUsd).toBe(2);
  });

  it("reports parse_error for a payload that is not a page", () => {
    expect(parseCosts({ nope: true })).toEqual({ ok: false, reason: "parse_error" });
    expect(parseCosts(null)).toEqual({ ok: false, reason: "parse_error" });
  });

  it("reads an empty page as zero spend, not as a parse failure", () => {
    expect(parseCosts(page([]))).toEqual({
      ok: true,
      data: { totalUsd: 0, daily: [], lineItems: [] },
    });
  });
});

describe("parseCompletionsUsage", () => {
  it("aggregates per day and per model, ordering models by requests", () => {
    const result = parseCompletionsUsage(
      page([
        usageBucket(DAY_1, [
          { model: "gpt-5", input_tokens: 100, output_tokens: 10, num_model_requests: 2 },
          { model: "gpt-5-mini", input_tokens: 20, output_tokens: 5, num_model_requests: 9 },
        ]),
        usageBucket(DAY_2, [
          { model: "gpt-5", input_tokens: 50, output_tokens: 5, num_model_requests: 1 },
        ]),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.daily).toEqual([
      {
        date: "2026-07-01",
        requests: 11,
        inputTokens: 120,
        outputTokens: 15,
        costUsd: null,
      },
      {
        date: "2026-07-02",
        requests: 1,
        inputTokens: 50,
        outputTokens: 5,
        costUsd: null,
      },
    ]);
    expect(result.data.perModel.map((row) => row.model)).toEqual([
      "gpt-5-mini",
      "gpt-5",
    ]);
    expect(result.data.totalInputTokens).toBe(170);
    expect(result.data.totalOutputTokens).toBe(20);
    expect(result.data.totalRequests).toBe(12);
  });

  it("never invents a per-model cost — the API cannot group cost by model", () => {
    const result = parseCompletionsUsage(
      page([usageBucket(DAY_1, [{ model: "gpt-5", input_tokens: 1 }])]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.perModel[0].costUsd).toBeNull();
    expect(result.data.daily[0].costUsd).toBeNull();
  });

  it("counts a result with no model in the totals but not as a model row", () => {
    const result = parseCompletionsUsage(
      page([usageBucket(DAY_1, [{ input_tokens: 7, num_model_requests: 3 }])]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalInputTokens).toBe(7);
    expect(result.data.totalRequests).toBe(3);
    expect(result.data.perModel).toEqual([]);
    expect(result.data.daily[0].requests).toBe(3);
  });

  it("reports parse_error for a non-page payload", () => {
    expect(parseCompletionsUsage([])).toEqual({ ok: false, reason: "parse_error" });
  });
});

describe("nextPageCursor", () => {
  it("returns the cursor only while the API says there is more", () => {
    expect(nextPageCursor(page([], { has_more: true, next_page: "cursor-2" }))).toBe(
      "cursor-2",
    );
    expect(nextPageCursor(page([], { has_more: false, next_page: "cursor-2" }))).toBeNull();
    expect(nextPageCursor(page([], { has_more: true, next_page: null }))).toBeNull();
    expect(nextPageCursor("nope")).toBeNull();
  });
});
