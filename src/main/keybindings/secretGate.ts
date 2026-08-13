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
 *   combo      — same verdict as `ask`, for a stronger reason. A combo folds N
 *                presets, and only the LAST one's output is delivered, so a
 *                restore has to survive every step in between: one Summarize or
 *                Translate step drops the placeholders and the restore fails,
 *                which is `ask`'s argument multiplied by N. Worse, the fold has
 *                no single site semantics — a combo may end on a
 *                `Prompt optimization` step, whose output is a generated
 *                artifact the user keeps, and restoring a live credential into
 *                THAT is precisely what promptGen's `mask-no-restore` exists to
 *                avoid. The call site cannot tell which shape the fold produced.
 *                And `mask-no-restore` is not available here either: unlike
 *                promptGen, a combo pastes over the user's selection, so it
 *                would paste placeholders into their document. What is left is
 *                to ask — which is also the most valuable moment to ask, since
 *                a confirmed send goes to N models, not one.
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
import { isFullyMaskable, scanForSecrets } from "~/features/secretGuard/shared/detectSecrets";
import { maskSecrets, redactSecretsIrreversibly } from "~/features/secretGuard/shared/maskSecrets";
import { logger } from "~/main/logging/logService";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import type { SecretMasking } from "~/features/secretGuard/shared/maskSecrets";
import type {
  SecretGuardMode,
  SecretGuardSettings,
} from "~/features/secretGuard/shared/secretGuardSettings";
import type { SecretRuleId } from "~/features/secretGuard/shared/secretRules";

export type SecretSendSite = "correction" | "promptGen" | "ask" | "combo";

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
  combo: { off: "off", confirm: "confirm", mask: "confirm" },
});

export type SecretGateResult =
  | {
      gateDecision: "allow" | "confirmed" | "masked";
      appliedMode: SecretGuardAppliedMode;
      /** What to send. Identical to the input unless something was masked. */
      sentText: string;
      /**
       * Companion after the same decision. Identity-equal to the input
       * companion when nothing was redacted; `""` when none was passed.
       * Never contains restore placeholders — see `companionText`.
       */
      sentCompanionText: string;
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
   * Extra text that also leaves the machine but is NOT the selection — the
   * Ask-environment block on the system prompt. Scanned for the same
   * confirm/decline decision as `text`. A mask here is irreversible
   * redaction (`[redacted]`), never a restore placeholder: restore looks
   * for placeholders in the model output, and this text is not supposed to
   * be echoed.
   */
  companionText?: string;
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

const allow = (
  text: string,
  appliedMode: SecretGuardAppliedMode,
  companionText = "",
): SecretGateResult => ({
  gateDecision: "allow",
  appliedMode,
  sentText: text,
  sentCompanionText: companionText,
  masking: null,
  restoreOnReply: false,
});

const mergeRuleIds = (
  left: readonly SecretRuleId[],
  right: readonly SecretRuleId[],
): SecretRuleId[] => {
  const seen = new Set<SecretRuleId>();
  const merged: SecretRuleId[] = [];
  for (const id of [...left, ...right]) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
};

type ConfirmSendInput = {
  site: SecretSendSite;
  text: string;
  companionText: string;
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
  companionText,
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
        sentCompanionText: companionText,
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
  companionText = "",
  aroundDialog = (show) => show(),
}: SecretGateInput): Promise<SecretGateResult> => {
  const appliedMode = SECRET_SEND_SITE_POLICY[site][settings.mode];
  const scanOptions = { highEntropyRule: settings.highEntropyRule };

  if (appliedMode === "off") {
    return allow(text, appliedMode, companionText);
  }

  const companionScan = scanForSecrets(companionText, scanOptions);

  if (appliedMode === "confirm") {
    const scan = scanForSecrets(text, scanOptions);
    if (scan.matches.length === 0 && companionScan.matches.length === 0) {
      return allow(text, appliedMode, companionText);
    }

    return confirmSend({
      site,
      text,
      companionText,
      guardMode: settings.mode,
      ruleIds: mergeRuleIds(scan.ruleIds, companionScan.ruleIds),
      matchCount: scan.matches.length + companionScan.matches.length,
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
  //
  // Companion secrets use the same fully-maskable test, then irreversible
  // redaction rather than restore placeholders: a placeholder in system-prompt
  // metadata would fail restore on every reply (the model is not asked to echo
  // it) and divert the paste to the popup.
  if (!masking.fullyMaskable || !isFullyMaskable(companionScan)) {
    return confirmSend({
      site,
      text,
      companionText,
      guardMode: settings.mode,
      ruleIds: mergeRuleIds(masking.ruleIds, companionScan.ruleIds),
      matchCount: masking.matchCount + companionScan.matches.length,
      aroundDialog,
      reason: "partial-mask",
    });
  }

  const sentCompanionText =
    companionScan.matches.length === 0
      ? companionText
      : redactSecretsIrreversibly(companionText, scanOptions);

  const restoreOnReply = appliedMode === "mask-and-restore";

  // Companion-only redaction is still a mask: `summarizeSecurityStats` drops
  // `allow`, and a log that redacted metadata but claimed nothing happened
  // would let an archive of only these events read as "no guard has fired".
  // `placeholderCount` stays 0 — irreversible `[redacted]`, no restore slots.
  if (masking.matchCount === 0 && companionScan.matches.length === 0) {
    return {
      gateDecision: "allow",
      appliedMode,
      sentText: masking.maskedText,
      sentCompanionText,
      masking,
      restoreOnReply,
    };
  }

  logger.info(LOG_SCOPE, `Secret guard gate at ${site}`, {
    guardMode: settings.mode,
    appliedMode,
    gateDecision: "masked",
    matchCount: masking.matchCount + companionScan.matches.length,
    placeholderCount: masking.placeholderCount,
    ruleIds: mergeRuleIds(masking.ruleIds, companionScan.ruleIds),
  });

  return {
    gateDecision: "masked",
    appliedMode,
    sentText: masking.maskedText,
    sentCompanionText,
    masking,
    restoreOnReply,
  };
};
