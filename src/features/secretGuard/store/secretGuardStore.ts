/**
 * @file secretGuardStore.ts
 * @description Persists {@link SecretGuardSettings} — the secret guard's mode
 * and the opt-in high-entropy rule. Global, not per-profile: profiles are
 * importable, so a per-profile privacy guard could be switched off by
 * importing someone else's profile.
 *
 * Mirrors `~/features/guards/store/guardStore.ts`: plain `electron-store` with
 * `clearInvalidConfig: true` and, deliberately, NO ajv schema — validation
 * lives in `normalizeSecretGuardSettings`. `clearInvalidConfig` wipes the whole
 * store on one invalid value, which is exactly why this store is standalone and
 * schema-free: the wipe can only ever cost these two fields, and they come back
 * as the safe defaults. Do not add a schema here.
 */
import Store from "electron-store";
import {
  DEFAULT_SECRET_GUARD_SETTINGS,
  normalizeSecretGuardSettings,
} from "~/features/secretGuard/shared/secretGuardSettings";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

type SecretGuardSchema = {
  secretGuard: SecretGuardSettings;
};

class SecretGuardStore {
  private readonly store = new Store<SecretGuardSchema>({
    name: "secretGuard",
    defaults: { secretGuard: DEFAULT_SECRET_GUARD_SETTINGS },
    clearInvalidConfig: true,
  });

  getSecretGuardSettings(): SecretGuardSettings {
    return normalizeSecretGuardSettings(
      this.store.get("secretGuard", DEFAULT_SECRET_GUARD_SETTINGS),
    );
  }

  /** Normalizes before writing — never trusts its own caller, even though the IPC handler rejected a malformed payload first. */
  setSecretGuardSettings(settings: SecretGuardSettings): void {
    this.store.set("secretGuard", normalizeSecretGuardSettings(settings));
  }
}

export const secretGuardStore = new SecretGuardStore();
