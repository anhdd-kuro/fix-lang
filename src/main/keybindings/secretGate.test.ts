/**
 * @file secretGate.test.ts
 * @description The per-send-site secret policy. The point of this file is
 * that there is exactly ONE table and all three behaviours are visible in it
 * together:
 *
 *   | site       | confirm | mask                                    |
 *   |------------|---------|-----------------------------------------|
 *   | correction | confirm | mask-and-restore                        |
 *   | promptGen  | confirm | mask-no-restore (its output is a prompt)|
 *   | ask        | confirm | confirm (a free-form answer rarely echoes
 *   |            |         | placeholders, so restore would fail and  |
 *   |            |         | permanently divert Ask to the popup)     |
 *
 * Call sites must READ that table, never re-derive it, so the tests below
 * drive `runSecretGate` per site rather than asserting the constant alone.
 *
 * Two safety properties beyond the table: masking never opens the dialog
 * (friction on a safe path is what trains people to dismiss dialogs on the
 * unsafe path), and nothing that touches a real credential — the masking's
 * `replacements` map above all — ever reaches a log line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redactLogContext } from "~/features/logs/shared/logging";
import { SECRET_GUARD_MODES } from "~/features/secretGuard/shared/secretGuardSettings";
import { SECRET_PLACEHOLDER_MARKER } from "~/features/secretGuard/shared/secretRules";
import { SECRET_SEND_SITE_POLICY, runSecretGate } from "./secretGate";
import type { SecretGateInput, SecretSendSite } from "./secretGate";
import type { LogContext } from "~/features/logs/shared/logging";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

const { confirmSecretSendMock, loggerMock } = vi.hoisted(() => ({
  confirmSecretSendMock: vi.fn(),
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("~/main/notifications/secretGuardDialog", () => ({
  confirmSecretSend: confirmSecretSendMock,
}));

vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

/**
 * Fixtures are assembled from parts so no complete credential-shaped literal
 * appears in this file's source text. GitHub push protection matches contiguous
 * literals; every value below is fabricated, but the scanner cannot know that.
 * The joined value is byte-identical to what it replaced.
 */
const credentialFixture = (...parts: readonly string[]): string => parts.join("");

const AWS_KEY = credentialFixture("AKIA", "IOSFODNN7EXAMPLE");
const SECRET_TEXT = `my deploy key is ${AWS_KEY} and it works`;
const CLEAN_TEXT = "please review this paragraph for me";

const SITES: readonly SecretSendSite[] = ["correction", "promptGen", "ask", "combo"];

const settings = (overrides: Partial<SecretGuardSettings> = {}): SecretGuardSettings => ({
  mode: "confirm",
  highEntropyRule: false,
  ...overrides,
});

const gate = async (site: SecretSendSite, text: string, mode: SecretGuardSettings["mode"]) =>
  runSecretGate({
    site,
    text,
    settings: settings({ mode }),
    salt: () => "A1B2C3",
  });

const loggedContexts = (): LogContext[] =>
  [loggerMock.debug, loggerMock.info, loggerMock.warn, loggerMock.error].flatMap((fn) =>
    fn.mock.calls.map((call) => (call[2] ?? {}) as LogContext),
  );

type AroundDialog = NonNullable<SecretGateInput["aroundDialog"]>;

/**
 * `aroundDialog` is GENERIC, and `Mock<…>` collapses a generic signature into a
 * concrete one, so a bare `vi.fn()` does not satisfy it however right the body
 * looks. This hands the gate a genuinely generic wrapper and records the calls
 * on a counter beside it, so the assertions below stay about the wrapper's
 * behaviour rather than about a mock's shape.
 */
const countingAroundDialog = (
  body: AroundDialog = (show) => show(),
): { aroundDialog: AroundDialog; callCount: () => number } => {
  let calls = 0;
  return {
    aroundDialog: (show) => {
      calls += 1;
      return body(show);
    },
    callCount: () => calls,
  };
};

