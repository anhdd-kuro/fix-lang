import { describe, expect, it } from "vitest";
import {
  normalizeUsageRange,
  totalCostUsd,
  usageRangeDays,
  usageRangeStartUnix,
  utcDayKey,
  type UsageDailyPoint,
} from "./usage";

const point = (costUsd: number | null): UsageDailyPoint => ({
  date: "2026-07-01",
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd,
});

describe("usage range", () => {
  it("coerces any untrusted value to the union, defaulting to 7d", () => {
    expect(normalizeUsageRange("30d")).toBe("30d");
    expect(normalizeUsageRange("7d")).toBe("7d");
    expect(normalizeUsageRange("90d")).toBe("7d");
    expect(normalizeUsageRange(undefined)).toBe("7d");
    expect(normalizeUsageRange({ range: "30d" })).toBe("7d");
  });

  it("maps each range to its day count", () => {
    expect(usageRangeDays("7d")).toBe(7);
    expect(usageRangeDays("30d")).toBe(30);
  });

  it("aligns the window start to UTC midnight, so the time of day cannot shift it", () => {
    const morning = new Date("2026-07-28T06:00:00.000Z");
    const evening = new Date("2026-07-28T23:59:59.000Z");

    expect(usageRangeStartUnix("7d", morning)).toBe(usageRangeStartUnix("7d", evening));
    // Inclusive window: 7 days ending today means it starts 6 days back.
    expect(usageRangeStartUnix("7d", morning)).toBe(Date.UTC(2026, 6, 22) / 1000);
    expect(usageRangeStartUnix("30d", morning)).toBe(Date.UTC(2026, 5, 29) / 1000);
  });

  it("keys a date by its UTC day", () => {
    expect(utcDayKey(new Date("2026-07-28T23:30:00.000Z"))).toBe("2026-07-28");
  });
});

describe("totalCostUsd", () => {
  it("sums priced days and skips unpriced ones", () => {
    expect(totalCostUsd([point(1.5), point(null), point(2)])).toBe(3.5);
    expect(totalCostUsd([])).toBe(0);
    // All-null must total 0 without becoming NaN — the panel prints this figure.
    expect(totalCostUsd([point(null)])).toBe(0);
  });
});
