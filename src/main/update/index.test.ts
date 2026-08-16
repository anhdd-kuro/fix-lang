import { describe, expect, it, vi } from "vitest";
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

const { chooseBoundCaskToken } = await import("./index");

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
