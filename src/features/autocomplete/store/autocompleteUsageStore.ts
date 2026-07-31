/**
 * @file autocompleteUsageStore.ts
 * @description Per-day request and token rollups for autocomplete.
 *
 * A counter, not a bucket. Autocomplete deliberately writes no `history` rows:
 * `HistoryFeatureId` widening is the one change here that is not cleanly
 * revertible (rows land in SQLite and stay), the History tab and every chart key
 * off `presetName` so thousands of 20-token rows would drown the transforms a
 * user actually reads, and it would put text the user typed but never sent into
 * a queryable, exportable database.
 *
 * Untracked spend would be worse than noisy history though, so the money is
 * still counted — just aggregated, and with no prompt text anywhere near it.
 *
 * Modelled on `~/features/correction/store/outputModeStore`.
 */
import Store from "electron-store";

export type AutocompleteDayRollup = {
  /** `YYYY-MM-DD` in local time, matching how the user reads "today". */
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
};

type AutocompleteUsageSchema = {
  days: Record<string, AutocompleteDayRollup>;
};

/**
 * Days retained. Long enough for a month-to-date figure, short enough that the
 * file cannot grow without bound.
 */
const RETAINED_DAYS = 62;

const emptyRollup = (date: string): AutocompleteDayRollup => ({
  date,
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

/** Local-time `YYYY-MM-DD`; `toISOString` would roll over at the wrong moment. */
export const localDayKey = (when: Date): string => {
  const year = when.getFullYear();
  const month = `${when.getMonth() + 1}`.padStart(2, "0");
  const day = `${when.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export type AutocompleteUsageDelta = {
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
};

class AutocompleteUsageStore {
  private backing: Store<AutocompleteUsageSchema> | null = null;

  /**
   * Constructed on first use, not at import time. `electron-store` resolves
   * `app.getPath` in its constructor, so building it eagerly would make merely
   * *importing* anything downstream of this module require a running Electron —
   * which is how `profileChange` ended up dragging Electron into unit tests that
   * never touch usage at all.
   */
  private get store(): Store<AutocompleteUsageSchema> {
    this.backing ??= new Store<AutocompleteUsageSchema>({
      name: "autocompleteUsage",
      defaults: { days: {} },
      clearInvalidConfig: true,
    });
    return this.backing;
  }

  private readDays(): Record<string, AutocompleteDayRollup> {
    const raw = this.store.get("days", {});
    return raw && typeof raw === "object" ? raw : {};
  }

  /**
   * Adds one request's usage to today's rollup.
   *
   * Null token counts still increment `requests`: local providers report no
   * tokens, and a day showing zero requests would misreport what actually ran.
   */
  record(delta: AutocompleteUsageDelta, now = new Date()): AutocompleteDayRollup {
    const key = localDayKey(now);
    const days = this.readDays();
    const current = days[key] ?? emptyRollup(key);
    const updated: AutocompleteDayRollup = {
      date: key,
      requests: current.requests + 1,
      promptTokens: current.promptTokens + (delta.promptTokens ?? 0),
      completionTokens: current.completionTokens + (delta.completionTokens ?? 0),
      estimatedCostUsd: current.estimatedCostUsd + (delta.estimatedCostUsd ?? 0),
    };

    const retained = Object.entries({ ...days, [key]: updated })
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, RETAINED_DAYS);
    this.store.set("days", Object.fromEntries(retained));

    return updated;
  }

  getDay(now = new Date()): AutocompleteDayRollup {
    const key = localDayKey(now);
    return this.readDays()[key] ?? emptyRollup(key);
  }

  /** Rollup across the calendar month containing `now`. */
  getMonth(now = new Date()): AutocompleteDayRollup {
    const prefix = localDayKey(now).slice(0, 7);
    const key = localDayKey(now);
    return Object.values(this.readDays())
      .filter((rollup) => rollup.date.startsWith(prefix))
      .reduce<AutocompleteDayRollup>(
        (total, rollup) => ({
          date: key,
          requests: total.requests + rollup.requests,
          promptTokens: total.promptTokens + rollup.promptTokens,
          completionTokens: total.completionTokens + rollup.completionTokens,
          estimatedCostUsd: total.estimatedCostUsd + rollup.estimatedCostUsd,
        }),
        emptyRollup(key),
      );
  }
}

export const autocompleteUsageStore = new AutocompleteUsageStore();
