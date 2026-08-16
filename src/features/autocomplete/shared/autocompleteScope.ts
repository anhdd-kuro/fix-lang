/**
 * @file autocompleteScope.ts
 * @description Which apps autocomplete may read, and whether the provider it
 * would send them to has been consented to. Electron-free.
 *
 * Two modes, user's choice: `allowlist` runs nowhere until an app is named,
 * `denylist` runs everywhere except named apps. Neither is right in the
 * abstract — a local provider leaks nothing, so `denylist` costs nothing; a
 * cloud provider uploads every keystroke, so `allowlist` is the honest default.
 *
 * Secure fields (password inputs) are refused by the system-wide surface itself,
 * before any text crosses a process boundary. Nothing here can turn that off,
 * and it is not redundant in `allowlist` mode — one allowlisted browser holds
 * both a compose box and a password field.
 *
 * Bundle-id canonicalisation, its length cap, and the list cap are IMPORTED from
 * the selection guards rather than restated. Two normalizers for one identifier
 * is two answers to "does this app match the list", and the copy that used to
 * live here was the weaker one: it STRIPPED control characters where the guards'
 * rejects them, so an id carrying a U+0001 between `com.apple` and `.mail`
 * collapsed onto a listed `com.apple.mail` and inherited its permission.
 */
import {
  DEFAULT_DENIED_BUNDLE_IDS,
  MAX_DENIED_BUNDLE_IDS,
  normalizeBundleId,
} from "~/features/guards/shared/guardSettings";

export { MAX_BUNDLE_ID_LENGTH, normalizeBundleId } from "~/features/guards/shared/guardSettings";

/** `own` is FixLang's own window, never scoped. `system` reads a foreign app. */
export const AUTOCOMPLETE_SURFACE_KINDS = ["own", "system"] as const;
export type AutocompleteSurfaceKind = (typeof AUTOCOMPLETE_SURFACE_KINDS)[number];

const SURFACE_KINDS = new Set<string>(AUTOCOMPLETE_SURFACE_KINDS);

export const isAutocompleteSurfaceKind = (
  value: unknown,
): value is AutocompleteSurfaceKind => typeof value === "string" && SURFACE_KINDS.has(value);

export const AUTOCOMPLETE_SCOPE_MODES = ["allowlist", "denylist"] as const;
export type AutocompleteScopeMode = (typeof AUTOCOMPLETE_SCOPE_MODES)[number];

const SCOPE_MODES = new Set<string>(AUTOCOMPLETE_SCOPE_MODES);

export const isAutocompleteScopeMode = (value: unknown): value is AutocompleteScopeMode =>
  typeof value === "string" && SCOPE_MODES.has(value);

/** Same bound as the deny-list: both are one user-editable list of bundle ids. */
export const MAX_SCOPED_APPS = MAX_DENIED_BUNDLE_IDS;

/**
 * Seeds an absent EXCLUSION list. Editable, therefore removable — a list the
 * user can see but not change claims a control that is not there.
 *
 * Extends the send-guard deny-list rather than restating it, so an app blocked
 * from transforms cannot be silently readable by autocomplete. The additions are
 * password managers the guards list does not name plus System Settings.
 */
export const DEFAULT_EXCLUDED_BUNDLE_IDS: readonly string[] = [
  ...DEFAULT_DENIED_BUNDLE_IDS,
  "com.1password.1password7",
  "com.bitwarden.desktop",
  "com.lastpass.lastpassmacdesktop",
  "in.sinew.enpass-desktop",
  "com.dashlane.dashlanephonefinal",
  "org.keepassxc.keepassxc",
  "com.apple.systempreferences",
];

/**
 * A list that was STORED but is not a list.
 *
 * Absent is ordinary (a profile predating the feature). A present non-array is
 * corruption — a hand-edited config, a bad import — and the two must not
 * normalize to the same `[]`, because an empty EXCLUSION list under `denylist`
 * permits every app. `decideAppScope`'s own `scope-unreadable` branch cannot
 * catch this: normalization runs first and has already replaced the junk.
 */
export const isCorruptAppList = (raw: unknown): boolean =>
  raw !== undefined && !Array.isArray(raw);

