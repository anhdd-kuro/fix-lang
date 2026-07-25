/**
 * @file openRouterFormat.test.ts
 * @description Behavioral coverage for the OpenRouter formatting helpers,
 * including the localized degraded-card message, asserted in both locales.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { formatOpenRouterUsd, openRouterDegradedMessage } from "./openRouterFormat";

describe("formatOpenRouterUsd", () => {
  it("renders zero as $0.00", () => {
    expect(formatOpenRouterUsd(0)).toBe("$0.00");
  });

  it("renders sub-cent amounts with trimmed trailing zeros", () => {
    expect(formatOpenRouterUsd(0.0034)).toBe("$0.0034");
  });

  it("renders ordinary amounts with two decimal places", () => {
    expect(formatOpenRouterUsd(12.3)).toBe("$12.30");
  });
});

describe("openRouterDegradedMessage", () => {
  const en = createTranslator("en");
  const ja = createTranslator("ja");

  it("translates the unauthorized reason (EN)", () => {
    expect(openRouterDegradedMessage("unauthorized", en)).toBe(
      "Unauthorized — check your provisioning key.",
    );
  });

  it("translates the unauthorized reason (JA)", () => {
    expect(openRouterDegradedMessage("unauthorized", ja)).toBe(
      "認証エラー — プロビジョニングキーを確認してください。",
    );
  });

  it("translates the no_key reason (EN)", () => {
    expect(openRouterDegradedMessage("no_key", en)).toBe("No provisioning key set.");
  });

  it("translates the no_key reason (JA)", () => {
    expect(openRouterDegradedMessage("no_key", ja)).toBe(
      "プロビジョニングキーが設定されていません。",
    );
  });

  it("falls back to the generic unavailable message for other reasons (EN)", () => {
    expect(openRouterDegradedMessage("parse_error", en)).toBe("Unavailable right now.");
    expect(openRouterDegradedMessage("unavailable", en)).toBe("Unavailable right now.");
  });

  it("falls back to the generic unavailable message for other reasons (JA)", () => {
    expect(openRouterDegradedMessage("parse_error", ja)).toBe("現在利用できません。");
    expect(openRouterDegradedMessage("unavailable", ja)).toBe("現在利用できません。");
  });
});
