/**
 * @file secretGate.ts
 * @description The secret guard's single decision point, shared by every send
 * site that has one.
 *
 * {@link SECRET_SEND_SITE_POLICY} is the ONE table, and it lives here so all
 * three behaviours are readable together rather than scattered across the
 * handlers. Call sites read it through {@link runSecretGate}; none of them
 * re-derives policy.
 *
 *   correction — the only path that pastes over a selection in another app, so
 *                it is the only one that both masks and restores.
 *   promptGen  — its output is a generated prompt, never a rewrite, and it
 *                never pastes: a prompt containing placeholders is the correct
 *                artifact, so masking here does not restore.
 *   ask        — a free-form answer rarely echoes placeholders back, so a
 *                restore would fail on most requests and permanently divert Ask
 *                to the popup. Masking therefore degrades to a confirm.
 *
 * Autocomplete is deliberately absent: it fires per keystroke, where a modal is
 * categorically impossible.
 *
 * A masking mode does not always mask. `detectSecrets` reports a span it cannot
 * prove covers the WHOLE credential as `maskable: false`, which `maskSecrets`
 * rolls up as `fullyMaskable: false`; masking such a span would send the
 * uncovered remainder beside the placeholder, under a settings panel that says
 * masking means nothing leaves the machine. Consuming that flag is this file's
 * job — the detector deliberately reports the match rather than dropping it so
 * that the gate can ASK — and the downgrade happens HERE rather than at the
 * three call sites, or each of them re-derives the policy the one table exists
 * to centralize.
 *
 * The downgrade is TOTAL for the request, not scoped to the offending span.
 * `fullyMaskable` is one boolean over the whole scan, so a single uncoverable
 * span sends the request down the confirm path and the masking computed above
 * is dropped entirely — including placeholders for spans that WERE fully
 * maskable. On Send anyway, every credential in that selection goes out
 * verbatim, not just the one that triggered the downgrade. That is deliberate:
 * a half-masked send is the exact failure this branch exists to prevent, and
 * `sentText` must be either wholly masked or wholly the user's own text so a
 * reply-side restore has one shape to handle. The dialog names every rule that
 * matched, so what the user consents to is the whole set — but the copy in
 * Settings is what has to SAY so, because the dialog itself cannot show which
 * span was the uncoverable one.
 *
 * The downgrade belongs to the MASK, not to the site: `mask-and-restore` and
 * `mask-no-restore` take it through the same path. promptGen's missing restore
 * makes its downgrade MORE worth asking about, not less — a confirmed send
 * there leaves the credential verbatim in a generated prompt the user keeps —
 * but "mask part of it anyway" is not a button this dialog has, and answering
 * it differently per site would put a second policy decision outside the table.
 *
 * Nothing here may log a credential. `SecretMasking.replacements` holds REAL
 * SECRETS as map values, and the log-key audit only defends key NAMES — so the
 * masking object never appears in a log context, whole or in part. Only counts,
 * rule ids and mode names are logged.
 */
import { scanForSecrets } from "~/features/secretGuard/shared/detectSecrets";
import { maskSecrets } from "~/features/secretGuard/shared/maskSecrets";
import { logger } from "~/main/logging/logService";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import type { SecretMasking } from "~/features/secretGuard/shared/maskSecrets";
import type {
  SecretGuardMode,
  SecretGuardSettings,
} from "~/features/secretGuard/shared/secretGuardSettings";
import type { SecretRuleId } from "~/features/secretGuard/shared/secretRules";

export type SecretSendSite = "correction" | "promptGen" | "ask";

/** What a stored mode actually DOES once a site's own constraints are applied. */
export type SecretGuardAppliedMode = "off" | "confirm" | "mask-and-restore" | "mask-no-restore";

type SiteModePolicy = Readonly<
  Record<SecretSendSite, Readonly<Record<SecretGuardMode, SecretGuardAppliedMode>>>
>;

/**
 * `Readonly` alone only stops a mutation from compiling; a call site that
 * writes to it anyway (e.g. `SECRET_SEND_SITE_POLICY.ask.mask = "..."`) is
 * still a plain assignment at runtime, and `secretGate.test.ts` runs this
 * module in isolation, so no test in the suite would ever see it happen.
 * Freezing both levels turns that same write into a thrown TypeError instead.
 */
const freezeSitePolicy = (policy: SiteModePolicy): SiteModePolicy => {
  for (const modeTable of Object.values(policy)) Object.freeze(modeTable);
  return Object.freeze(policy);
};

/** The one table. Do not re-derive any part of it at a call site. */
export const SECRET_SEND_SITE_POLICY: SiteModePolicy = freezeSitePolicy({
  correction: { off: "off", confirm: "confirm", mask: "mask-and-restore" },
  promptGen: { off: "off", confirm: "confirm", mask: "mask-no-restore" },
  ask: { off: "off", confirm: "confirm", mask: "confirm" },
});

export type SecretGateResult =
  | {
      gateDecision: "allow" | "confirmed" | "masked";
      appliedMode: SecretGuardAppliedMode;
      /** What to send. Identical to the input unless something was masked. */
      sentText: string;
      /**
       * Present whenever the applied mode masks, even with zero matches, so the
       * reply path has ONE branch: an empty masking restores cleanly and needs
       * no special case.
       */
      masking: SecretMasking | null;
      restoreOnReply: boolean;
    }
  | { gateDecision: "declined"; appliedMode: SecretGuardAppliedMode };