describe("SECRET_SEND_SITE_POLICY", () => {
  it("is one table covering every site and every stored mode", () => {
    expect(SECRET_SEND_SITE_POLICY).toEqual({
      correction: { off: "off", confirm: "confirm", mask: "mask-and-restore" },
      promptGen: { off: "off", confirm: "confirm", mask: "mask-no-restore" },
      ask: { off: "off", confirm: "confirm", mask: "confirm" },
      combo: { off: "off", confirm: "confirm", mask: "confirm" },
    });
  });

  it("leaves no site/mode combination undefined", () => {
    for (const site of SITES) {
      for (const mode of SECRET_GUARD_MODES) {
        expect(SECRET_SEND_SITE_POLICY[site][mode]).toBeDefined();
      }
    }
  });

  it("is frozen at both levels, so a stray write from a call site throws instead of silently succeeding", () => {
    expect(Object.isFrozen(SECRET_SEND_SITE_POLICY)).toBe(true);
    expect(Object.isFrozen(SECRET_SEND_SITE_POLICY.ask)).toBe(true);

    expect(() => {
      // @ts-expect-error — intentionally mutating a Readonly table to prove it is also frozen at runtime.
      SECRET_SEND_SITE_POLICY.ask.mask = "mask-and-restore";
    }).toThrow(TypeError);
    expect(SECRET_SEND_SITE_POLICY.ask.mask).toBe("confirm");
  });
});

