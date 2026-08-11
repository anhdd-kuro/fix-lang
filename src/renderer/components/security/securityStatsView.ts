/**
 * @file securityStatsView.ts
 * @description PURE view derivation for the Security dashboard tab. Copy leaves
 * here as a `MessageKey` or `StatusDescriptor`, never a resolved string — see
 * `statusDescriptor.ts` for the locale-switch regression that prevents.
 *
 * A rule id read out of a log line is an arbitrary string, not a `SecretRuleId`:
 * an id retired from `secretRules.ts` stays in yesterday's log forever.
 */
import { topSecurityRules } from "~/features/guards/shared/securityStats";
import { SECRET_RULES } from "~/features/secretGuard/shared/secretRules";
import { plainStatus, type StatusDescriptor } from "../statusDescriptor";
import type { SecurityStats } from "~/features/guards/shared/securityStats";
import type { MessageKey } from "~/features/i18n/shared/message";
import type { SecretRuleId } from "~/features/secretGuard/shared/secretRules";

export const TOP_RULE_LIMIT = 6;

export type SecurityStatCardId =
  | "secretMasked"
  | "secretConfirmed"
  | "secretDeclined"
  | "restoreFailures"
  | "blockedByApp"
  | "declinedLargeSelection"
  | "declinedStaleClipboard"
  | "declinedUnknownClipboardAge"
  | "askContextDropped";

export type SecurityStatCard = {
  id: SecurityStatCardId;
  labelKey: MessageKey;
  value: number;
  /** Second line — a count that only makes sense beside the headline number. */
  detail: StatusDescriptor | null;
  hintKey: MessageKey;
};

export type SecurityRuleRow = {
  ruleId: string;
  count: number;
  /** `null` for an id no longer in `SECRET_RULES` — show the raw id instead. */
  labelKey: MessageKey | null;
};

export type SecurityStatsView = {
  secretCards: readonly SecurityStatCard[];
  selectionCards: readonly SecurityStatCard[];
  ruleRows: readonly SecurityRuleRow[];
  hasActivity: boolean;
  emptyHint: StatusDescriptor | null;
  rulesHint: StatusDescriptor | null;
  lastEventAt: string | null;
};

const KNOWN_RULE_IDS: ReadonlySet<string> = new Set(SECRET_RULES.map((rule) => rule.id));

/** The cast holds only because `KNOWN_RULE_IDS` was checked first. */
const ruleLabelKey = (ruleId: string): MessageKey | null =>
  KNOWN_RULE_IDS.has(ruleId)
    ? (`security.rules.${ruleId as SecretRuleId}` satisfies MessageKey)
    : null;

const card = (
  id: SecurityStatCardId,
  labelKey: MessageKey,
  hintKey: MessageKey,
  value: number,
  detail: StatusDescriptor | null = null,
): SecurityStatCard => ({ id, labelKey, hintKey, value, detail });

export const resolveSecurityStatsView = (stats: SecurityStats): SecurityStatsView => {
  const ruleRows = topSecurityRules(stats, TOP_RULE_LIMIT).map((rule) => ({
    ruleId: rule.ruleId,
    count: rule.count,
    labelKey: ruleLabelKey(rule.ruleId),
  }));

  return {
    secretCards: [
      card(
        "secretMasked",
        "security.stats.secretMasked.label",
        "security.stats.secretMasked.hint",
        stats.secretMasked,
        stats.secretMasked > 0
          ? plainStatus("security.stats.secretMasked.detail", {
              values: stats.maskedValues,
              placeholders: stats.maskedPlaceholders,
            })
          : null,
      ),
      card(
        "secretConfirmed",
        "security.stats.secretConfirmed.label",
        "security.stats.secretConfirmed.hint",
        stats.secretConfirmed,
      ),
      card(
        "secretDeclined",
        "security.stats.secretDeclined.label",
        "security.stats.secretDeclined.hint",
        stats.secretDeclined,
      ),
      card(
        "restoreFailures",
        "security.stats.restoreFailures.label",
        "security.stats.restoreFailures.hint",
        stats.restoreFailures,
      ),
    ],
    selectionCards: [
      card(
        "blockedByApp",
        "security.stats.blockedByApp.label",
        "security.stats.blockedByApp.hint",
        stats.blockedByApp,
      ),
      card(
        "declinedLargeSelection",
        "security.stats.declinedLargeSelection.label",
        "security.stats.declinedLargeSelection.hint",
        stats.declinedLargeSelection,
      ),
      card(
        "declinedStaleClipboard",
        "security.stats.declinedStaleClipboard.label",
        "security.stats.declinedStaleClipboard.hint",
        stats.declinedStaleClipboard,
      ),
      card(
        "declinedUnknownClipboardAge",
        "security.stats.declinedUnknownClipboardAge.label",
        "security.stats.declinedUnknownClipboardAge.hint",
        stats.declinedUnknownClipboardAge,
      ),
      card(
        "askContextDropped",
        "security.stats.askContextDropped.label",
        "security.stats.askContextDropped.hint",
        stats.askContextDropped,
      ),
    ],
    ruleRows,
    hasActivity: stats.eventCount > 0,
    emptyHint: stats.eventCount === 0 ? plainStatus("security.stats.empty") : null,
    rulesHint: ruleRows.length === 0 ? null : plainStatus("security.stats.rules.hint"),
    lastEventAt: stats.lastEventAt,
  };
};
