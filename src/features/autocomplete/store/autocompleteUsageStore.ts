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
 * Aggregated money has to carry its own coverage or it lies. `recordUsage`
 * folds a response's tokens and cost into the day AND counts the ones that
 * arrived unmeasured or unpriceable, because a sum alone cannot tell "$0" from
 * "we do not know" — see `AutocompleteDayRollup`'s doc for how the pairs read.
 *
 * Modelled on `~/features/correction/store/outputModeStore`.
 *
 * `AutocompleteDayRollup` is defined in `~/features/autocomplete/shared/autocompleteWire`,
 * not here — that file is imported by the renderer, and this one is not (it
 * constructs an `electron-store`), so the shape had to move out rather than
 * the renderer importing through this module.
 *
 * Deliberately NOT re-exported from here. A second import path for the type
 * would make this module — the one the wire file's header says the renderer
 * must not reach — a discoverable route to it, and `getDays()` invites exactly
 * that from the dashboard. It stays harmless only while every such import
 * keeps the `type` keyword; drop it, or pull a value alongside it, and
 * `electron-store` lands in the renderer bundle. That failure is invisible to
 * `dev`, `test` and `lint`, and surfaces only in a packaged build.
 */
import Store from "electron-store";
import type { AutocompleteDayRollup } from "~/features/autocomplete/shared/autocompleteWire";

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
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const finiteOr = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

/**
 * Fills in a rollup read back from disk.
 *
 * A day persisted before the coverage counters existed has no `responses`
 * field, and `undefined + 1` is `NaN` — one such day poisons every total it is
 * summed into, silently and with no error. The persisted file is also plain
 * JSON a user can hand-edit, so the reader, not the writer, owns the shape.
 *
 * Back-filling those counters with `0` is not neutral: `unpricedResponses: 0`
 * beside `responses: 0` is the read rules' "every price is known", so a legacy
 * day of billed requests claimed FULL coverage, and a month mixing 200 such
 * requests with one new priced response rendered that one response's `$0.004`
 * as the whole bill. `0` is a CLAIM; the truth about a legacy day is that its
 * coverage was never recorded, so it is migrated as entirely UNKNOWN — every
 * counter unknown AND every sum dropped. Both halves, together: see
 * `coverageWasNeverRecorded`.
 */
