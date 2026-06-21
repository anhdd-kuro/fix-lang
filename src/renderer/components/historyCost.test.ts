/**
 * @file historyCost.test.ts
 * @description Unit tests for the pure formatCost helper (#56).
 */
import { describe, expect, it } from "vitest";
import { formatCost } from "./historyCost";

describe("formatCost", () => {
  it("renders N/A for status 'na'", () => {
    expect(formatCost({ costStatus: "na", estimatedCostUsd: null })).toBe("N/A");
  });

  it("renders N/A for a legacy/migrated entry with no cost fields", () => {
    expect(formatCost({})).toBe("N/A");
  });

  it("renders $0.00 for a genuine zero (local/Ollama)", () => {
    expect(formatCost({ costStatus: "zero", estimatedCostUsd: 0 })).toBe(
      "$0.00"
    );
  });

  it("renders a USD amount for a priced 'ok' cost", () => {
    expect(formatCost({ costStatus: "ok", estimatedCostUsd: 1.23 })).toBe(
      "$1.23"
    );
  });

  it("does not collapse a tiny sub-cent 'ok' cost to $0.00", () => {
    const label = formatCost({ costStatus: "ok", estimatedCostUsd: 0.0006 });
    expect(label).not.toBe("$0.00");
    expect(label).toBe("$0.0006");
  });

  it("renders N/A for an 'ok' status with a null cost (inconsistent state)", () => {
    expect(formatCost({ costStatus: "ok", estimatedCostUsd: null })).toBe(
      "N/A"
    );
  });

  it("renders $0.00 when an 'ok' cost is exactly zero", () => {
    expect(formatCost({ costStatus: "ok", estimatedCostUsd: 0 })).toBe("$0.00");
  });
});
