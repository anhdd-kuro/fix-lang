import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { BETA_CASK_TOKEN, STABLE_CASK_TOKEN } from "./homebrew";

/**
 * `./index` pulls in `~/main/i18n` -> `localeStore`, which constructs an
 * `electron-store` at MODULE LOAD time and throws outside a real Electron
 * `app`. Same in-memory stand-in `localeStore.test.ts` uses.
 */
vi.mock("electron-store", () => {
  class MockStore {
    get(_key: string, defaultValue?: unknown) {
      return defaultValue;
    }
    set(): void {
      // No-op: nothing here reads or writes through the store.
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
 * Collapsing this to an unconditional `STABLE_CASK_TOKEN` must fail here: on a
 * beta install `canInstall` would probe a STABLE Caskroom entry that does not
 * exist, and nothing else in the repo would catch the dead Revert button.
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
 * Expected copy is derived through the real translator rather than restated, so
 * a catalog reword cannot silently drop the config-loss warning — the only
 * place the user is told a beta can write config this stable release rejects.
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
