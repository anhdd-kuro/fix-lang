/**
 * @file securityView.ts
 * @description PURE view-layer helpers for the Security dashboard tab.
 * Mirrors `autocompleteUsageView.ts` / `modelsView.ts`: all derivation lives
 * here, locale-free, so `SettingSecurity.tsx` only resolves descriptors through
 * `t()`/`tm()` at render time.
 *
 * Every conditional piece of copy (the age/size guard's "running" vs.
 * "disabled" hint, the deny-list's empty states, the secret guard's mask
 * hint) comes back as a `StatusDescriptor` — a `{key, params}` pair, never an
 * already-resolved string. A resolved string frozen into `useState` would
 * not update on a locale switch; see `statusDescriptor.ts`'s file doc for the
 * regression this pattern exists to prevent.
 *
 * `withDeniedBundleId`/`withoutDeniedBundleId` reuse `isBundleIdDenied` /
 * `normalizeBundleId` from `~/features/guards/shared/guardSettings` — the
 * SAME canonicalisation the main-process guard evaluates against — rather
 * than a raw `.includes()`. A chip built off `.includes()` would report a
 * denied app (e.g. `"com.Foo.Bar"` when the stored id is
 * `"com.foo.bar"`) as "not blocked" while the guard actually blocks it.
 */
import {
  isBundleIdDenied,
  normalizeBundleId,
} from "~/features/guards/shared/guardSettings";
import { plainStatus, type StatusDescriptor } from "../statusDescriptor";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type { MessageKey } from "~/features/i18n/shared/message";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

export type ClipboardAgeView = {
  maxAgeSeconds: number;
  /** `false` when `maxAgeSeconds === 0` — the guard AND the background poll are off. */
  enabled: boolean;
  hint: StatusDescriptor;
};

export type SelectionSizeView = {
  maxChars: number;
  /** `false` when `maxChars === 0` — every selection is sent without asking. */
  enabled: boolean;
  hint: StatusDescriptor;
};

export type RecentAppChip = {
  app: ActiveApp;
  /** Derived via `isBundleIdDenied`, never a raw `deniedBundleIds.includes()`. */
  blocked: boolean;
};

export type DeniedAppsView = {
  deniedBundleIds: readonly string[];
  recentApps: readonly RecentAppChip[];
  /** Non-null only when the deny-list is empty. */
  listHint: StatusDescriptor | null;
  /** Non-null only when there are no recently used apps yet. */
  recentHint: StatusDescriptor | null;
};

export type SecretGuardView = {
  mode: SecretGuardSettings["mode"];
  highEntropyRule: boolean;
  /** Non-null only in `"mask"` mode — masking suppresses the confirm dialog. */
  maskHint: StatusDescriptor | null;
};

export type SecurityView = {
  clipboardAge: ClipboardAgeView;
  selectionSize: SelectionSizeView;
  deniedApps: DeniedAppsView;
  secretGuard: SecretGuardView;
};

const resolveClipboardAgeView = (
  settings: SelectionGuardSettings,
): ClipboardAgeView => ({
  maxAgeSeconds: settings.clipboardMaxAgeSeconds,
  enabled: settings.clipboardMaxAgeSeconds > 0,
  hint:
    settings.clipboardMaxAgeSeconds === 0
      ? plainStatus("security.clipboardAge.disabledHint")
      : plainStatus("security.clipboardAge.description"),
});

const resolveSelectionSizeView = (
  settings: SelectionGuardSettings,
): SelectionSizeView => ({
  maxChars: settings.maxSelectionChars,
  enabled: settings.maxSelectionChars > 0,
  hint:
    settings.maxSelectionChars === 0
      ? plainStatus("security.selectionSize.disabledHint")
      : plainStatus("security.selectionSize.description"),
});

