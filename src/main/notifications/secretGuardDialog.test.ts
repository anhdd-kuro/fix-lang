/**
 * @file secretGuardDialog.test.ts
 * @description The confirm-before-sending-a-secret dialog. Four properties
 * carry this file:
 *
 *   1. **It cannot leak a value.** `buildSecretConfirmDialog`'s parameter type
 *      accepts no free text at all — only a closed union of rule ids and a
 *      count — so the unsafe call does not exist to be written. Proven twice:
 *      the declared type is pinned to contain no `string`, and a dialog built
 *      from a real scan of text stuffed with every pinned secret sample
 *      JSON-stringifies without any of them.
 *   2. **No "Don't ask again" checkbox.** A one-click permanent disable of the
 *      only protection, sitting on the surface the user most wants gone.
 *   3. **Reentrancy fails CLOSED.** Not time-throttled — a suppressed dialog
 *      means a secret sent without consent — so a second call while one is
 *      open resolves `false` instead of stacking a modal or becoming an
 *      implicit yes.
 *   4. **Proceed only on the Send INDEX.** Never truthiness, never `!== 0`.
 *
 * `~/main/i18n` transitively instantiates a real `electron-store` at module
 * scope, so `~/features/i18n/store/localeStore` is mocked directly (the
 * `confirmLargeSelection.test.ts` pattern) — the real translator and catalog
 * still run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanForSecrets } from "~/features/secretGuard/shared/detectSecrets";
import { buildSecretConfirmDialog, confirmSecretSend } from "./secretGuardDialog";
import type { SecretRuleId } from "~/features/secretGuard/shared/secretRules";

const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn(),
}));

vi.mock("electron", () => {
  const mockedExports = { dialog: { showMessageBox: showMessageBoxMock } };
  return { ...mockedExports, default: mockedExports };
});

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: vi.fn().mockReturnValue("en"),
}));

const SOURCE = readFileSync(path.join(__dirname, "secretGuardDialog.ts"), "utf8");

/**
 * Fixtures are assembled from parts so no complete credential-shaped literal
 * appears in this file's source text. GitHub push protection matches contiguous
 * literals; every value below is fabricated, but the scanner cannot know that.
 * The joined value is byte-identical to what it replaced.
 */
const credentialFixture = (...parts: readonly string[]): string => parts.join("");

/**
 * Vendor-published or obviously-fake-but-structurally-real samples, the same
 * family `detectSecrets.test.ts` pins. If any of these ever appears in a built
 * dialog, a credential reached a screen the user can screenshot.
 */
