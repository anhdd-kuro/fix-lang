/**
 * @file parsers.test.ts
 * @description Pure tests for the OpenRouter response parsers (#59). Uses
 * hand-written fixtures from the documented field shapes (no live API, no
 * fetch, no electron). Each endpoint covers happy + unauthorized/garbage; all
 * parsers must be total (never throw). NOTE: real per-endpoint JSON should be
 * captured against a live account to lock these fixtures (flagged for QA).
 */
import { describe, expect, it } from "vitest";
import {
  LOW_BALANCE_THRESHOLD_USD,
  parseActivity,
  parseCredits,
  parseKeyUsage,
  parseProvisioningKeys,
} from "./parsers";

describe("parseCredits", () => {
  it("extracts available credit (total_credits - total_usage); lowBalance below threshold", () => {
    const r = parseCredits({ data: { total_credits: 10, total_usage: 7 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.availableUsd).toBe(3);
      expect(r.data.lowBalance).toBe(true); // 3 < 5
    }
  });

  it("lowBalance is false when available >= threshold", () => {
    const r = parseCredits({ data: { total_credits: 100, total_usage: 10 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.availableUsd).toBe(90);
      expect(r.data.lowBalance).toBe(false);
      expect(LOW_BALANCE_THRESHOLD_USD).toBe(5);
    }
  });

  it("falls back to a direct remaining field", () => {
    const r = parseCredits({ data: { limit_remaining: 42 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.availableUsd).toBe(42);
    }
  });

  it("garbage/non-object → parse_error, no throw", () => {
    expect(parseCredits(null)).toEqual({ ok: false, reason: "parse_error" });
    expect(parseCredits("nope")).toEqual({ ok: false, reason: "parse_error" });
    expect(parseCredits({ data: {} })).toEqual({
      ok: false,
      reason: "parse_error",
    });
  });
});

describe("parseKeyUsage", () => {
  it("derives label/usage/limit and limitReached", () => {
    const r = parseKeyUsage({
      data: { label: "fixlang", usage: 8, limit: 10, limit_remaining: 2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.label).toBe("fixlang");
      expect(r.data.usageUsd).toBe(8);
      expect(r.data.limitUsd).toBe(10);
      expect(r.data.limitReached).toBe(false);
    }
  });

  it("limitReached true when remaining <= 0", () => {
    const r = parseKeyUsage({ data: { usage: 10, limit: 10, limit_remaining: 0 } });
    expect(r.ok && r.data.limitReached).toBe(true);
  });

  it("unlimited key (no limit) → limitUsd null, not reached", () => {
    const r = parseKeyUsage({ data: { usage: 5, limit: null } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.limitUsd).toBeNull();
      expect(r.data.limitReached).toBe(false);
    }
  });

  it("missing usage / garbage → parse_error", () => {
    expect(parseKeyUsage({ data: {} }).ok).toBe(false);
    expect(parseKeyUsage(123).ok).toBe(false);
  });
});

describe("parseActivity", () => {
  const NOW = new Date("2024-06-20T10:00:00Z");
  const rows = {
    data: [
      { date: "2024-06-20", model: "openai/gpt-4o", requests: 3, prompt_tokens: 100, completion_tokens: 50, usage: 0.01 },
      { date: "2024-06-19", model: "openai/gpt-4o", requests: 2, prompt_tokens: 80, completion_tokens: 40, usage: 0.008 },
      { date: "2024-06-01", model: "anthropic/claude", requests: 5, prompt_tokens: 500, completion_tokens: 200, usage: 0.05 },
    ],
  };

  it("30d aggregates per-model across all returned rows", () => {
    const r = parseActivity(rows, "30d", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const gpt = r.data.rows.find((x) => x.model === "openai/gpt-4o");
      expect(gpt?.requests).toBe(5);
      expect(gpt?.promptTokens).toBe(180);
      expect(gpt?.costUsd).toBeCloseTo(0.018, 10);
      expect(r.data.rows).toHaveLength(2);
    }
  });

  it("7d slices to only the last 7 completed UTC days", () => {
    const r = parseActivity(rows, "7d", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The 2024-06-01 claude row is outside the 7d window.
      expect(r.data.rows.map((x) => x.model)).toEqual(["openai/gpt-4o"]);
      expect(r.data.rows[0].requests).toBe(5);
    }
  });

  it("non-array / garbage → parse_error; skips garbage rows without throwing", () => {
    expect(parseActivity({ data: "nope" }, "30d", NOW).ok).toBe(false);
    const mixed = parseActivity(
      { data: [{ model: "m", requests: 1 }, null, 42, { date: "x" }] },
      "30d",
      NOW
    );
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.data.rows).toHaveLength(1);
      expect(mixed.data.rows[0].model).toBe("m");
    }
  });

  it("empty array → ok with empty rows", () => {
    const r = parseActivity({ data: [] }, "30d", NOW);
    expect(r.ok && r.data.rows).toEqual([]);
  });
});

describe("parseProvisioningKeys", () => {
  it("counts enabled keys, ignoring disabled ones", () => {
    const r = parseProvisioningKeys({
      data: [
        { name: "a", disabled: false },
        { name: "b" }, // enabled (no disabled flag)
        { name: "c", disabled: true },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.enabledCount).toBe(2);
      expect(r.data.totalCount).toBe(3);
    }
  });

  it("non-array / garbage → parse_error", () => {
    expect(parseProvisioningKeys({ data: {} }).ok).toBe(false);
    expect(parseProvisioningKeys(null).ok).toBe(false);
  });
});
