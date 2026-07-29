/**
 * @file usage.client.test.ts
 * @description Tests for the OpenAI usage client with an INJECTED stub fetch +
 * stub getKey — no network, no electron, no real key. Verifies the no_key
 * short-circuit, status→reason mapping, the request window, pagination, and that
 * the key never leaks into a returned value.
 */
import { describe, expect, it, vi } from "vitest";
import { createOpenAIUsageClient } from "./usage.client";

const NOW = new Date("2026-07-28T15:04:05.000Z");
const KEY = "sk-admin-secret";

type StubResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const okResponse = (body: unknown): StubResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const errResponse = (status: number): StubResponse => ({
  ok: false,
  status,
  json: async () => ({}),
});

const emptyPage = {
  object: "page",
  data: [],
  has_more: false,
  next_page: null,
};

const clientWith = (
  fetchImpl: (url: string, init: unknown) => Promise<StubResponse>,
  key: string | null = KEY,
) =>
  createOpenAIUsageClient({
    fetch: fetchImpl as never,
    getKey: async () => key,
    now: () => NOW,
  });

describe("createOpenAIUsageClient", () => {
  it("returns no_key and never calls fetch when no admin key is stored", async () => {
    const fetchStub = vi.fn();
    const client = clientWith(fetchStub as never, null);

    expect(await client.getCosts("7d")).toEqual({
      ok: false,
      reason: "no_key",
    });
    expect(await client.getCompletionsUsage("7d")).toEqual({
      ok: false,
      reason: "no_key",
    });
    expect(await client.getUsage("7d")).toEqual({
      hasKey: false,
      costs: { ok: false, reason: "no_key" },
      completions: { ok: false, reason: "no_key" },
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("maps 401/403 → unauthorized and anything else → unavailable", async () => {
    expect(
      await clientWith(async () => errResponse(401)).getCosts("7d"),
    ).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(
      await clientWith(async () => errResponse(403)).getCompletionsUsage("7d"),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(
      await clientWith(async () => errResponse(500)).getCosts("30d"),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("degrades to unavailable when the transport throws, without leaking the key", async () => {
    const result = await clientWith(async () => {
      throw new Error(`boom ${KEY}`);
    }).getCosts("7d");

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("sends the key as a Bearer header and never returns it", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const client = clientWith(async (url, init) => {
      seen.push({
        url,
        headers: (init as { headers: Record<string, string> }).headers,
      });
      return okResponse(emptyPage);
    });

    const usage = await client.getUsage("7d");

    expect(seen).toHaveLength(2);
    expect(seen[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(usage)).not.toContain(KEY);
  });

  it("requests UTC-midnight-aligned daily buckets, grouped for each endpoint", async () => {
    const urls: string[] = [];
    const client = clientWith(async (url) => {
      urls.push(url);
      return okResponse(emptyPage);
    });

    await client.getUsage("7d");

    const costs = new URL(urls.find((url) => url.includes("/costs")) ?? "");
    const completions = new URL(
      urls.find((url) => url.includes("/usage/completions")) ?? "",
    );
    // 7d window ending on 2026-07-28 UTC starts at 2026-07-22T00:00:00Z; the
    // midnight alignment is what keeps a mid-afternoon refresh returning the
    // same buckets as a morning one.
    const expectedStart = String(Date.UTC(2026, 6, 22) / 1000);

    expect(costs.searchParams.get("start_time")).toBe(expectedStart);
    expect(costs.searchParams.get("bucket_width")).toBe("1d");
    expect(costs.searchParams.get("limit")).toBe("8");
    expect(costs.searchParams.get("group_by")).toBe("line_item");
    expect(completions.searchParams.get("group_by")).toBe("model");
  });

  it("widens the window for a 30d range", async () => {
    const urls: string[] = [];
    const client = clientWith(async (url) => {
      urls.push(url);
      return okResponse(emptyPage);
    });

    await client.getCosts("30d");

    const params = new URL(urls[0]).searchParams;
    expect(params.get("start_time")).toBe(String(Date.UTC(2026, 5, 29) / 1000));
    expect(params.get("limit")).toBe("31");
  });

  it("follows pagination and aggregates every page's buckets into one result", async () => {
    const bucket = (startTime: number, amount: number) => ({
      object: "bucket",
      start_time: startTime,
      results: [
        { amount: { value: amount, currency: "usd" }, line_item: "gpt-5" },
      ],
    });
    const pages: Record<string, unknown> = {
      "": {
        object: "page",
        data: [bucket(Date.UTC(2026, 6, 22) / 1000, 1)],
        has_more: true,
        next_page: "cursor-2",
      },
      "cursor-2": {
        object: "page",
        data: [bucket(Date.UTC(2026, 6, 23) / 1000, 2)],
        has_more: false,
        next_page: null,
      },
    };
    const requestedPages: string[] = [];

    const client = clientWith(async (url) => {
      const page = new URL(url).searchParams.get("page") ?? "";
      requestedPages.push(page);
      return okResponse(pages[page]);
    });

    const result = await client.getCosts("7d");

    expect(requestedPages).toEqual(["", "cursor-2"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalUsd).toBe(3);
    expect(result.data.daily).toHaveLength(2);
  });

  it("stops at the page cap and degrades rather than reporting a truncated total", async () => {
    let calls = 0;
    const client = clientWith(async () => {
      calls += 1;
      return okResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: Date.UTC(2026, 6, 22) / 1000,
            results: [{ amount: { value: 1, currency: "usd" } }],
          },
        ],
        has_more: true,
        next_page: "always-more",
      });
    });

    const result = await client.getCosts("7d");

    expect(calls).toBe(4);
    // A partial spend figure printed as the range total is worse than no figure.
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports hasKey and both cards together from one getUsage call", async () => {
    const client = clientWith(async () => okResponse(emptyPage));

    const usage = await client.getUsage("7d");

    expect(usage.hasKey).toBe(true);
    expect(usage.costs.ok).toBe(true);
    expect(usage.completions.ok).toBe(true);
  });

  it("preserves successful completions when costs are temporarily unavailable", async () => {
    const client = clientWith(async (url) =>
      url.includes("/costs") ? errResponse(500) : okResponse(emptyPage),
    );

    const usage = await client.getUsage("7d");

    expect(usage.costs).toEqual({ ok: false, reason: "unavailable" });
    expect(usage.completions.ok).toBe(true);
  });
});