export type SecretGateInput = {
  site: SecretSendSite;
  text: string;
  settings: SecretGuardSettings;
  /** Injected in tests, the same way `latencyTimer` injects `now`. */
  salt?: () => string;
  /**
   * Wraps ONLY the confirmation modal await — never the whole gate — so a
   * caller holding an overlay spinner can hide it for exactly the dialog's
   * lifetime instead of blinking it on every transform, including the vast
   * majority in `confirm` mode where nothing is detected and no dialog opens
   * at all. Defaults to identity, so existing callers are unaffected and a
   * throw inside the supplied wrapper propagates rather than being swallowed
   * into a silent decline.
   */
  aroundDialog?: <T>(show: () => Promise<T>) => Promise<T>;
};

const LOG_SCOPE = "secretGuard.gate";

/**
 * Why a request that was NOT stored as `confirm` is being confirmed anyway.
 *
 * Present only on a downgrade, absent otherwise, because a reader of the JSONL
 * has to tell a downgraded mask apart from a request that was in confirm mode
 * all along — and from `ask`, whose mask degrades to confirm by policy with the
 * same `guardMode`/`appliedMode` pair. `reason` is on the approved key list;
 * inventing a key here would risk the substring redactor silently blanking it.
 */
type SecretGateReason = "partial-mask";

const allow = (text: string, appliedMode: SecretGuardAppliedMode): SecretGateResult => ({
  gateDecision: "allow",
  appliedMode,
  sentText: text,
  masking: null,
  restoreOnReply: false,
});

type ConfirmSendInput = {
  site: SecretSendSite;
  text: string;
  guardMode: SecretGuardMode;
  ruleIds: readonly SecretRuleId[];
  matchCount: number;
  aroundDialog: NonNullable<SecretGateInput["aroundDialog"]>;
  reason?: SecretGateReason;
};

/**
 * The one confirm path, shared by the stored `confirm` mode and by a mask that
 * downgraded into it.
 *
 * `appliedMode` is `confirm` on both, because it reports what was APPLIED and
 * nothing was masked — which keeps the invariant a call site relies on:
 * `appliedMode === "confirm"` means `masking` is null and there is nothing to
 * restore. Reporting the site's masking mode here instead would describe a
 * result that does not exist. `gateDecision` stays the two outcomes a dialog
 * has; a third value would make every consumer's switch grow a case that
 * behaves exactly like `confirmed`.
 */
const confirmSend = async ({
  site,
  text,
  guardMode,
  ruleIds,
  matchCount,
  aroundDialog,
  reason,
}: ConfirmSendInput): Promise<SecretGateResult> => {
  const proceed = await aroundDialog(() => confirmSecretSend({ ruleIds, matchCount }));
  const gateDecision = proceed ? "confirmed" : "declined";

  logger.info(LOG_SCOPE, `Secret guard gate at ${site}`, {
    guardMode,
    appliedMode: "confirm",
    gateDecision,
    matchCount,
    ruleIds: [...ruleIds],
    ...(reason === undefined ? {} : { reason }),
  });

  return proceed
    ? {
        gateDecision: "confirmed",
        appliedMode: "confirm",
        sentText: text,
        masking: null,
        restoreOnReply: false,
      }
    : { gateDecision: "declined", appliedMode: "confirm" };
};

export const runSecretGate = async ({
  site,
  text,
  settings,
  salt,
  aroundDialog = (show) => show(),
}: SecretGateInput): Promise<SecretGateResult> => {
  const appliedMode = SECRET_SEND_SITE_POLICY[site][settings.mode];

  if (appliedMode === "off") {
    return allow(text, appliedMode);
  }

  if (appliedMode === "confirm") {
    const scan = scanForSecrets(text, { highEntropyRule: settings.highEntropyRule });
    if (scan.matches.length === 0) {
      return allow(text, appliedMode);
    }

    return confirmSend({
      site,
      text,
      guardMode: settings.mode,
      ruleIds: scan.ruleIds,
      matchCount: scan.matches.length,
      aroundDialog,
    });
  }

  const masking = maskSecrets(text, {
    highEntropyRule: settings.highEntropyRule,
    salt,
  });

  // `maskSecrets` already ran the scan and rolled it up through the exported
  // `isFullyMaskable`, so reading its answer keeps that decision in one place
  // and costs no second scan. An empty scan is fully maskable, so a clean
  // selection never reaches the dialog. The masking computed above is DROPPED
  // here — nothing is masked, and its `replacements` map (real secrets) goes
  // no further.
  if (!masking.fullyMaskable) {
    return confirmSend({
      site,
      text,
      guardMode: settings.mode,
      ruleIds: masking.ruleIds,
      matchCount: masking.matchCount,
      aroundDialog,
      reason: "partial-mask",
    });
  }

  const restoreOnReply = appliedMode === "mask-and-restore";

  if (masking.matchCount === 0) {
    return {
      gateDecision: "allow",
      appliedMode,
      sentText: masking.maskedText,
      masking,
      restoreOnReply,
    };
  }

  logger.info(LOG_SCOPE, `Secret guard gate at ${site}`, {
    guardMode: settings.mode,
    appliedMode,
    gateDecision: "masked",
    matchCount: masking.matchCount,
    placeholderCount: masking.placeholderCount,
    ruleIds: [...masking.ruleIds],
  });

  return {
    gateDecision: "masked",
    appliedMode,
    sentText: masking.maskedText,
    masking,
    restoreOnReply,
  };
};
