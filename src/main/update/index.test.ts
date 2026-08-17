import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { BETA_CASK_TOKEN, STABLE_CASK_TOKEN } from "./homebrew";

/**
 * `./index` pulls in `~/main/i18n` -> `~/features/i18n/store/localeStore`,
 * which constructs an `electron-store` `Store` at MODULE LOAD time
 * (`Please specify the projectName option` outside a real Electron `app`).
 * Same replacement `localeStore.test.ts` uses — an in-memory stand-in, never
 * touched by these tests since `chooseBoundCaskToken` never calls `mainT`.
 */
vi.mock("electron-store", () => {
  class MockStore {
    get(_key: string, defaultValue?: unknown) {
      return defaultValue;
    }
    set(): void {
      // No-op: chooseBoundCaskToken never reads or writes through the store.
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});

const { buildPrereleaseConfirmDetail, chooseBoundCaskToken } = await import(
  "./index"
);

/**
 * Pins the ONE line `initializeUpdateService` uses to bind its Homebrew
 * upgrader — see index.ts:127 / `chooseBoundCaskToken`'s doc comment.
 *
 * Collapsing this back to an unconditional `STABLE_CASK_TOKEN` (the
 * pre-fix line f8 exists to remove) must fail this file: on a beta
 * install, `createHomebrewUpgrader`'s `canInstall` probes the STABLE
 * Caskroom entry, which does not exist, so every beta user gets a live
 * Revert button that fails every time with no CI signal anywhere else in
 * the repo.
 */
describe("chooseBoundCaskToken", () => {
  it("binds the BETA token when the active Caskroom channel is beta", () => {
    expect(chooseBoundCaskToken("beta")).toBe(BETA_CASK_TOKEN);
  });

  it("binds the STABLE token when the active Caskroom channel is stable", () => {
    expect(chooseBoundCaskToken("stable")).toBe(STABLE_CASK_TOKEN);
  });

  it("binds the STABLE token when both channels are installed (stable default)", () => {
    expect(chooseBoundCaskToken("both")).toBe(STABLE_CASK_TOKEN);
  });

  it("binds the STABLE token when the active channel is undetectable (null)", () => {
    expect(chooseBoundCaskToken(null)).toBe(STABLE_CASK_TOKEN);
  });
});

/**
 * The switch confirm is the ONE place the user consents to running a beta, and
 * the risk it has to state is not the quit/download/reopen mechanics: both
 * channels share one `userData`, `apiStore` runs `clearInvalidConfig: true`
 * (see its own comment: one value failing schema validation "wipes the ENTIRE
 * config — every profile, preset, and key reference"), and migrations are
 * forward-only behind a `configVersion` gate. So a beta writing a value this
 * stable release rejects can cost the whole configuration on the way back, and
 * reverting does not undo it.
 *
 * Expected copy is derived through the real translator rather than restated,
 * so a catalog reword cannot silently drop the warning.
 */
describe("buildPrereleaseConfirmDetail", () => {
  const tEn = createTranslator("en");
  const tJa = createTranslator("ja");

  it("states the config risk alongside the mechanics, in English", () => {
    const detail = buildPrereleaseConfirmDetail(tEn);

    expect(detail).toContain(
      tEn("settings.updates.prerelease.confirm.detail"),
    );
    expect(detail).toContain(
      tEn("settings.updates.prerelease.confirm.configWarning"),
    );
  });

  it("states the config risk in Japanese, translated rather than copied", () => {
    const detail = buildPrereleaseConfirmDetail(tJa);
    const warningJa = tJa("settings.updates.prerelease.confirm.configWarning");

    expect(detail).toContain(tJa("settings.updates.prerelease.confirm.detail"));
    expect(detail).toContain(warningJa);
    // An English fallback would make these identical.
    expect(warningJa).not.toBe(
      tEn("settings.updates.prerelease.confirm.configWarning"),
    );
  });
});
