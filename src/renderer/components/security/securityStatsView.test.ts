/**
 * @file securityStatsView.test.ts
 * @description Pure view derivation for the Security dashboard tab. The two
 * rules worth pinning: nothing leaves here as resolved prose (a locale switch
 * would strand it), and a rule id that is no longer in `SECRET_RULES` gets a
 * `null` label rather than a translation key `t()` cannot resolve.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SECURITY_STATS } from "~/features/guards/shared/securityStats";
import { SECRET_RULES } from "~/features/secretGuard/shared/secretRules";
import { resolveSecurityStatsView, TOP_RULE_LIMIT } from "./securityStatsView";
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

  it("adds the values/placeholders detail only when something was masked", () => {
    const masked = resolveSecurityStatsView(
      stats({ secretMasked: 2, maskedValues: 5, maskedPlaceholders: 4, eventCount: 2 }),
    );
    const maskedCard = masked.secretCards.find((card) => card.id === "secretMasked");

    expect(maskedCard?.detail).toEqual({
      kind: "plain",
      message: {
        key: "security.stats.secretMasked.detail",
        params: { values: 5, placeholders: 4 },
      },
    });

    const clean = resolveSecurityStatsView(stats({ secretConfirmed: 1, eventCount: 1 }));
    expect(clean.secretCards.find((card) => card.id === "secretMasked")?.detail).toBeNull();
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

  /**
   * Every string that reaches the user must be a key or a descriptor. A
   * resolved sentence here would freeze into whatever locale was active when
   * the fetch landed — see `statusDescriptor.ts`.
   */
  it("emits keys and descriptors, never prose", () => {
    const view = resolveSecurityStatsView(
      stats({ secretMasked: 1, maskedValues: 1, maskedPlaceholders: 1, eventCount: 1 }),
    );

    for (const card of [...view.secretCards, ...view.selectionCards]) {
      expect(card.labelKey.startsWith("security.stats.")).toBe(true);
      expect(card.hintKey.startsWith("security.stats.")).toBe(true);
      if (card.detail !== null) {
        expect(card.detail.kind).toBe("plain");
      }
    }
  });

  it("passes the newest event timestamp through untouched", () => {
    const view = resolveSecurityStatsView(
      stats({ blockedByApp: 1, eventCount: 1, lastEventAt: "2026-08-10T09:00:00.000Z" }),
    );

    expect(view.lastEventAt).toBe("2026-08-10T09:00:00.000Z");
  });
});
