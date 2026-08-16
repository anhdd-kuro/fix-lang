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
 */

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

/** Over-length ids are dropped, not truncated — a truncation still prefix-matches. */
export const MAX_BUNDLE_ID_LENGTH = 128;
export const MAX_SCOPED_APPS = 200;

/**
 * Lower-cased because macOS bundle ids are case-insensitive, so a list entry
 * that failed to match on a capital would be a guard that silently does nothing.
 * Control characters are stripped for the reason `parseActiveApp` strips them
 * from the same source: another process's self-reported identity, bound for a
 * log line.
 */
export const normalizeBundleId = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
  const stripped = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim();
  if (!stripped || stripped.length > MAX_BUNDLE_ID_LENGTH) return null;
  return stripped.toLowerCase();
};

/**
 * Seeds an absent list. Not enforced by the gate — these are editable, and
 * editable means removable; a list the user can see but not change claims a
 * control that is not there.
 */
export const DEFAULT_EXCLUDED_BUNDLE_IDS: readonly string[] = [
  "com.1password.1password",
  "com.1password.1password7",
  "com.agilebits.onepassword7",
  "com.apple.keychainaccess",
  "com.bitwarden.desktop",
  "com.lastpass.lastpassmacdesktop",
  "in.sinew.enpass-desktop",
  "com.dashlane.dashlanephonefinal",
  "org.keepassxc.keepassxc",
  "com.apple.systempreferences",
];

/**
 * Absent means "never stored a list" and seeds the defaults; `[]` means the user
 * cleared it and stays cleared. Collapsing the two would resurrect every default
 * the user removed on the next write.
 */
export const normalizeScopedApps = (raw: unknown): string[] => {
  if (raw === undefined) return [...DEFAULT_EXCLUDED_BUNDLE_IDS];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const bundleId = normalizeBundleId(entry);
    if (bundleId) seen.add(bundleId);
    if (seen.size >= MAX_SCOPED_APPS) break;
  }
  return [...seen];
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
  /** Typed, but sourced from a JSON store — see the `Array.isArray` guard below. */
  scopedApps: readonly string[];
}): AutocompleteScopeDecision => {
  if (input.surface === "own") return PERMITTED;

  // "I don't know which app this came from" does not read as "anywhere is fine".
  const bundleId = normalizeBundleId(input.bundleId);
  if (!bundleId) return { permitted: false, reason: "app-unidentified" };

  // Refuses rather than falling back to `[]`, which is closed in `allowlist`
  // mode but wide open in `denylist` mode. Also keeps a malformed store from
  // throwing: this runs behind an `ipcMain.handle` that must never reject.
  if (!Array.isArray(input.scopedApps)) {
    return { permitted: false, reason: "scope-unreadable" };
  }

  const listed = input.scopedApps.includes(bundleId);
  if (input.scopeMode === "allowlist") {
    return listed ? PERMITTED : { permitted: false, reason: "app-not-allowed" };
  }
  return listed ? { permitted: false, reason: "app-excluded" } : PERMITTED;
};

/** Unresolvable providers get the cautious default: a bare id is rarely local. */
export const defaultScopeModeForProvider = (
  isLocalProvider: boolean,
): AutocompleteScopeMode => (isLocalProvider ? "denylist" : "allowlist");

/**
 * Independent of `scopeMode` on purpose. Scope decides which apps are read;
 * consent decides which company receives them. Naming Mail while on Ollama says
 * nothing about OpenAI, so exempting `allowlist` mode would let a later model
 * change begin uploading Mail silently.
 *
 * Consent is stored as a provider id rather than a boolean so that changing
 * provider re-gates by construction. A null provider can never match one.
 */
export const requiresCloudScopeConsent = (input: {
  surface: AutocompleteSurfaceKind;
  isLocalProvider: boolean;
  providerId: string | null;
  cloudScopeConsent: string;
}): boolean => {
  if (input.surface === "own") return false;
  if (input.isLocalProvider) return false;
  return input.providerId === null || input.cloudScopeConsent !== input.providerId;
};