const PINNED_SECRET_SAMPLES = [
  credentialFixture("AKIA", "IOSFODNN7EXAMPLE"),
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  credentialFixture("sk-ant-api03-", "EXAMPLEfakekeymaterial0123456789abcdefgh-AAAAAA"),
  credentialFixture("sk-or-v1-", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"),
  "sk-proj-EXAMPLEfakeOpenAIkey1234567890abcdef",
  credentialFixture("ghp_", "EXAMPLEfakegithubtoken0123456789abcdefgh"),
  credentialFixture("xoxb-", "000000000000-000000000000-EXAMPLEfakeslacktoken"),
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  "https://admin:hunter2@internal.example.com/db",
  "DATABASE_PASSWORD=sup3rs3cr3tvalue",
];

const SECRET_LADEN_TEXT = PINNED_SECRET_SAMPLES.join("\n");

const ALL_RULE_IDS: readonly SecretRuleId[] = [
  "private-key-block",
  "url-credentials",
  "authorization-header",
  "anthropic-key",
  "openrouter-key",
  "openai-key",
  "aws-access-key-id",
  "github-token",
  "slack-token",
  "google-api-key",
  "gitlab-token",
  "stripe-secret-key",
  "npm-token",
  "shopify-token",
  "digitalocean-token",
  "jwt",
  "credential-assignment",
  "high-entropy-string",
];

const deferredResponse = () => {
  let resolve!: (value: { response: number }) => void;
  const promise = new Promise<{ response: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const sendIndexOf = (options: { buttons: string[]; cancelId: number }): number => {
  const index = options.buttons.findIndex((label) => /send/i.test(label));
  expect(index).toBeGreaterThan(-1);
  expect(index).not.toBe(options.cancelId);
  return index;
};

describe("buildSecretConfirmDialog", () => {
  it("declares a parameter type that accepts no free text", () => {
    const declaration = SOURCE.match(
      /export type SecretConfirmDialogInput = \{[\s\S]*?\n\};/,
    )?.[0];

    expect(declaration).toBeDefined();
    expect(declaration).not.toMatch(/\bstring\b/);
    expect(declaration).toMatch(/ruleIds/);
    expect(declaration).toMatch(/matchCount/);
  });

  it("leaks no pinned secret sample when built from a real scan of text containing them all", () => {
    const scan = scanForSecrets(SECRET_LADEN_TEXT, { highEntropyRule: true });
    expect(scan.matches.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(
      buildSecretConfirmDialog({
        ruleIds: scan.ruleIds,
        matchCount: scan.matches.length,
      }),
    );

    for (const sample of PINNED_SECRET_SAMPLES) {
      expect(serialized).not.toContain(sample);
    }
  });

  it("ignores any extra field a caller smuggles past the type", () => {
    const serialized = JSON.stringify(
      buildSecretConfirmDialog({
        ruleIds: ["aws-access-key-id"],
        matchCount: 1,
        // why: the type forbids this; the assertion is that the BUILDER reads
        // only its declared fields, so a future refactor cannot spread input.
        text: PINNED_SECRET_SAMPLES[0],
      } as never),
    );

    expect(serialized).not.toContain(PINNED_SECRET_SAMPLES[0]);
  });

  it("names rules, translated, never values", () => {
    const options = buildSecretConfirmDialog({
      ruleIds: ["aws-access-key-id"],
      matchCount: 1,
    });

    expect(options.detail).toContain("AWS access key ID");
  });

  it("names at most 3 rules and then says how many more", () => {
    const options = buildSecretConfirmDialog({
      ruleIds: ALL_RULE_IDS,
      matchCount: ALL_RULE_IDS.length,
    });

    const detail = options.detail ?? "";

    expect(detail).toContain("Private key block");
    expect(detail).toContain("URL credentials");
    expect(detail).toContain("Authorization header");
    expect(detail).not.toContain("Anthropic API key");
    expect(detail).toContain(`and ${ALL_RULE_IDS.length - 3} more`);
  });

  it("names every rule and adds no tail when there are exactly 3", () => {
    const options = buildSecretConfirmDialog({
      ruleIds: ["private-key-block", "url-credentials", "authorization-header"],
      matchCount: 3,
    });

    expect(options.detail).toContain("Authorization header");
    expect(options.detail).not.toMatch(/\bmore\b/);
  });

  it("uses the singular detail for one match and the plural for more", () => {
    const one = buildSecretConfirmDialog({ ruleIds: ["jwt"], matchCount: 1 });
    const many = buildSecretConfirmDialog({ ruleIds: ["jwt"], matchCount: 3 });

    expect(one.detail).not.toEqual(many.detail);
    expect(one.detail).toContain("1 secret");
    expect(many.detail).toContain("3 secrets");
  });

  it("offers exactly Cancel and Send anyway, with Cancel as both default and cancel", () => {
    const options = buildSecretConfirmDialog({ ruleIds: ["jwt"], matchCount: 1 });

    expect(options.buttons).toHaveLength(2);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
    expect(options.buttons?.[0]).toMatch(/cancel/i);
    expect(options.buttons?.[1]).toMatch(/send/i);
  });

  it("carries no do-not-ask-again checkbox", () => {
    const options = buildSecretConfirmDialog({ ruleIds: ["jwt"], matchCount: 1 });

    expect(options.checkboxLabel).toBeUndefined();
    expect(options.checkboxChecked).toBeUndefined();
    // No `checkbox*` property is ever SET; the source may still name one in
    // the comment explaining why it must not come back.
    expect(SOURCE).not.toMatch(/checkbox\w*\s*:/i);
  });
});

describe("confirmSecretSend", () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset();
  });

  it("never references showMessageBoxSync, and the mocked dialog exposes no such method", () => {
    expect(SOURCE).not.toMatch(/showMessageBoxSync/);
    expect(
      (electron.dialog as { showMessageBoxSync?: unknown }).showMessageBoxSync,
    ).toBeUndefined();
  });

  it("proceeds only on the Send index, asserted by index", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);

    const options = showMessageBoxMock.mock.calls[0][0];
    const sendIndex = sendIndexOf(options);

    showMessageBoxMock.mockResolvedValue({ response: sendIndex });
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(true);
  });

  it.each([2, 3, -1, Number.NaN])(
    "refuses any response index that is not Send: %s",
    async (response) => {
      showMessageBoxMock.mockResolvedValue({ response });

      expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    },
  );

  it("fails closed on a reentrant call and opens no second modal", async () => {
    const first = deferredResponse();
    showMessageBoxMock.mockReturnValueOnce(first.promise);

    const pending = confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 });
    const reentrant = await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 });

    expect(reentrant).toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    first.resolve({ response: 1 });
    expect(await pending).toBe(true);
  });

  /**
   * The reentrancy guard's early return must sit OUTSIDE the `try`, because the
   * `finally` clears `dialogInFlight` unconditionally. Move it inside and the
   * SECOND caller's exit clears the FIRST caller's flag — after which a THIRD
   * caller, arriving while the first dialog is still open, is let through and
   * stacks a modal on top of it. The single-reentrant-call test above cannot
   * see that: it resolves the first dialog immediately, so no third caller ever
   * arrives while the flag is wrong.
   *
   * The load-bearing assertion is the CALL COUNT, not the returned `false` — a
   * third call that opens a second modal still resolves `false` (its
   * `showMessageBox` has no queued value and throws into the fail-closed
   * catch), so a return-value assertion alone passes under both spellings.
   */
  it("keeps failing closed for every caller that arrives while one dialog is open", async () => {
    const first = deferredResponse();
    showMessageBoxMock.mockReturnValueOnce(first.promise);

    const pending = confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 });

    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    first.resolve({ response: 1 });
    expect(await pending).toBe(true);

    // The flag belongs to the dialog that set it: once THAT one closes, and
    // only then, the next press is asked again.
    showMessageBoxMock.mockResolvedValue({ response: 0 });
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight flag once the dialog closes, so the next press is asked again", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);

    expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight flag when the dialog rejects, and fails closed", async () => {
    showMessageBoxMock.mockRejectedValueOnce(new Error("dialog exploded"));

    await expect(
      confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 }),
    ).resolves.toBe(false);

    showMessageBoxMock.mockResolvedValue({ response: 0 });
    expect(await confirmSecretSend({ ruleIds: ["jwt"], matchCount: 1 })).toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
  });
});
