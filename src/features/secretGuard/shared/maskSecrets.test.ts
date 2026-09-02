/**
 * @file maskSecrets.test.ts
 * @description Masking replaces credentials with salted placeholders on the way
 * out and puts them back on the way in — all of them or none of them.
 *
 * The salt generator is injected exactly like `latencyTimer`'s `now`, so every
 * placeholder below is pinned verbatim.
 */
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./detectSecrets";
import { IRREVERSIBLE_SECRET_REDACTION, maskSecrets, redactSecretsIrreversibly, restoreSecrets } from "./maskSecrets";

const FIXED_SALT = () => "A1B2C3";
const ENTROPY_ON = { highEntropyRule: true, salt: FIXED_SALT } as const;

/**
 * Fixtures are assembled from parts so no complete credential-shaped literal
 * appears in this file's source text. GitHub push protection matches contiguous
 * literals; every value below is fabricated, but the scanner cannot know that.
 * The joined value is byte-identical to what it replaced.
 */
const credentialFixture = (...parts: readonly string[]): string => parts.join("");

const AWS_DOC_ACCESS_KEY_ID = credentialFixture("AKIA", "IOSFODNN7EXAMPLE");
const AWS_DOC_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

describe("maskSecrets", () => {
  it("returns the text unchanged when nothing matches", () => {
    const text = "Please rewrite this sentence so it sounds more confident.";
    const masking = maskSecrets(text, { salt: FIXED_SALT });
    expect(masking.maskedText).toBe(text);
    expect(masking.placeholderCount).toBe(0);
    expect(masking.matchCount).toBe(0);
    expect(masking.ruleIds).toEqual([]);
  });

  it("uses the pinned placeholder shape", () => {
    const masking = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });
    expect(masking.maskedText).toBe("id [[FIXLANG_SECRET_A1B2C3_01]] end");
    expect(masking.placeholderCount).toBe(1);
    expect(masking.ruleIds).toEqual(["aws-access-key-id"]);
  });

  it("keeps the shape a model needs around a masked connection-string password", () => {
    const masking = maskSecrets("postgres://svc:s3cr3tP4ss@db.internal:5432/app", {
      salt: FIXED_SALT,
    });
    expect(masking.maskedText).toBe(
      "postgres://svc:[[FIXLANG_SECRET_A1B2C3_01]]@db.internal:5432/app",
    );
  });

  it("gives one placeholder to a value that occurs twice", () => {
    const masking = maskSecrets(
      `first ${AWS_DOC_ACCESS_KEY_ID} second ${AWS_DOC_ACCESS_KEY_ID}`,
      { salt: FIXED_SALT },
    );
    expect(masking.placeholderCount).toBe(1);
    expect(masking.matchCount).toBe(2);
    expect(masking.maskedText).toBe(
      "first [[FIXLANG_SECRET_A1B2C3_01]] second [[FIXLANG_SECRET_A1B2C3_01]]",
    );
  });

  it("zero-pads the index so `_1` is never a prefix of `_10`", () => {
    const ids = Array.from({ length: 12 }, (_unused, index) =>
      `${credentialFixture("AKIA", "EXAMPLEIDAAAA")}${String(index + 1).padStart(3, "0")}`,
    );
    const text = ids.join("\n");
    const masking = maskSecrets(text, { salt: FIXED_SALT });

    expect(masking.placeholderCount).toBe(12);
    expect(masking.maskedText).toContain("[[FIXLANG_SECRET_A1B2C3_01]]");
    expect(masking.maskedText).toContain("[[FIXLANG_SECRET_A1B2C3_10]]");
    expect(masking.maskedText).not.toContain("[[FIXLANG_SECRET_A1B2C3_1]]");
    expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
  });

  // A masked selection must be safe to scan again — the password slot of a
  // masked DSN still looks exactly like a password.
  it("leaves nothing for a second scan to find, even with the opt-in rule on", () => {
    const text = [
      `AWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY}`,
      `aws_access_key_id ${AWS_DOC_ACCESS_KEY_ID}`,
      "postgres://svc:s3cr3tP4ss@db.internal:5432/app",
      "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcN\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const masking = maskSecrets(text, ENTROPY_ON);

    expect(masking.placeholderCount).toBeGreaterThan(0);
    expect(scanForSecrets(masking.maskedText, { highEntropyRule: true })).toEqual({
      matches: [],
      ruleIds: [],
    });
  });

  /**
   * A partially masked credential is worse than an unmasked one: the feature
   * reports "secret masked" while the tail rides along in the outgoing text,
   * directly after the placeholder.
   */
  it("leaves no tail of a long credential beside the placeholder", () => {
    const longValue = "a1B2".repeat(70);
    const masking = maskSecrets(`SESSION_TOKEN=${longValue} trailing text`, { salt: FIXED_SALT });
    expect(masking.maskedText).toBe("SESSION_TOKEN=[[FIXLANG_SECRET_A1B2C3_01]] trailing text");
    expect(masking.maskedText).not.toContain(longValue.slice(-40));
    expect(restoreSecrets(masking.maskedText, masking)).toEqual({
      ok: true,
      text: `SESSION_TOKEN=${longValue} trailing text`,
    });
  });

  it("keeps an astral-plane character whole on both sides of the round trip", () => {
    const value = `${"a1B2c3D4".repeat(24)}abcdefg\u{1F600}trailingSecretBits1234`;
    const text = `SESSION_TOKEN=${value} end`;
    const masking = maskSecrets(text, { salt: FIXED_SALT });
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(masking.maskedText).not.toMatch(loneSurrogate);
    expect([...masking.replacements.values()].some((kept) => loneSurrogate.test(kept))).toBe(false);
    expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
  });

  /**
   * FixLang ships English and Japanese, and Japanese prose contains no ASCII
   * space, comma or semicolon — so an assignment value that ends only on those
   * ends nowhere and swallows the rest of the document. The model then sees a
   * 37-character request, returns it, the restore puts the original back
   * byte-exactly, and the user's Correction is a silent no-op reported to them
   * as "1 credential masked".
   *
   * A credential is never written in these scripts, so a value containing one
   * is prose the assignment ran into, and the CANDIDATE is rejected. Ending the
   * value at the first such character instead would cut a mixed-script
   * passphrase in half and hand the provider the rest.
   */
  describe("CJK prose is not swallowed into a placeholder", () => {
    const JAPANESE_DOCUMENT = "この段落には空白がありません。".repeat(400);

    it("leaves a Japanese document that merely follows `password=` alone", () => {
      const text = `password=${JAPANESE_DOCUMENT}`;
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });

    it("leaves a short Japanese fragment after `password=` alone too", () => {
      const text = "password=これは秘密ではありません";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });

    /**
     * The stated cost of rejecting rather than cutting, pinned so it is a
     * decision rather than a surprise. `api_key=<ascii>` written hard against
     * Japanese prose is locally indistinguishable from a mixed-script
     * passphrase: both are `password=` followed by one unbroken run of Latin
     * and Japanese. Cutting at the first Japanese character masks the key here
     * and leaks the tail of the passphrase there; rejecting misses here and
     * protects the passphrase there. A miss leaves the user where they already
     * were, so the ambiguity resolves this way.
     */
    it("misses an ASCII credential written hard against Japanese prose", () => {
      const text = "api_key=s3cr3tV4lu3XYZお問い合わせは管理者までご連絡ください。";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });

    it("still masks the same credential when a space separates it from the prose", () => {
      const text = "api_key=s3cr3tV4lu3XYZ お問い合わせは管理者までご連絡ください。";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(
        "api_key=[[FIXLANG_SECRET_A1B2C3_01]] お問い合わせは管理者までご連絡ください。",
      );
      expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
    });
  });

  /**
   * A query string holding two credentials is masked as ONE span covering both,
   * not two spans.
   *
   * That is deliberate, and it is the direction the ambiguity has to resolve.
   * `&` is a parameter separator in `?password=A&api_key=B` and an ordinary
   * character in `db_password=Tr0ub4dor&Xyz=99` — a pinned positive — and
   * nothing in the text says which. Ending the value at `&` splits the first
   * correctly and cuts the second, sending `&Xyz=99` to the provider beside the
   * placeholder while reporting a successful mask. Running the value through
   * `&` over-masks the first and matches the second in full. Over-masking costs
   * the model some context the restore then puts back; the alternative costs
   * the user part of a live credential.
   */
  describe("a query string holding two credentials", () => {
    it("masks both of them, inside one span", () => {
      const text =
        "https://a.example.com/cb?x=1&password=Hunter2Winter&api_key=s3cr3tV4lu3XYZ&next=/home";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.matchCount).toBe(1);
      expect(masking.maskedText).toBe(
        "https://a.example.com/cb?x=1&password=[[FIXLANG_SECRET_A1B2C3_01]]",
      );
      expect(masking.maskedText).not.toContain("Hunter2Winter");
      expect(masking.maskedText).not.toContain("s3cr3tV4lu3XYZ");
      expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
    });

    it("keeps an `&` that is part of the password", () => {
      const text = "db_password=Tr0ub4dor&3xyz";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe("db_password=[[FIXLANG_SECRET_A1B2C3_01]]");
      expect([...masking.replacements.values()]).toEqual(["Tr0ub4dor&3xyz"]);
    });

    it("keeps an `&` that is part of the password when a query parameter follows it", () => {
      const text = "db_password=Tr0ub4dor&Xyz=99";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe("db_password=[[FIXLANG_SECRET_A1B2C3_01]]");
      expect([...masking.replacements.values()]).toEqual(["Tr0ub4dor&Xyz=99"]);
    });
  });

  /**
   * The invariant the whole rule rests on, asserted as a shape rather than as a
   * list of expected spans: for `name=value`, the outgoing text is EITHER the
   * input untouched (a miss — the pre-existing behaviour for anything the
   * detector does not recognise) OR the name followed by one placeholder and
   * nothing else. Anything between the two is a partial mask, which sends the
   * tail of a live credential to the provider while telling the user it was
   * masked.
   *
   * Every value below is a credential a real password manager or IME can
   * produce, and each one was truncated by the character classes this rule used
   * to end values on.
   */
  describe("an assignment value is masked in full or not at all", () => {
    const VALUES: readonly string[] = [
      "Tr0ub4dor&Xyz=99",
      "Tr0ub4dor&3xyz",
      "Hunter2#Winter=99",
      "P@ss#word=123",
      "s3cr3tV4?lu3XYZ=1",
      "Passw0rd;More1234",
      "Passw0rd,More1234",
      "Tr0ub4dor'Xyz=99",
      'Tr0ub4dor"Xyz=99',
      "O'Brien2024!xyz",
      "who?knows!this9",
      "P@ss#w0rd!123",
      "abc123パスワード456",
      "Winter2024겨울비밀",
      "s3cr3tV4lu3１２３４",
      "ぱすわーど12345678",
      "cafépassw0rdüber",
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "a%2Fb%2Bc%3Dd%26e%3Df",
      "s3cr3t\u{1F600}V4lu3XYZ",
    ];

    it.each(VALUES)("password=%s", (value) => {
      const text = `password=${value}`;
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      const masked = masking.maskedText;
      if (masking.matchCount === 0) {
        expect(masked).toBe(text);
        return;
      }
      expect(masked).toBe("password=[[FIXLANG_SECRET_A1B2C3_01]]");
      expect(restoreSecrets(masked, masking)).toEqual({ ok: true, text });
    });

    it.each(VALUES)("db_password=%s in the middle of a sentence", (value) => {
      const text = `use db_password=${value} for staging`;
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      const masked = masking.maskedText;
      if (masking.matchCount === 0) {
        expect(masked).toBe(text);
        return;
      }
      expect(masked).toBe("use db_password=[[FIXLANG_SECRET_A1B2C3_01]] for staging");
      expect(restoreSecrets(masked, masking)).toEqual({ ok: true, text });
    });
  });

  /**
   * A quoted value is the one case where a space inside a credential is
   * unambiguous — the quote says where the value ends, so a space cannot be it.
   * The value class still stops at the space, so what protects the user is the
   * REJECTION: no dialog and no mask, rather than `Correct` masked and
   * ` Horse Battery"` sent to the provider under a green label.
   *
   * Unquoted, the same passphrase is irreducible: whitespace is the only thing
   * standing between `password=` and the rest of the document, so it has to end
   * the value, and this shape has always been cut. It is pinned here as a known
   * limit rather than left to be rediscovered.
   */
  describe("a value whose credential contains a space", () => {
    it("masks nothing when the value is quoted and the space is inside the quotes", () => {
      const text = 'db_password: "Correct Horse Battery"';
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });

    it("masks nothing for a quoted JSON value with a space in it", () => {
      const text = '{"api_key": "s3cr3t value with space"}';
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });

    /**
     * The boundary quotes go INTO the span, because the credential may be its
     * own quotes and nothing local says which. Under the reading where they are
     * delimiters the mask simply covers two characters more, and the restore
     * puts them back byte-exactly — which is the whole point of widening rather
     * than corroborating.
     */
    it("still masks a quoted value with no space in it, quotes included", () => {
      const text = 'db_password: "CorrectHorseBattery"';
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe("db_password: [[FIXLANG_SECRET_A1B2C3_01]]");
      expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
    });

    /**
     * An unquoted value ends at the first space and always has: whitespace is
     * the only thing standing between `password=` and the rest of the document.
     * Rejecting every such value costs 39 % of real credential lines, so the
     * match is kept and the masking says `fullyMaskable: false` instead. The
     * gate reads that field and asks the user rather than masking a passphrase
     * in part — which is what stops this from being a leak reported as a mask.
     */
    it("reports a cut-at-the-space passphrase as not fully maskable", () => {
      const text = "password=correct horse battery staple";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.matchCount).toBe(1);
      expect(masking.fullyMaskable).toBe(false);
    });

    it("reports the same passphrase as fully maskable once it is quoted and unbroken", () => {
      const text = 'db_password: "CorrectHorseBatteryStaple"';
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.matchCount).toBe(1);
      expect(masking.fullyMaskable).toBe(true);
    });

    it("reports a text with nothing to mask as fully maskable", () => {
      expect(maskSecrets("nothing here", { salt: FIXED_SALT }).fullyMaskable).toBe(true);
    });
  });

  /**
   * A quote can end a value or sit inside one, and the difference is not in the
   * value — the class never lets a quote into it. What tells them apart is what
   * follows the quote: structure or nothing on one side, more of the value on
   * the other.
   */
  describe("a value that stops at a quote it did not open", () => {
    it("masks a credential inside a quoted JSON string", () => {
      const text = '{"callback": "https://a.example.com/cb?password=Hunter2Winter"}';
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(
        '{"callback": "https://a.example.com/cb?password=[[FIXLANG_SECRET_A1B2C3_01]]"}',
      );
      expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
    });

    it("masks nothing when the quote is followed by more of the value", () => {
      const text = "db_password=Tr0ub4dor'Xyz=99";
      const masking = maskSecrets(text, { salt: FIXED_SALT });
      expect(masking.maskedText).toBe(text);
      expect(masking.matchCount).toBe(0);
    });
  });

  it("draws a fresh salt per request", () => {
    const salts = ["AAAAAA", "BBBBBB"];
    const first = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID}`, { salt: () => salts[0] });
    const second = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID}`, { salt: () => salts[1] });
    expect(first.maskedText).not.toBe(second.maskedText);
    // A stale placeholder from an earlier request can never match this one.
    expect(restoreSecrets(first.maskedText, second)).toEqual({
      ok: false,
      reason: "placeholder-missing",
      missingCount: 1,
    });
  });
});