const normalizeBundleIdList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const bundleId = normalizeBundleId(entry);
    if (bundleId) seen.add(bundleId);
    if (seen.size >= MAX_SCOPED_APPS) break;
  }
  return [...seen];
};

/**
 * Absent seeds NOTHING. This list is consulted only in `allowlist` mode, which
 * is the fail-closed mode: starting it populated would be starting it open.
 */
export const normalizeAllowedApps = (raw: unknown): string[] => normalizeBundleIdList(raw);

/**
 * Absent means "never stored a list" and seeds the defaults; `[]` means the user
 * cleared it and stays cleared. Collapsing the two would resurrect every default
 * the user removed on the next write.
 */
export const normalizeExcludedApps = (raw: unknown): string[] => {
  if (raw === undefined) return [...DEFAULT_EXCLUDED_BUNDLE_IDS];
  return normalizeBundleIdList(raw);
};

export type AutocompleteScopeRefusal =
  | "app-unidentified"
  | "app-not-allowed"
  | "app-excluded"
  | "scope-unreadable";

export type AutocompleteScopeDecision =
  | { permitted: true }
  | { permitted: false; reason: AutocompleteScopeRefusal };

const PERMITTED: AutocompleteScopeDecision = { permitted: true };

export const decideAppScope = (input: {
  surface: AutocompleteSurfaceKind;
  bundleId: string | null;
  scopeMode: AutocompleteScopeMode;
  /** Typed, but sourced from a JSON store — see the `Array.isArray` guards below. */
  allowedApps: readonly string[];
  excludedApps: readonly string[];
}): AutocompleteScopeDecision => {
  if (input.surface === "own") return PERMITTED;

  // "I don't know which app this came from" does not read as "anywhere is fine".
  const bundleId = normalizeBundleId(input.bundleId);
  if (!bundleId) return { permitted: false, reason: "app-unidentified" };

  // Refuses rather than falling back to `[]`, which is closed for the allow-list
  // but wide open for the exclusions. Also keeps a malformed store from
  // throwing: this runs behind an `ipcMain.handle` that must never reject.
  if (!Array.isArray(input.allowedApps) || !Array.isArray(input.excludedApps)) {
    return { permitted: false, reason: "scope-unreadable" };
  }

  // Exclusions bite in BOTH modes. A password manager must not become readable
  // because the user allow-listed it, and `allowlist` is the DEFAULT mode — so
  // an exclusion that only applied to `denylist` would be off by default.
  if (input.excludedApps.includes(bundleId)) {
    return { permitted: false, reason: "app-excluded" };
  }

  if (input.scopeMode === "allowlist") {
    return input.allowedApps.includes(bundleId)
      ? PERMITTED
      : { permitted: false, reason: "app-not-allowed" };
  }
  return PERMITTED;
};

/** Unresolvable providers get the cautious default: a bare id is rarely local. */
export const defaultScopeModeForProvider = (
  isLocalProvider: boolean,
): AutocompleteScopeMode => (isLocalProvider ? "denylist" : "allowlist");

/**
 * Independent of `scopeMode` on purpose. Scope decides which apps are read;
 * consent decides who receives them. Naming Mail while on Ollama says nothing
 * about OpenAI, so exempting `allowlist` mode would let a later model change
 * begin uploading Mail silently.
 *
 * Consent is stored as a provider id rather than a boolean so that changing
 * provider re-gates by construction. A null provider can never match one.
 *
 * `destinationIsLoopback`, NOT "is this a local provider". Ollama and LM Studio
 * take a configurable host and the sanitizer accepts any hostname, so provider
 * identity does not say where the bytes go — a "local" provider pointed at a LAN
 * or public host is a remote destination and must be gated like one. The caller
 * resolves this from the configured endpoint via `isLoopbackHost`.
 */
export const requiresCloudScopeConsent = (input: {
  surface: AutocompleteSurfaceKind;
  destinationIsLoopback: boolean;
  providerId: string | null;
  cloudScopeConsent: string;
}): boolean => {
  if (input.surface === "own") return false;
  if (input.destinationIsLoopback) return false;
  return input.providerId === null || input.cloudScopeConsent !== input.providerId;
};