const resolveDeniedAppsView = (
  settings: SelectionGuardSettings,
  recentApps: readonly ActiveApp[],
): DeniedAppsView => ({
  deniedBundleIds: settings.deniedBundleIds,
  recentApps: recentApps.map((app) => ({
    app,
    blocked: isBundleIdDenied(app.bundleId, settings.deniedBundleIds),
  })),
  listHint:
    settings.deniedBundleIds.length === 0
      ? plainStatus("security.deniedApps.empty")
      : null,
  recentHint:
    recentApps.length === 0 ? plainStatus("security.deniedApps.recentEmpty") : null,
});

const resolveSecretGuardView = (
  settings: SecretGuardSettings,
): SecretGuardView => ({
  mode: settings.mode,
  highEntropyRule: settings.highEntropyRule,
  maskHint:
    settings.mode === "mask" ? plainStatus("security.secretGuard.maskHint") : null,
});

/**
 * The "What this can and can't do" points, in the order they are shown.
 *
 * One key per claim, rather than one paragraph holding all five: the panel
 * renders them as a list, and a reader who skips the block entirely should
 * still be able to see how many separate limitations there are. The ORDER is
 * meaning-bearing — what the check is (a pattern match), then the surprising
 * mask behaviour, then its scope, then that it cannot be undone, then the one
 * path that cannot ask at all — so it lives here beside the rest of the
 * derivation instead of being re-listed at each call site.
 */
export const SECRET_GUARD_LIMITATION_KEYS: readonly MessageKey[] = [
  "security.secretGuard.limitations.patternCheck",
  "security.secretGuard.limitations.partialMask",
  "security.secretGuard.limitations.scope",
  "security.secretGuard.limitations.noUndo",
  "security.secretGuard.limitations.autocomplete",
];

/** Assembles the full pure view from the two loaded settings objects plus the recent-apps MRU. */
export const resolveSecurityView = (
  guardSettings: SelectionGuardSettings,
  secretGuardSettings: SecretGuardSettings,
  recentApps: readonly ActiveApp[],
): SecurityView => ({
  clipboardAge: resolveClipboardAgeView(guardSettings),
  selectionSize: resolveSelectionSizeView(guardSettings),
  deniedApps: resolveDeniedAppsView(guardSettings, recentApps),
  secretGuard: resolveSecretGuardView(secretGuardSettings),
});

/**
 * Adds a bundle id to the deny-list, immutably. A no-op (returns the SAME
 * settings reference) for an invalid id or one already denied — the latter
 * checked via `isBundleIdDenied` rather than a raw membership test, for the
 * same reason `resolveDeniedAppsView` above uses it.
 */
export const withDeniedBundleId = (
  settings: SelectionGuardSettings,
  rawBundleId: string,
): SelectionGuardSettings => {
  const normalized = normalizeBundleId(rawBundleId);
  if (normalized === null || isBundleIdDenied(normalized, settings.deniedBundleIds)) {
    return settings;
  }
  return {
    ...settings,
    deniedBundleIds: [...settings.deniedBundleIds, normalized],
  };
};

/**
 * Adds several bundle ids in one immutable step — the shape a file-dialog
 * multi-selection or a multi-file drop arrives in. Folds `withDeniedBundleId`,
 * so duplicates, non-canonical casing and invalid entries are handled by the
 * same single rule, and returns the SAME settings reference when nothing was
 * added (every id was invalid or already denied), which is what lets the
 * caller skip a pointless store write.
 */
export const withDeniedBundleIds = (
  settings: SelectionGuardSettings,
  rawBundleIds: readonly string[],
): SelectionGuardSettings =>
  rawBundleIds.reduce<SelectionGuardSettings>(
    (current, rawBundleId) => withDeniedBundleId(current, rawBundleId),
    settings,
  );

/**
 * Removes a bundle id from the deny-list, immutably. A no-op when the id is
 * invalid or not present.
 */
export const withoutDeniedBundleId = (
  settings: SelectionGuardSettings,
  rawBundleId: string,
): SelectionGuardSettings => {
  const normalized = normalizeBundleId(rawBundleId);
  if (normalized === null) return settings;
  return {
    ...settings,
    deniedBundleIds: settings.deniedBundleIds.filter(
      (denied) => normalizeBundleId(denied) !== normalized,
    ),
  };
};
