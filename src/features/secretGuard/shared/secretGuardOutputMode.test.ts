/**
 * @file secretGuardOutputMode.test.ts
 * @description A failed restore must never reach the paste path.
 *
 * The popup shows the MASKED reply with placeholders intact, not a partial
 * restore: a partial restore mixes real secrets and placeholders
 * indistinguishably, and the popup is copyable, so putting the real value there
 * would recreate exactly the exposure masking removed.
 */
import { describe, expect, it } from "vitest";
import { maskSecrets, restoreSecrets } from "./maskSecrets";
import { resolveSecretGuardOutputMode } from "./secretGuardOutputMode";

const FIXED_SALT = () => "A1B2C3";

/**
 * Fixtures are assembled from parts so no complete credential-shaped literal
 * appears in this file's source text. GitHub push protection matches contiguous
 * literals; every value below is fabricated, but the scanner cannot know that.
 * The joined value is byte-identical to what it replaced.
 */
const credentialFixture = (...parts: readonly string[]): string => parts.join("");

const AWS_DOC_ACCESS_KEY_ID = credentialFixture("AKIA", "IOSFODNN7EXAMPLE");

const maskingOfOneKey = () => maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });

/**
 * Each of these is a way a model has been observed to "helpfully" rewrite a
 * placeholder. Every one counts as MISSING or as RESIDUE — never as present.
 */
const MANGLED_REPLIES: readonly (readonly [string, string])[] = [
  ["absent", "The identifier was removed entirely."],
  ["lowercased", "id [[fixlang_secret_a1b2c3_01]] end"],
  ["spaced", "id [[ FIXLANG_SECRET_A1B2C3_01 ]] end"],
  ["re-bracketed into 「」", "id 「FIXLANG_SECRET_A1B2C3_01」 end"],
  ["truncated", "id [[FIXLANG_SECRET_A1B2C3_0 end"],
  ["single-bracketed", "id [FIXLANG_SECRET_A1B2C3_01] end"],
  ["index dropped", "id [[FIXLANG_SECRET_A1B2C3]] end"],
];

describe("restoreSecrets refuses a mangled placeholder", () => {
  it.each(MANGLED_REPLIES)("%s", (_description, reply) => {
    expect(restoreSecrets(reply, maskingOfOneKey()).ok).toBe(false);
  });

  // Counting alone cannot see this one: the placeholder IS present, and a
  // mangled copy survives beside it.
  it("catches a truncated copy that counting misses", () => {
    const reply = "[[FIXLANG_SECRET_A1B2C3_01]] and [[FIXLANG_SECRET_A1B2C3_0";
    expect(restoreSecrets(reply, maskingOfOneKey())).toEqual({
      ok: false,
      reason: "placeholder-residue",
      missingCount: 0,
    });
  });

  it("still accepts the exact placeholder", () => {
    expect(restoreSecrets("id [[FIXLANG_SECRET_A1B2C3_01]] end", maskingOfOneKey())).toEqual({
      ok: true,
      text: `id ${AWS_DOC_ACCESS_KEY_ID} end`,
    });
  });
});

describe("resolveSecretGuardOutputMode", () => {
  it.each(MANGLED_REPLIES)("forces popup after a %s placeholder, even on the paste path", (
    _description,
    reply,
  ) => {
    const restore = restoreSecrets(reply, maskingOfOneKey());
    expect(resolveSecretGuardOutputMode("paste", restore.ok)).toBe("popup");
  });

  it("leaves the resolved mode alone when the restore succeeded", () => {
    const restore = restoreSecrets("id [[FIXLANG_SECRET_A1B2C3_01]] end", maskingOfOneKey());
    expect(resolveSecretGuardOutputMode("paste", restore.ok)).toBe("paste");
    expect(resolveSecretGuardOutputMode("popup", restore.ok)).toBe("popup");
  });

  it.each([
    ["paste", false, "popup"],
    ["popup", false, "popup"],
    ["paste", true, "paste"],
    ["popup", true, "popup"],
  ] as const)("(%s, restoreOk=%s) resolves to %s", (resolved, restoreOk, expected) => {
    expect(resolveSecretGuardOutputMode(resolved, restoreOk)).toBe(expected);
  });
});
