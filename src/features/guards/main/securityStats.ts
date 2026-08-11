/**
 * @file securityStats.ts
 * @description Reads guard-rail activity off the persisted JSONL logs and
 * returns the roll-up the Security dashboard renders. IPC channel
 * `get-security-stats` (raw string channel — only multi-origin channels get a
 * constant in `~/features/core/shared/ipcChannels.ts`).
 *
 * Two-stage narrowing so a long-lived log never has to be held in memory: day
 * folders outside the range are skipped without being read at all, and each day
 * that is read is reduced to its guard lines (`isSecurityEvent`) before the next
 * day is opened. All counting policy lives in the pure
 * `~/features/guards/shared/securityStats` module; this file only decides which
 * bytes it sees.
 *
 * A malformed range throws rather than being coerced. Neither fallback is
 * honest: `"all"` reports numbers the caller did not ask for, and an all-zero
 * roll-up reads as "no guard ever fired". A rejected invoke reaches the panel
 * as its load-failed state, which is what actually happened.
 */
import { ipcMain } from "electron";
import {
  dayFolderInRange,
  entryInRange,
  isSecurityEvent,
  isSecurityStatsRange,
  securityStatsCutoff,
  summarizeSecurityStats,
} from "~/features/guards/shared/securityStats";
import { logService } from "~/main/logging/logService";
import type { SecurityStats, SecurityStatsRange } from "~/features/guards/shared/securityStats";
import type { LogEntry } from "~/features/logs/shared/logging";

/**
 * `now` is injected so the range window is deterministic in tests, matching the
 * clock-injection style used by `startLatencyTimer` and `createClipboardObserver`.
 */
export const collectSecurityStats = async (
  range: SecurityStatsRange,
  now: Date = new Date(),
): Promise<SecurityStats> => {
  const cutoff = securityStatsCutoff(range, now);
  const days = await logService.listPersistedDays();
  const events: LogEntry[] = [];

  for (const day of days) {
    if (!dayFolderInRange(day, cutoff)) {
      // Folders are newest-first, so the first out-of-range day means every
      // remaining one is older still.
      break;
    }
    const dayEntries = await logService.readPersistedDay(day);
    for (const entry of dayEntries) {
      if (isSecurityEvent(entry) && entryInRange(entry, cutoff)) {
        events.push(entry);
      }
    }
  }

  return summarizeSecurityStats(events);
};

export const registerSecurityStatsHandlers = (): void => {
  ipcMain.handle(
    "get-security-stats",
    async (_event: Electron.IpcMainInvokeEvent, range: unknown): Promise<SecurityStats> => {
      if (!isSecurityStatsRange(range)) {
        throw new Error("Malformed security stats range");
      }
      return collectSecurityStats(range);
    },
  );
};
