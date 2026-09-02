/**
 * @file entropyRule.test.ts
 * @description The opt-in `high-entropy-string` rule exists for its NEGATIVES.
 *
 * It is the only rule with a real false-positive rate, which is why it ships
 * off. Everything below is a shape that looks random to an entropy meter and is
 * not a credential — a git SHA, a digest, a UUID, an inline image, a lockfile
 * integrity hash, minified JS. Each false positive here would train a user to
 * click *Send anyway* on the dialog that matters.
 */
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./detectSecrets";

const ENTROPY_ON = { highEntropyRule: true } as const;

const GIT_SHA = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
const SHA256_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const UUID = "550e8400-e29b-41d4-a716-446655440000";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SRI_HASH =
  "sha512-Xk3mFDLcMKvNIcBhSnAxCbtLxKuLHRHVWEz4PLcOaGXpEQ4Q0LrHmvIrRcHtGPQr";
const MINIFIED_JS =
  '!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t((e=e||self).myLib={})}(this,function(e){"use strict";function t(e,n){return e+n}e.add=t,Object.defineProperty(e,"__esModule",{value:!0})});';
const RANDOM_44 = "Kj8mQz2XvB7nLp0RtYw5Ec3AsDfGhJkLzXcVbNmQwErT";

describe("the high-entropy rule", () => {
  describe("yields zero matches on", () => {
    it.each([
      ["a 40-hex git SHA", GIT_SHA],
      ["a 64-hex sha256 digest", SHA256_DIGEST],
      ["a UUID", UUID],
      ["an inline data:image payload", `<img src="data:image/png;base64,${PNG_BASE64}">`],
      ["a lockfile integrity line", `  "integrity": "${SRI_HASH}",`],
      ["minified JavaScript", MINIFIED_JS],
      ["a 300-character run", RANDOM_44.repeat(7)],
    ])("%s", (_description, text) => {
      expect(scanForSecrets(text, ENTROPY_ON)).toEqual({ matches: [], ruleIds: [] });
    });
  });

  // Without these the negatives above would pass on a rule that never fires.
  describe("still fires on", () => {
    it("a mixed-case random run", () => {
      const result = scanForSecrets(`value ${RANDOM_44} end`, ENTROPY_ON);
      expect(result.ruleIds).toEqual(["high-entropy-string"]);
    });

    it("the very payload the data: prefix excluded, once the prefix is gone", () => {
      const result = scanForSecrets(`leftover ${PNG_BASE64} blob`, ENTROPY_ON);
      expect(result.ruleIds).toEqual(["high-entropy-string"]);
    });

    it("a run exactly at the 256-character ceiling", () => {
      const atCeiling = RANDOM_44.repeat(6).slice(0, 256);
      const result = scanForSecrets(`value ${atCeiling} end`, ENTROPY_ON);
      expect(result.ruleIds).toEqual(["high-entropy-string"]);
    });
  });

  it("stays silent unless it is switched on", () => {
    expect(scanForSecrets(`value ${RANDOM_44} end`)).toEqual({ matches: [], ruleIds: [] });
  });

  it("does not carve an over-long run into accepted pieces", () => {
    const overLong = RANDOM_44.repeat(7);
    expect(overLong.length).toBeGreaterThan(256);
    expect(scanForSecrets(overLong, ENTROPY_ON).matches).toEqual([]);
  });
});
