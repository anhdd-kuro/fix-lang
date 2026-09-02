/**
 * @file logKeys.test.ts
 * @description The log-key trap, pinned.
 *
 * `redactLogContext` blanks any context key whose NAME merely CONTAINS
 * `api_key|authorization|bearer|token|secret|password|clipboard|selected_text|
 * original_text` — case-insensitively, and with ZERO separator for
 * `selected[-_]?text`. It does it silently, with no error, so the obvious names
 * (`secretCount`, `tokensMasked`, `clipboardAgeMs`) persist as `"[REDACTED]"`
 * and the metric is destroyed without anybody noticing. This test documents why
 * the approved names are what they are, and it runs the REAL redactor rather
 * than a copy of the regex.
 */
import { describe, expect, it } from "vitest";
import { redactLogContext, redactLogMessage, type LogContext } from "~/features/logs/shared/logging";
import { SECRET_GUARD_MODES } from "./secretGuardSettings";
import { SECRET_RULES } from "./secretRules";

const REDACTED = "[REDACTED]";

/** Every key the guard rails are allowed to ship, with a representative value. */
const APPROVED: LogContext = {
  presetId: "correction",
  guardEvent: "blocked",
  guardReason: "denied-app",
  deniedBundleId: "com.1password.1password",
  selectionAgeMs: 41_000,
  ageLimitMs: 5_000,
  textLength: 24_812,
  charLimit: 20_000,
  matchCount: 3,
  ruleIds: ["authorization-header", "private-key-block", "credential-assignment"],
  guardMode: "mask",
  appliedMode: "popup",
  gateDecision: "confirmed",
  reason: "stale-clipboard",
  placeholderCount: 2,
  missingCount: 1,
  confirmMs: 1_450,
  pausedMs: 1_450,
  delivery: "paste",
  selectionChanged: false,
  source: "clipboard",
};

/**
 * The names that read naturally and are destroyed by the redactor. Each maps to
 * the approved name that replaces it.
 */
const REJECTED: readonly (readonly [string, string])[] = [
  ["clipboardAgeMs", "selectionAgeMs"],
  ["clipboardStale", "guardReason"],
  ["clipboardMaxAgeMs", "ageLimitMs"],
  ["clipboardChanged", "selectionChanged"],
  ["selectedTextLength", "textLength"],
  ["selectedtextLength", "textLength"],
  ["originalTextLength", "textLength"],
  ["secretsFound", "matchCount"],
  ["secretCount", "matchCount"],
  ["maskedSecrets", "placeholderCount"],
  ["tokenRuleId", "ruleIds"],
  ["tokensMasked", "placeholderCount"],
];

describe("approved log keys", () => {
  it("all survive the real redactor unchanged", () => {
    expect(redactLogContext(APPROVED)).toEqual(APPROVED);
  });

  it.each(Object.keys(APPROVED))("%s is not blanked", (key) => {
    expect(redactLogContext(APPROVED)[key]).not.toBe(REDACTED);
  });

  it("carries every rule id as an array VALUE", () => {
    const ruleIds = SECRET_RULES.map((rule) => rule.id);
    expect(redactLogContext({ ruleIds })).toEqual({ ruleIds });
  });

  it("carries every guard mode as a value", () => {
    for (const guardMode of SECRET_GUARD_MODES) {
      expect(redactLogContext({ guardMode })).toEqual({ guardMode });
    }
  });

  /**
   * Values only ever pass through `redactLogMessage`, which does no key
   * matching — so an outcome VALUE may say `clipboard` where a key may not.
   * Pinned because the next reader will correctly flinch at it.
   */
  it("keeps `stale-clipboard` as a value even though it would be fatal as a key", () => {
    expect(redactLogContext({ reason: "stale-clipboard" })).toEqual({ reason: "stale-clipboard" });
    expect(redactLogContext({ "stale-clipboard": 1 })).toEqual({ "stale-clipboard": REDACTED });
  });
});

describe("rejected log keys", () => {
  it.each(REJECTED)("%s is blanked — ship %s instead", (rejected, approved) => {
    expect(redactLogContext({ [rejected]: 7 })[rejected]).toBe(REDACTED);
    expect(redactLogContext({ [approved]: 7 })[approved]).not.toBe(REDACTED);
  });

  /**
   * `{[ruleId]: count}` produces a key `authorization-header`, and that key
   * contains `authorization`. Rule ids are a VALUE, never a key.
   *
   * Exactly half the ids are destroyed and half survive — `private-key-block`
   * and `aws-access-key-id` come through untouched because the regex wants
   * `api_key`, not a bare `key`. That is what makes the mistake worth pinning:
   * a spread would look like it worked in half the cases.
   */
  it("blanks half the rule ids and silently keeps the rest when spread into key positions", () => {
    const redacted = redactLogContext(Object.fromEntries(SECRET_RULES.map((r) => [r.id, 1])));
    const blanked = Object.keys(redacted).filter((key) => redacted[key] === REDACTED);
    expect(blanked.sort()).toEqual(
      [
        "authorization-header",
        "digitalocean-token",
        "github-token",
        "gitlab-token",
        "google-api-key",
        "npm-token",
        "shopify-token",
        "slack-token",
        "stripe-secret-key",
      ].sort(),
    );
    expect(redacted["private-key-block"]).toBe(1);
    expect(redacted["aws-access-key-id"]).toBe(1);
  });
});

describe("scopes and messages", () => {
  // `logService.log` runs the SCOPE through `redactLogMessage` too.
  it.each(["secretGuard.mask", "secretGuard.gate", "correction.hotkey"])(
    "%s survives as a scope",
    (scope) => {
      expect(redactLogMessage(scope)).toBe(scope);
    },
  );

  it("shows why a colon after `secret` would not survive", () => {
    expect(redactLogMessage("secret:gate")).toContain(REDACTED);
  });
});
