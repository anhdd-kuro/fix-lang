/**
 * @file securityStatsView.test.ts
 * @description Two rules worth pinning: nothing leaves the view as resolved
 * prose, and a rule id no longer in `SECRET_RULES` gets a `null` label rather
 * than a translation key `t()` cannot resolve.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SECURITY_STATS } from "~/features/guards/shared/securityStats";
import { SECRET_RULES } from "~/features/secretGuard/shared/secretRules";
import {
  resolveSecurityStatsView,
  securityChartBarTooltip,
  securityChartDonutTooltip,
  TOP_RULE_LIMIT,
} from "./securityStatsView";
import type { SecurityStats } from "~/features/guards/shared/securityStats";

const stats = (overrides: Partial<SecurityStats> = {}): SecurityStats => ({
  ...EMPTY_SECURITY_STATS,
  ...overrides,
});

describe("resolveSecurityStatsView", () => {
  it("reports no activity and an empty hint for a blank roll-up", () => {
    const view = resolveSecurityStatsView(EMPTY_SECURITY_STATS);

    expect(view.hasActivity).toBe(false);
    expect(view.emptyHint).not.toBeNull();
    expect(view.lastEventAt).toBeNull();
    expect(view.ruleRows).toEqual([]);
    expect(view.rulesHint).toBeNull();
  });

  it("still renders every card so a zero reads as a zero, not as a missing metric", () => {
    const view = resolveSecurityStatsView(EMPTY_SECURITY_STATS);

    expect(view.secretCards.map((card) => card.id)).toEqual([
      "secretMasked",
      "secretConfirmed",
      "secretDeclined",
      "restoreFailures",
    ]);
    expect(view.selectionCards.map((card) => card.id)).toEqual([
      "blockedByApp",
      "declinedLargeSelection",
      "declinedStaleClipboard",
      "declinedUnknownClipboardAge",
      "askContextDropped",
    ]);
    expect([...view.secretCards, ...view.selectionCards].every((card) => card.value === 0)).toBe(
      true,
    );
  });

  it("carries each count onto its own card", () => {
    const view = resolveSecurityStatsView(
      stats({
        secretMasked: 4,
        secretConfirmed: 2,
        secretDeclined: 1,
        restoreFailures: 3,
        blockedByApp: 5,
        declinedLargeSelection: 6,
        declinedStaleClipboard: 7,
        declinedUnknownClipboardAge: 8,
        askContextDropped: 9,
        eventCount: 45,
      }),
    );

    const byId = Object.fromEntries(
      [...view.secretCards, ...view.selectionCards].map((card) => [card.id, card.value]),
    );

    expect(byId).toEqual({
      secretMasked: 4,
      secretConfirmed: 2,
      secretDeclined: 1,
      restoreFailures: 3,
      blockedByApp: 5,
      declinedLargeSelection: 6,
      declinedStaleClipboard: 7,
      declinedUnknownClipboardAge: 8,
      askContextDropped: 9,
    });
    expect(view.hasActivity).toBe(true);
    expect(view.emptyHint).toBeNull();
  });

  /**
   * One descriptor per count, each carrying `count`: the two counts move
   * independently, so a single sentence would render "1 values, 2 placeholders".
   */
  it("adds one plural-aware detail per masked count, and only when something was masked", () => {
    const masked = resolveSecurityStatsView(
      stats({ secretMasked: 2, maskedValues: 1, maskedPlaceholders: 4, eventCount: 2 }),
    );
    const maskedCard = masked.secretCards.find((card) => card.id === "secretMasked");

    expect(maskedCard?.details).toEqual([
      {
        kind: "plain",
        message: { key: "security.stats.secretMasked.values", params: { count: 1 } },
      },
      {
        kind: "plain",
        message: { key: "security.stats.secretMasked.placeholders", params: { count: 4 } },
      },
    ]);

    const clean = resolveSecurityStatsView(stats({ secretConfirmed: 1, eventCount: 1 }));
    expect(clean.secretCards.find((card) => card.id === "secretMasked")?.details).toEqual([]);
  });

  /**
   * Pre-`guardEvent` log lines are real events that cannot be classified. The
   * panel must say so instead of letting them read as no activity at all.
   */
  it("names legacy events and never pairs them with the empty hint", () => {
    const view = resolveSecurityStatsView(stats({ legacyEvents: 3, eventCount: 3 }));

    expect(view.legacyNotice).toEqual({
      kind: "plain",
      message: { key: "security.stats.legacy", params: { count: 3 } },
    });
    expect(view.hasActivity).toBe(true);
    expect(view.emptyHint).toBeNull();
    expect(resolveSecurityStatsView(EMPTY_SECURITY_STATS).legacyNotice).toBeNull();
  });

  it("names a known rule by key and leaves a retired id unlabelled", () => {
    const knownRuleId = SECRET_RULES[0]?.id ?? "openai-key";
    const view = resolveSecurityStatsView(
      stats({
        secretMasked: 2,
        eventCount: 2,
        ruleCounts: { [knownRuleId]: 2, "rule-retired-last-year": 1 },
      }),
    );

    expect(view.ruleRows).toEqual([
      { ruleId: knownRuleId, count: 2, labelKey: `security.rules.${knownRuleId}` },
      { ruleId: "rule-retired-last-year", count: 1, labelKey: null },
    ]);
    expect(view.rulesHint).not.toBeNull();
  });

  it("caps the rule list", () => {
    const ruleCounts = Object.fromEntries(
      SECRET_RULES.map((rule, index) => [rule.id, SECRET_RULES.length - index]),
    );
    const view = resolveSecurityStatsView(stats({ eventCount: 1, ruleCounts }));

    expect(view.ruleRows).toHaveLength(TOP_RULE_LIMIT);
    expect(SECRET_RULES.length).toBeGreaterThan(TOP_RULE_LIMIT);
  });

  /** A resolved sentence would freeze into the locale active at fetch time. */
  it("emits keys and descriptors, never prose", () => {
    const view = resolveSecurityStatsView(
      stats({ secretMasked: 1, maskedValues: 1, maskedPlaceholders: 1, eventCount: 1 }),
    );

    for (const card of [...view.secretCards, ...view.selectionCards]) {
      expect(card.labelKey.startsWith("security.stats.")).toBe(true);
      expect(card.hintKey.startsWith("security.stats.")).toBe(true);
      for (const detail of card.details) {
        expect(detail.kind).toBe("plain");
      }
    }
  });

  it("passes the newest event timestamp through untouched", () => {
    const view = resolveSecurityStatsView(
      stats({ blockedByApp: 1, eventCount: 1, lastEventAt: "2026-08-10T09:00:00.000Z" }),
    );

    expect(view.lastEventAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it("emits chart tooltip descriptors, never prose", () => {
    expect(securityChartDonutTooltip(1, "25")).toEqual({
      key: "security.stats.charts.tooltip",
      params: { pct: "25", count: 1 },
    });
    expect(securityChartBarTooltip(4)).toEqual({
      key: "security.stats.charts.barTooltip",
      params: { count: 4 },
    });
  });
});
