/**
 * @file securityStats.test.ts
 * @description The disk walk only — counting policy is tested in the pure
 * `~/features/guards/shared/securityStats` module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectSecurityStats } from "./securityStats";
import type { LogContext, LogEntry } from "~/features/logs/shared/logging";

const listPersistedDays = vi.fn<() => Promise<string[]>>();
const readPersistedDay = vi.fn<(dayKey: string) => Promise<LogEntry[]>>();

vi.mock("~/main/logging/logService", () => ({
  logService: {
    listPersistedDays: () => listPersistedDays(),
    readPersistedDay: (dayKey: string) => readPersistedDay(dayKey),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let idCounter = 0;

const entry = (scope: string, timestamp: string, context: LogContext): LogEntry => {
  idCounter += 1;
  return {
    id: `entry-${String(idCounter)}`,
    timestamp,
    level: "info",
    scope,
    message: "Guard event",
    context,
  };
};

const blocked = (timestamp: string): LogEntry =>
  entry("correction.hotkey", timestamp, {
    presetId: "correction",
    guardEvent: "blocked",
    guardReason: "denied-app",
  });

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("collectSecurityStats", () => {
  beforeEach(() => {
    listPersistedDays.mockReset();
    readPersistedDay.mockReset();
    readPersistedDay.mockResolvedValue([]);
  });

  it("returns the empty roll-up when nothing is persisted", async () => {
    listPersistedDays.mockResolvedValue([]);

    const stats = await collectSecurityStats("all", NOW);

    expect(stats.eventCount).toBe(0);
    expect(readPersistedDay).not.toHaveBeenCalled();
  });

  it("reads every day folder for `all`", async () => {
    listPersistedDays.mockResolvedValue(["2026-08-11", "2025-01-02"]);
    readPersistedDay.mockImplementation(async (day) =>
      day === "2026-08-11"
        ? [blocked("2026-08-11T09:00:00.000Z")]
        : [blocked("2025-01-02T09:00:00.000Z")],
    );

    const stats = await collectSecurityStats("all", NOW);

    expect(stats.blockedByApp).toBe(2);
    expect(readPersistedDay).toHaveBeenCalledTimes(2);
  });

  /** Without the break, two years of logs are re-read on every range switch. */
  it("stops at the first out-of-range day instead of walking the whole archive", async () => {
    listPersistedDays.mockResolvedValue([
      "2026-08-11",
      "2026-08-09",
      "2026-07-01",
      "2025-01-02",
    ]);
    readPersistedDay.mockResolvedValue([blocked("2026-08-09T09:00:00.000Z")]);

    await collectSecurityStats("7d", NOW);

    expect(readPersistedDay.mock.calls.map(([day]) => day)).toEqual(["2026-08-11", "2026-08-09"]);
  });

  /**
   * Both halves matter: without the surplus folder a whole local day is lost;
   * without the entry filter the window stretches by a day.
   */
  it("keeps the boundary folder but drops the entries that fall before the cutoff", async () => {
    listPersistedDays.mockResolvedValue(["2026-08-04", "2026-08-03"]);
    readPersistedDay.mockImplementation(async (day) =>
      day === "2026-08-04"
        ? [blocked("2026-08-04T13:00:00.000Z")]
        : [blocked("2026-08-03T23:00:00.000Z")],
    );

    const stats = await collectSecurityStats("7d", NOW);

    expect(readPersistedDay).toHaveBeenCalledTimes(2);
    expect(stats.blockedByApp).toBe(1);
    expect(stats.lastEventAt).toBe("2026-08-04T13:00:00.000Z");
  });

  it("ignores non-guard lines sharing a day file", async () => {
    listPersistedDays.mockResolvedValue(["2026-08-11"]);
    readPersistedDay.mockResolvedValue([
      entry("correction.hotkey", "2026-08-11T09:00:00.000Z", { delivery: "paste" }),
      entry("logs", "2026-08-11T09:00:01.000Z", {}),
      blocked("2026-08-11T09:00:02.000Z"),
    ]);

    const stats = await collectSecurityStats("30d", NOW);

    expect(stats.eventCount).toBe(1);
    expect(stats.blockedByApp).toBe(1);
  });
});