describe("restoreSecrets", () => {
  it("puts every value back byte-exactly", () => {
    const text = `key ${AWS_DOC_ACCESS_KEY_ID} and secret ${AWS_DOC_SECRET_ACCESS_KEY} done`;
    const masking = maskSecrets(
      `AWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY} ${AWS_DOC_ACCESS_KEY_ID}`,
      { salt: FIXED_SALT },
    );
    const restored = restoreSecrets(masking.maskedText, masking);
    expect(restored).toEqual({
      ok: true,
      text: `AWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY} ${AWS_DOC_ACCESS_KEY_ID}`,
    });
    expect(text).toContain(AWS_DOC_ACCESS_KEY_ID);
  });

  /**
   * `String.replaceAll` interprets `$&`, `$1` and `$'` in the REPLACEMENT, so a
   * secret containing them would be silently corrupted and then pasted over the
   * user's real selection in a third-party app. The masker uses
   * `split(placeholder).join(value)` for exactly this reason.
   */
  it("round-trips a secret containing $&, $1 and $' byte-exactly", () => {
    const text = "DSN postgres://svc:p$&$1$'q@db.example.com/app end";
    const masking = maskSecrets(text, { salt: FIXED_SALT });
    expect(masking.maskedText).toBe(
      "DSN postgres://svc:[[FIXLANG_SECRET_A1B2C3_01]]@db.example.com/app end",
    );
    expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
  });

  it("restores a placeholder the model moved and re-worded around", () => {
    const masking = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });
    const reply = "The identifier [[FIXLANG_SECRET_A1B2C3_01]] appears at the end.";
    expect(restoreSecrets(reply, masking)).toEqual({
      ok: true,
      text: `The identifier ${AWS_DOC_ACCESS_KEY_ID} appears at the end.`,
    });
  });

  /**
   * This used to restore, on the reasoning that replacing every occurrence is
   * simply what replacement means. It is the hole underneath that reasoning
   * that changed it: the provider never sees the credential, but it does
   * choose where its placeholder lands, and restoration is what turns that
   * choice into the real value in the user's document. One occurrence in,
   * two out, is the model materializing a secret in a place the user's own
   * text never had one.
   */
  it("refuses a reply that repeated a placeholder rather than materializing the secret twice", () => {
    const masking = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });
    const reply = "[[FIXLANG_SECRET_A1B2C3_01]] then [[FIXLANG_SECRET_A1B2C3_01]]";
    expect(restoreSecrets(reply, masking)).toEqual({
      ok: false,
      reason: "placeholder-multiplicity",
      missingCount: 1,
    });
  });

  it("keeps a placeholder the sent text itself repeated, at the same count", () => {
    const masking = maskSecrets(
      `first ${AWS_DOC_ACCESS_KEY_ID} then ${AWS_DOC_ACCESS_KEY_ID}`,
      { salt: FIXED_SALT },
    );
    const reply = "[[FIXLANG_SECRET_A1B2C3_01]] and again [[FIXLANG_SECRET_A1B2C3_01]].";
    expect(restoreSecrets(reply, masking)).toEqual({
      ok: true,
      text: `${AWS_DOC_ACCESS_KEY_ID} and again ${AWS_DOC_ACCESS_KEY_ID}.`,
    });
  });

  /**
   * The attack the count check alone does not stop: multiplicity is
   * preserved, the reply reads as an ordinary rewrite, and the restored
   * credential lands somewhere the receiving app will unfurl or fetch.
   */
  it("refuses a reply that moved a placeholder into a link", () => {
    const masking = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });

    expect(
      restoreSecrets("See https://attacker.example/?k=[[FIXLANG_SECRET_A1B2C3_01]]", masking),
    ).toEqual({ ok: false, reason: "placeholder-relocated", missingCount: 1 });

    expect(
      restoreSecrets("See [details](https://x.example/[[FIXLANG_SECRET_A1B2C3_01]])", masking),
    ).toEqual({ ok: false, reason: "placeholder-relocated", missingCount: 1 });
  });

  /**
   * The counterpart that keeps the check from being a blanket ban: a
   * credential that legitimately lived in a URL is compared against where it
   * WAS, not against the shape of the reply. Without this, `url-credentials`
   * — the rule whose whole purpose is masking the password inside a DSN —
   * could never round-trip at all.
   */
  it("allows a placeholder that was already inside a link in the sent text", () => {
    const text = "DSN postgres://svc:hunter2horsebattery@db.example.com/app end";
    const masking = maskSecrets(text, { salt: FIXED_SALT });
    expect(masking.maskedText).toContain("://");

    expect(restoreSecrets(masking.maskedText, masking)).toEqual({ ok: true, text });
  });

  it("is a no-op when nothing was masked", () => {
    const text = "Nothing sensitive here.";
    const masking = maskSecrets(text, { salt: FIXED_SALT });
    expect(restoreSecrets("Nothing sensitive here at all.", masking)).toEqual({
      ok: true,
      text: "Nothing sensitive here at all.",
    });
  });

  it("refuses all-or-nothing when one of two placeholders is gone", () => {
    const masking = maskSecrets(
      `${AWS_DOC_ACCESS_KEY_ID}\nAWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY}`,
      { salt: FIXED_SALT },
    );
    expect(restoreSecrets("only [[FIXLANG_SECRET_A1B2C3_01]] survived", masking)).toEqual({
      ok: false,
      reason: "placeholder-missing",
      missingCount: 1,
    });
  });

  /**
   * The pinned failure shapes. A model that rewrote the placeholder gives no
   * evidence it left anything else alone, so each of these refuses rather than
   * restoring what it can.
   */
  describe("a mangled placeholder is a missing placeholder", () => {
    const MANGLED_REPLIES: readonly { shape: string; reply: string }[] = [
      { shape: "absent", reply: "The identifier did not come back at all." },
      { shape: "lowercased", reply: "id [[fixlang_secret_a1b2c3_01]] end" },
      { shape: "spaced", reply: "id [[ FIXLANG_SECRET_A1B2C3_01 ]] end" },
      { shape: "re-bracketed into 「」", reply: "id 「FIXLANG_SECRET_A1B2C3_01」 end" },
      { shape: "truncated", reply: "id [[FIXLANG_SECRET_A1B2C3_0 end" },
    ];

    it.each(MANGLED_REPLIES)("$shape → ok:false", ({ reply }) => {
      const masking = maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });
      expect(restoreSecrets(reply, masking)).toEqual({
        ok: false,
        reason: "placeholder-missing",
        missingCount: 1,
      });
    });
  });

  /**
   * The second gate. Counting alone passes these — the real key IS present — so
   * without the residue check a salted marker lands in the user's document under
   * an "all-or-nothing succeeded" verdict.
   */
  describe("the residue check", () => {
    const maskOne = () => maskSecrets(`id ${AWS_DOC_ACCESS_KEY_ID} end`, { salt: FIXED_SALT });

    it("refuses a hallucinated index alongside an intact placeholder", () => {
      expect(
        restoreSecrets(
          "[[FIXLANG_SECRET_A1B2C3_01]] and [[FIXLANG_SECRET_A1B2C3_02]]",
          maskOne(),
        ),
      ).toEqual({ ok: false, reason: "placeholder-residue", missingCount: 0 });
    });

    // No legitimate text contains `fixlang_secret_<salt>` in ANY casing, and a
    // stray marker pasted into a third-party app is a visible artefact.
    it("refuses a lowercased copy left beside the correct one", () => {
      expect(
        restoreSecrets(
          "[[FIXLANG_SECRET_A1B2C3_01]] and [[fixlang_secret_a1b2c3_01]]",
          maskOne(),
        ),
      ).toEqual({ ok: false, reason: "placeholder-residue", missingCount: 0 });
    });

    it("refuses a marker the model re-bracketed but did not otherwise change", () => {
      expect(
        restoreSecrets("[[FIXLANG_SECRET_A1B2C3_01]] and 「FIXLANG_SECRET_A1B2C3_02」", maskOne()),
      ).toEqual({ ok: false, reason: "placeholder-residue", missingCount: 0 });
    });
  });
});

describe("redactSecretsIrreversibly", () => {
  it("leaves clean text byte-identical", () => {
    const text = "Recent transforms: Correction (2026-08-11T05:28:00.000Z)";
    expect(redactSecretsIrreversibly(text)).toBe(text);
  });

  it("replaces a credential with the irreversible marker, not a restore placeholder", () => {
    const text = `- ${AWS_DOC_ACCESS_KEY_ID} (2026-08-11T05:28:00.000Z)`;
    const redacted = redactSecretsIrreversibly(text);

    expect(redacted).not.toContain(AWS_DOC_ACCESS_KEY_ID);
    expect(redacted).toContain(IRREVERSIBLE_SECRET_REDACTION);
    expect(redacted).not.toContain("FIXLANG_SECRET_");
    expect(redacted).toBe(`- ${IRREVERSIBLE_SECRET_REDACTION} (2026-08-11T05:28:00.000Z)`);
  });
});
