/**
 * @file securityStats.ts
 * @description Reads guard-rail activity off the persisted JSONL logs for the
 * Security dashboard tab. Raw string channel `get-security-stats` — only
 * multi-origin channels get a constant in `~/features/core/shared/ipcChannels.ts`.
 *
 * Decides only which bytes the pure `~/features/guards/shared/securityStats`
 * module sees; all counting policy lives there.
 *
 * A malformed range throws rather than being coerced. Neither fallback is
 * honest: `"all"` answers a question the caller did not ask, and an all-zero
 * roll-up reads as "no guard ever fired". A rejected invoke reaches the panel as
 * its load-failed state, which is what actually happened.
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

/** `now` is injected to keep the range window deterministic in tests. */
export const collectSecurityStats = async (
  range: SecurityStatsRange,
  now: Date = new Date(),
): Promise<SecurityStats> => {
  const cutoff = securityStatsCutoff(range, now);
  const days = await logService.listPersistedDays();
  const events: LogEntry[] = [];

  for (const day of days) {
    // Newest-first, so the first out-of-range day means every remaining one is
    // older still — without this an archive is re-read on every range switch.
    if (!dayFolderInRange(day, cutoff)) break;

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
