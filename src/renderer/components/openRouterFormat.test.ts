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

  // The real subject here is which `models.openrouter.degraded.*` key gets
  // picked for a given reason code — text is derived through the real
  // translator (not hand-restated) so a catalog reword doesn't spuriously
  // break this file, and the EN/JA pair proves the locale genuinely changes
  // the wording (guards against an English-fallback regression).
  it("translates the unauthorized reason (EN)", () => {
    expect(openRouterDegradedMessage("unauthorized", en)).toBe(
      en("models.openrouter.degraded.unauthorized"),
    );
  });

  it("translates the unauthorized reason (JA)", () => {
    expect(openRouterDegradedMessage("unauthorized", ja)).toBe(
      ja("models.openrouter.degraded.unauthorized"),
    );
    expect(openRouterDegradedMessage("unauthorized", ja)).not.toBe(
      openRouterDegradedMessage("unauthorized", en),
    );
  });

  it("translates the no_key reason (EN)", () => {
    expect(openRouterDegradedMessage("no_key", en)).toBe(
      en("models.openrouter.degraded.noKey"),
    );
  });

  it("translates the no_key reason (JA)", () => {
    expect(openRouterDegradedMessage("no_key", ja)).toBe(
      ja("models.openrouter.degraded.noKey"),
    );
    expect(openRouterDegradedMessage("no_key", ja)).not.toBe(
      openRouterDegradedMessage("no_key", en),
    );
  });

  it("falls back to the generic unavailable message for other reasons (EN)", () => {
    const expected = en("models.openrouter.degraded.unavailable");
    expect(openRouterDegradedMessage("parse_error", en)).toBe(expected);
    expect(openRouterDegradedMessage("unavailable", en)).toBe(expected);
  });

  it("falls back to the generic unavailable message for other reasons (JA)", () => {
    const expected = ja("models.openrouter.degraded.unavailable");
    expect(openRouterDegradedMessage("parse_error", ja)).toBe(expected);
    expect(openRouterDegradedMessage("unavailable", ja)).toBe(expected);
    expect(expected).not.toBe(en("models.openrouter.degraded.unavailable"));
  });
});