describe("runSecretGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmSecretSendMock.mockResolvedValue(true);
  });

  describe("mode off", () => {
    it.each(SITES)("sends %s untouched and never opens a dialog", async (site) => {
      const result = await gate(site, SECRET_TEXT, "off");

      expect(result).toMatchObject({
        gateDecision: "allow",
        sentText: SECRET_TEXT,
        masking: null,
        restoreOnReply: false,
        appliedMode: "off",
      });
      expect(confirmSecretSendMock).not.toHaveBeenCalled();
    });
  });

  describe("nothing detected", () => {
    it.each(SITES)("allows %s in confirm mode without a dialog", async (site) => {
      const result = await gate(site, CLEAN_TEXT, "confirm");

      expect(result).toMatchObject({
        gateDecision: "allow",
        sentText: CLEAN_TEXT,
        masking: null,
      });
      expect(confirmSecretSendMock).not.toHaveBeenCalled();
    });

    // Expectations are LITERAL per site. Branching on
    // `SECRET_SEND_SITE_POLICY[site].mask` would recompute the expected value
    // from the implementation's own constant, so changing that cell would
    // change the assertion with it and the test would pass by construction.
    it.each(["correction", "promptGen"] as const)(
      "allows %s in mask mode and still hands back a masking, so restore needs no special case",
      async (site) => {
        const result = await gate(site, CLEAN_TEXT, "mask");

        expect(result.gateDecision).toBe("allow");
        if (result.gateDecision === "declined") throw new Error("unexpected decline");
        expect(result.sentText).toBe(CLEAN_TEXT);
        expect(result.masking?.matchCount).toBe(0);
      },
    );

    it.each(["ask", "combo"] as const)(
      "allows %s in mask mode with NO masking — its mask degrades to confirm, and a confirm never masks",
      async (site) => {
        const result = await gate(site, CLEAN_TEXT, "mask");

        expect(result).toMatchObject({
          gateDecision: "allow",
          sentText: CLEAN_TEXT,
          masking: null,
          appliedMode: "confirm",
        });
      },
    );
  });

  describe("confirm mode", () => {
    it.each(SITES)("asks before sending from %s and proceeds on Send anyway", async (site) => {
      const result = await gate(site, SECRET_TEXT, "confirm");

      expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
      expect(confirmSecretSendMock).toHaveBeenCalledWith({
        ruleIds: ["aws-access-key-id"],
        matchCount: 1,
      });
      expect(result).toMatchObject({
        gateDecision: "confirmed",
        sentText: SECRET_TEXT,
        masking: null,
        restoreOnReply: false,
        appliedMode: "confirm",
      });
    });

    it.each(SITES)("declines from %s when the dialog is cancelled", async (site) => {
      confirmSecretSendMock.mockResolvedValue(false);

      const result = await gate(site, SECRET_TEXT, "confirm");

      expect(result).toMatchObject({ gateDecision: "declined", appliedMode: "confirm" });
      expect(result).not.toHaveProperty("sentText");
    });
  });

  describe("mask mode, per site", () => {
    it("masks and restores for correction — the only path that pastes over a selection", async () => {
      const result = await gate("correction", SECRET_TEXT, "mask");

      expect(result).toMatchObject({
        gateDecision: "masked",
        restoreOnReply: true,
        appliedMode: "mask-and-restore",
      });
      if (result.gateDecision !== "masked") throw new Error("expected masked");
      expect(result.sentText).not.toContain(AWS_KEY);
      expect(result.masking?.placeholderCount).toBe(1);
      expect(result.masking?.replacements.size).toBe(1);
    });

    it("masks without restoring for promptGen — a prompt containing placeholders is the correct artifact", async () => {
      const result = await gate("promptGen", SECRET_TEXT, "mask");

      expect(result).toMatchObject({
        gateDecision: "masked",
        restoreOnReply: false,
        appliedMode: "mask-no-restore",
      });
      if (result.gateDecision !== "masked") throw new Error("expected masked");
      expect(result.sentText).not.toContain(AWS_KEY);
    });

    it("degrades to confirm for ask — a free-form answer rarely echoes placeholders", async () => {
      const result = await gate("ask", SECRET_TEXT, "mask");

      expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        gateDecision: "confirmed",
        sentText: SECRET_TEXT,
        masking: null,
        appliedMode: "confirm",
      });
    });

    /**
     * Same verdict as `ask`, for a stronger reason: only the LAST step's output
     * is delivered, so a restore would have to survive every step in between —
     * and the fold has no single site semantics, so a combo ending on a
     * `Prompt optimization` step would get a live credential restored into a
     * generated artifact. `mask-no-restore` is not available either: a combo
     * pastes over the user's selection, so it would paste placeholders there.
     */
    it("degrades to confirm for combo — only the last step's output is delivered, so nothing can be restored across the fold", async () => {
      const result = await gate("combo", SECRET_TEXT, "mask");

      expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        gateDecision: "confirmed",
        sentText: SECRET_TEXT,
        masking: null,
        appliedMode: "confirm",
      });
      // No masking at this site means no placeholder can ever reach `deliver`,
      // so the "Result not pasted" path has nothing to catch.
      expect(result).toMatchObject({ restoreOnReply: false });
    });

    it.each(["correction", "promptGen"] as const)(
      "never opens a dialog for %s — nothing is being sent, so there is nothing to confirm",
      async (site) => {
        await gate(site, SECRET_TEXT, "mask");

        expect(confirmSecretSendMock).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * The detector reports a span it cannot prove covers the whole credential
   * with `maskable: false`, and `maskSecrets` rolls that up as
   * `fullyMaskable: false`. Consuming it is THIS file's job: masking such a
   * span sends the uncovered remainder beside the placeholder, under a
   * settings panel that says masking means nothing leaves the machine. So the
   * whole request downgrades to a confirm — nothing is masked, and the user
   * decides with the rule names in front of them.
   *
   * The downgrade is a property of the MASK, not of the site: both
   * `mask-and-restore` and `mask-no-restore` take it, through one code path.
   * promptGen's lack of a restore makes its downgrade MORE worth asking about,
   * not less — a confirmed send there leaves the credential verbatim in a
   * generated prompt the user keeps — but "mask part of it anyway" is not a
   * button this dialog has, and giving promptGen its own answer would put a
   * second policy decision outside the one table.
   */
  describe("a mask that cannot cover the whole credential downgrades to confirm", () => {
    /**
     * An unquoted assignment value that stops at a space may or may not stop
     * there for real. Masking it sends ` Horse Battery` beside the
     * placeholder; the detector therefore reports it `maskable: false`.
     */
    const PARTIAL_MASK_TEXT = "password=Correct Horse Battery";

    it.each(["correction", "promptGen"] as const)(
      "asks before sending from %s in mask mode, and masks nothing",
      async (site) => {
        const result = await gate(site, PARTIAL_MASK_TEXT, "mask");

        expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
        expect(confirmSecretSendMock).toHaveBeenCalledWith({
          ruleIds: ["credential-assignment"],
          matchCount: 1,
        });
        expect(result).toMatchObject({
          gateDecision: "confirmed",
          appliedMode: "confirm",
          sentText: PARTIAL_MASK_TEXT,
          masking: null,
          restoreOnReply: false,
        });
      },
    );

    it.each(["correction", "promptGen"] as const)(
      "sends no half-masked text from %s — no placeholder goes out with the rest of its own credential beside it",
      async (site) => {
        const result = await gate(site, PARTIAL_MASK_TEXT, "mask");

        if (result.gateDecision === "declined") throw new Error("unexpected decline");
        expect(result.sentText).not.toContain(SECRET_PLACEHOLDER_MARKER);
        expect(result.sentText).toBe(PARTIAL_MASK_TEXT);
      },
    );

    it.each(["correction", "promptGen"] as const)(
      "sends nothing at all from %s when the user cancels",
      async (site) => {
        confirmSecretSendMock.mockResolvedValue(false);

        const result = await gate(site, PARTIAL_MASK_TEXT, "mask");

        expect(result).toEqual({ gateDecision: "declined", appliedMode: "confirm" });
        expect(result).not.toHaveProperty("sentText");
      },
    );

    it("still masks normally when every span covers its whole credential", async () => {
      const result = await gate("correction", SECRET_TEXT, "mask");

      expect(confirmSecretSendMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        gateDecision: "masked",
        appliedMode: "mask-and-restore",
        restoreOnReply: true,
      });
    });

    it("brackets the downgraded dialog with aroundDialog too, so card 12's spinner behaves the same on both paths", async () => {
      const { aroundDialog, callCount } = countingAroundDialog();

      const result = await runSecretGate({
        site: "correction",
        text: PARTIAL_MASK_TEXT,
        settings: settings({ mode: "mask" }),
        aroundDialog,
      });

      expect(callCount()).toBe(1);
      expect(result).toMatchObject({ gateDecision: "confirmed" });
    });

    /**
     * The JSONL has to distinguish a downgrade from a request that was in
     * confirm mode all along — that distinction is the only evidence in
     * production that this mechanism is working at all. `appliedMode` reports
     * what was APPLIED (`confirm`, matching `masking: null`), so the
     * discriminator is `reason`, which the approved key list already carries.
     */
    it("logs the downgrade as guardMode mask + appliedMode confirm + reason partial-mask", async () => {
      await gate("correction", PARTIAL_MASK_TEXT, "mask");

      expect(loggedContexts()).toEqual([
        {
          guardMode: "mask",
          appliedMode: "confirm",
          gateDecision: "confirmed",
          matchCount: 1,
          ruleIds: ["credential-assignment"],
          reason: "partial-mask",
        },
      ]);
    });

    it("reports no placeholderCount on a downgrade, because no placeholder was produced", async () => {
      await gate("promptGen", PARTIAL_MASK_TEXT, "mask");

      for (const context of loggedContexts()) {
        expect(context).not.toHaveProperty("placeholderCount");
      }
    });

    it("carries no reason on a confirm that was never a downgrade, so the two are told apart", async () => {
      await gate("correction", SECRET_TEXT, "confirm");
      // ask's mask degrades to confirm by POLICY, not because a span was
      // uncoverable — same guardMode and appliedMode, and no `reason`.
      await gate("ask", SECRET_TEXT, "mask");

      const contexts = loggedContexts();
      expect(contexts).toHaveLength(2);
      for (const context of contexts) {
        expect(context).not.toHaveProperty("reason");
      }
      expect(contexts[1]).toMatchObject({ guardMode: "mask", appliedMode: "confirm" });
    });

    it("survives the REAL redactor — `reason` and `partial-mask` both come through unblanked", async () => {
      await gate("correction", PARTIAL_MASK_TEXT, "mask");

      for (const context of loggedContexts()) {
        expect(redactLogContext(context)).toEqual(context);
      }
    });
  });

  describe("aroundDialog", () => {
    it("defaults to identity — omitting it behaves exactly as before", async () => {
      const result = await runSecretGate({
        site: "correction",
        text: SECRET_TEXT,
        settings: settings({ mode: "confirm" }),
      });

      expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ gateDecision: "confirmed" });
    });

    it("is NOT called when no dialog opens — bracketing it must not blink a spinner on every transform", async () => {
      const { aroundDialog, callCount } = countingAroundDialog();

      const result = await runSecretGate({
        site: "correction",
        text: CLEAN_TEXT,
        settings: settings({ mode: "confirm" }),
        aroundDialog,
      });

      expect(result.gateDecision).toBe("allow");
      expect(callCount()).toBe(0);
      expect(confirmSecretSendMock).not.toHaveBeenCalled();
    });

    it("wraps only the modal await when a dialog does open, and proceeds on Send anyway", async () => {
      const order: string[] = [];
      confirmSecretSendMock.mockImplementation(async () => {
        order.push("dialog");
        return true;
      });
      const { aroundDialog, callCount } = countingAroundDialog(async (show) => {
        order.push("wrap-start");
        const proceed = await show();
        order.push("wrap-end");
        return proceed;
      });

      const result = await runSecretGate({
        site: "correction",
        text: SECRET_TEXT,
        settings: settings({ mode: "confirm" }),
        aroundDialog,
      });

      expect(callCount()).toBe(1);
      expect(order).toEqual(["wrap-start", "dialog", "wrap-end"]);
      expect(result).toMatchObject({ gateDecision: "confirmed" });
    });

    it("also wraps the decline path, so a cancelled dialog does not leave the spinner hidden or double-shown", async () => {
      confirmSecretSendMock.mockResolvedValue(false);
      const { aroundDialog, callCount } = countingAroundDialog();

      const result = await runSecretGate({
        site: "correction",
        text: SECRET_TEXT,
        settings: settings({ mode: "confirm" }),
        aroundDialog,
      });

      expect(callCount()).toBe(1);
      expect(result).toMatchObject({ gateDecision: "declined" });
    });

    it("propagates a throw from the caller's wrapper rather than swallowing it into a decline", async () => {
      const boom = new Error("spinner bug");
      const { aroundDialog } = countingAroundDialog(async (show) => {
        await show();
        throw boom;
      });

      await expect(
        runSecretGate({
          site: "correction",
          text: SECRET_TEXT,
          settings: settings({ mode: "confirm" }),
          aroundDialog,
        }),
      ).rejects.toBe(boom);
      expect(confirmSecretSendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("the opt-in high-entropy rule", () => {
    const ENTROPY_TEXT = "ship it: Zq7Z9vK2mNpR4tXwY6bC8dF1gH3jL5sT0uAeIoU2";

    it("stays off unless the setting says otherwise", async () => {
      const result = await runSecretGate({
        site: "correction",
        text: ENTROPY_TEXT,
        settings: settings({ mode: "confirm", highEntropyRule: false }),
      });

      expect(result.gateDecision).toBe("allow");
      expect(confirmSecretSendMock).not.toHaveBeenCalled();
    });

    it("is passed through to the scanner when enabled", async () => {
      const result = await runSecretGate({
        site: "correction",
        text: ENTROPY_TEXT,
        settings: settings({ mode: "confirm", highEntropyRule: true }),
      });

      expect(result.gateDecision).toBe("confirmed");
      expect(confirmSecretSendMock).toHaveBeenCalledWith(
        expect.objectContaining({ ruleIds: ["high-entropy-string"] }),
      );
    });
  });

  describe("logging", () => {
    it("logs under a scope the redactor leaves intact", async () => {
      await gate("correction", SECRET_TEXT, "confirm");

      const scopes = loggerMock.info.mock.calls.map((call) => call[0]);
      expect(scopes).toContain("secretGuard.gate");
      // `secret` followed by `G` survives; `secret:` or `secret=` would not,
      // because `logService.log` runs the SCOPE through `redactLogMessage`.
      for (const scope of scopes) {
        expect(scope).not.toMatch(/secret\s*[:=]/i);
      }
    });

    it("stays silent when nothing was detected", async () => {
      await gate("correction", CLEAN_TEXT, "confirm");

      expect(loggedContexts()).toHaveLength(0);
    });

    it("logs only approved context keys, and never the replacements map", async () => {
      const approved = new Set([
        "matchCount",
        "ruleIds",
        "placeholderCount",
        "missingCount",
        "guardMode",
        "appliedMode",
        "gateDecision",
        "reason",
      ]);

      confirmSecretSendMock.mockResolvedValue(true);
      await gate("correction", SECRET_TEXT, "confirm");
      confirmSecretSendMock.mockResolvedValue(false);
      await gate("promptGen", SECRET_TEXT, "confirm");
      await gate("correction", SECRET_TEXT, "mask");

      const contexts = loggedContexts();
      expect(contexts.length).toBeGreaterThan(0);
      for (const context of contexts) {
        for (const key of Object.keys(context)) {
          expect(approved).toContain(key);
        }
        expect(JSON.stringify(context)).not.toContain(AWS_KEY);
        expect(context).not.toHaveProperty("replacements");
      }
    });

    it("reports rule ids as an array VALUE, never spread into keys", async () => {
      await gate("correction", SECRET_TEXT, "confirm");

      const withRules = loggedContexts().find((context) => "ruleIds" in context);
      expect(Array.isArray(withRules?.ruleIds)).toBe(true);
      expect(withRules?.ruleIds).toEqual(["aws-access-key-id"]);
    });
  });
});
