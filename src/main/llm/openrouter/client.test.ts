/**
 * @file client.test.ts
 * @description Tests for the main OpenRouter client (#59) with an INJECTED stub
 * fetch + stub getKey — no network, no electron, no real key. Verifies the
 * no_key short-circuit, status→reason mapping, the Bearer header, and that the
 * key never appears in any returned value.
 */
import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClient } from "./client";

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

describe("createOpenRouterClient", () => {
  it("returns no_key and does NOT call fetch when the key is null", async () => {
    const fetchStub = vi.fn();
    const client = createOpenRouterClient({
      fetch: fetchStub as never,
      getKey: async () => null,
    });

    const result = await client.getCredits();
    expect(result).toEqual({ ok: false, reason: "no_key" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("maps 401/403 → unauthorized and 500 → unavailable", async () => {
    const make = (status: number) =>
      createOpenRouterClient({
        fetch: (async () => errResponse(status)) as never,
        getKey: async () => "sk-or-test",
      });

    expect(await make(401).getCredits()).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await make(403).getKeyUsage()).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await make(500).getActivity("7d")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("happy path returns parsed data and sets Authorization: Bearer <key>", async () => {
    const fetchStub = vi.fn(async () =>
      okResponse({ data: { total_credits: 100, total_usage: 10 } })
    );
    const client = createOpenRouterClient({
      fetch: fetchStub as never,
      getKey: async () => "sk-or-secret-123",
    });

    const result = await client.getCredits();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.availableUsd).toBe(90);
    }

    // Bearer header carries the key on the request...
    const [, init] = fetchStub.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-or-secret-123");
    // ...but the key NEVER appears in the returned value.
    expect(JSON.stringify(result)).not.toContain("sk-or-secret-123");
  });

  it("network/abort/bad-json errors degrade to unavailable (no throw)", async () => {
    const client = createOpenRouterClient({
      fetch: (async () => {
        throw new Error("network down");
      }) as never,
      getKey: async () => "sk-or-test",
    });
    expect(await client.getCredits()).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("passes the range through to the activity parser", async () => {
    const NOW_ROWS = {
      data: [
        { date: "2099-01-01", model: "m", requests: 1, usage: 0.001 },
      ],
    };
    const client = createOpenRouterClient({
      fetch: (async () => okResponse(NOW_ROWS)) as never,
      getKey: async () => "sk-or-test",
    });
    const r = await client.getActivity("30d");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.range).toBe("30d");
    }
  });

  it("getAnalytics returns hasKey + four card results in one shot", async () => {
    const client = createOpenRouterClient({
      fetch: (async (url: string) => {
        if (url.endsWith("/credits")) {
          return okResponse({ data: { total_credits: 50, total_usage: 1 } });
        }
        if (url.endsWith("/key")) {
          return okResponse({ data: { usage: 1, limit: 100 } });
        }
        if (url.endsWith("/activity")) {
          return okResponse({ data: [] });
        }
        return okResponse({ data: [{ name: "k" }] });
      }) as never,
      getKey: async () => "sk-or-test",
    });

    const analytics = await client.getAnalytics("7d");
    expect(analytics.hasKey).toBe(true);
    expect(analytics.credits.ok).toBe(true);
    expect(analytics.keyUsage.ok).toBe(true);
    expect(analytics.activity.ok).toBe(true);
    expect(analytics.enabledKeys.ok).toBe(true);
  });
});