const normalizeRollup = (date: string, raw: unknown): AutocompleteDayRollup => {
  if (typeof raw !== "object" || raw === null) return emptyRollup(date);
  const record = raw as Record<string, unknown>;
  const requests = finiteOr(record.requests, 0);
  /**
   * A pre-counter day is recognisable without a version marker: it has
   * `requests` but no `responses`, while a genuinely new empty day has neither.
   *
   * `requests` stands in for the missing `responses` count. It is an UPPER
   * bound, not a measurement — some of those requests were superseded and never
   * came back — and that is the conservative direction precisely because every
   * one of them is then booked as unknown: an over-counted denominator can only
   * shrink the coverage a sum claims, never inflate it. Back-filling `0`
   * responses instead would make the day read as a genuine `$0`, which is the
   * false zero this whole triple exists to prevent.
   *
   * The persisted sums go to `0` WITH those counters, and that pairing is the
   * whole point. `estimatedCostUsd` sums PRICED responses only and the tokens
   * sum the responses that REPORTED them, so a day that books every response as
   * unpriced and tokenless cannot also carry money and tokens: the two halves of
   * one day would then contradict each other. Keeping them was not harmless.
   * `unpricedResponses === responses` renders a single day as N/A, which hides
   * the amount — but summing DESTROYS that equality, so one new priced response
   * turned a month into `200 < 201`, the read rules' "amount plus coverage", and
   * `Est. $0.504 (1 of 201 priced)` put $0.50 of legacy money on screen behind a
   * badge claiming one response backed it. A floor nobody can attribute to a
   * priced response is exactly the false precision these counters exist to kill,
   * so it is dropped rather than displayed under a coverage line that disowns it.
   *
   * Idempotent by construction: the migrated day carries `responses`, so the
   * next read takes the non-legacy path and finds every field already
   * consistent — the same values, a fixed point, whether or not a write has
   * persisted them yet.
   */
  const coverageWasNeverRecorded = !isFiniteNumber(record.responses) && requests > 0;
  const sumOrDropped = (value: unknown): number =>
    coverageWasNeverRecorded ? 0 : finiteOr(value, 0);
  return {
    date: typeof record.date === "string" ? record.date : date,
    requests,
    responses: coverageWasNeverRecorded ? requests : finiteOr(record.responses, 0),
    tokenlessResponses: finiteOr(
      record.tokenlessResponses,
      coverageWasNeverRecorded ? requests : 0,
    ),
    unpricedResponses: finiteOr(
      record.unpricedResponses,
      coverageWasNeverRecorded ? requests : 0,
    ),
    promptTokens: sumOrDropped(record.promptTokens),
    completionTokens: sumOrDropped(record.completionTokens),
    estimatedCostUsd: sumOrDropped(record.estimatedCostUsd),
  };
};

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
    const raw: unknown = this.store.get("days", {});
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([date, rollup]) => [
        date,
        normalizeRollup(date, rollup),
      ]),
    );
  }

  private updateDay(
    now: Date,
    change: (current: AutocompleteDayRollup) => AutocompleteDayRollup,
  ): AutocompleteDayRollup {
    const key = localDayKey(now);
    const days = this.readDays();
    const updated = change(days[key] ?? emptyRollup(key));

    const retained = Object.entries({ ...days, [key]: updated })
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, RETAINED_DAYS);
    this.store.set("days", Object.fromEntries(retained));

    return updated;
  }

  /**
   * Counts one request DISPATCHED to a provider. Called before the call is
   * made, never after it returns.
   *
   * `requests` therefore means ATTEMPTS, not completions — read it that way in
   * the dashboard. The runaway the daily cap guards against is a loop in which
   * every request is superseded and aborted a keystroke later, and the
   * provider bills each of those all the same. Counting only what came back
   * left the counter at zero in exactly that case, so the one hard stop
   * against an overnight bill never fired.
   */
  recordDispatch(now = new Date()): AutocompleteDayRollup {
    return this.updateDay(now, (current) => ({
      ...current,
      requests: current.requests + 1,
    }));
  }

  /**
   * Adds what one response actually used, without counting a further request.
   *
   * Separate from `recordDispatch` so a request that aborted or failed cannot
   * pad the token and spend figures with zeroes that read like real
   * measurements.
   *
   * A null in the delta means "the provider did not tell us", and it is counted
   * as such rather than folded into the totals as a zero. The `?? 0` below is
   * therefore not a coalesce-and-forget: the amount is the sum over the
   * responses that DID report, and `tokenlessResponses` / `unpricedResponses`
   * say how much of the day that covers. Without them a day of billed
   * direct-OpenAI requests — which `computeCost` refuses to price — reported
   * `$0.00`, a false zero indistinguishable from a day that cost nothing.
   */
  recordUsage(delta: AutocompleteUsageDelta, now = new Date()): AutocompleteDayRollup {
    const tokensMissing = delta.promptTokens === null || delta.completionTokens === null;
    return this.updateDay(now, (current) => ({
      ...current,
      responses: current.responses + 1,
      tokenlessResponses: current.tokenlessResponses + (tokensMissing ? 1 : 0),
      unpricedResponses: current.unpricedResponses + (delta.estimatedCostUsd === null ? 1 : 0),
      promptTokens: current.promptTokens + (delta.promptTokens ?? 0),
      completionTokens: current.completionTokens + (delta.completionTokens ?? 0),
      estimatedCostUsd: current.estimatedCostUsd + (delta.estimatedCostUsd ?? 0),
    }));
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
          responses: total.responses + rollup.responses,
          // Every coverage counter sums, which is what keeps a month that mixes
          // priced and unpriced days readable as exactly that, instead of
          // collapsing into whichever half happened to be knowable.
          tokenlessResponses: total.tokenlessResponses + rollup.tokenlessResponses,
          unpricedResponses: total.unpricedResponses + rollup.unpricedResponses,
          promptTokens: total.promptTokens + rollup.promptTokens,
          completionTokens: total.completionTokens + rollup.completionTokens,
          estimatedCostUsd: total.estimatedCostUsd + rollup.estimatedCostUsd,
        }),
        emptyRollup(key),
      );
  }

  /**
   * Every retained day, newest first. `readDays()` already returns at most
   * `RETAINED_DAYS` entries — the write path trims — so no re-slicing is
   * needed here, only the sort the IPC/renderer side expects.
   *
   * The sort is NOT redundant with the write path's. Object key order in the
   * persisted file is whatever the last writer left, and a hand-edited or
   * migrated file has no order at all; the reader owns the guarantee.
   */
  getDays(): AutocompleteDayRollup[] {
    return Object.values(this.readDays()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}

export const autocompleteUsageStore = new AutocompleteUsageStore();
