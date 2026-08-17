import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BETA_CASK_TOKEN,
  isCaskToken,
  STABLE_CASK_TOKEN as HOMEBREW_STABLE_CASK_TOKEN,
} from "./homebrew";
import {
  createPendingInstallStore,
  parsePendingInstall,
  reconcilePendingInstall,
  STABLE_CASK_TOKEN,
  UPGRADE_GRACE_MS,
  type CaskToken,
  type PendingInstall,
  type ReconcileContext,
} from "./pendingInstall";

const temporaryDirectories: string[] = [];

const markerPath = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "fixlang-update-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "pending-update.json");
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

describe("pending install marker", () => {
  it("round-trips the recorded versions", () => {
    const store = createPendingInstallStore(markerPath());

    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
    });

    expect(store.read()).toEqual({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
    });
  });

  it("round-trips a pre-release cask token", () => {
    const store = createPendingInstallStore(markerPath());

    store.write({
      fromVersion: "1.9.5",
      toVersion: "2.0.0-beta.1",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang@beta",
    });

    expect(store.read()?.caskToken).toBe("fixlang@beta");
  });

  it("reads nothing when no update is pending", () => {
    expect(createPendingInstallStore(markerPath()).read()).toBeNull();
  });

  it("clears the marker without failing on a missing file", () => {
    const store = createPendingInstallStore(markerPath());
    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
    });

    store.clear();
    store.clear();

    expect(store.read()).toBeNull();
  });

  it("ignores a corrupt marker instead of breaking startup", () => {
    const filePath = markerPath();
    const store = createPendingInstallStore(filePath);
    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
    });
    writeFileSync(filePath, "{ not json", "utf8");

    expect(store.read()).toBeNull();
  });

  it("writes a single trailing newline", () => {
    const filePath = markerPath();
    createPendingInstallStore(filePath).write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
    });

    expect(readFileSync(filePath, "utf8").endsWith("}\n")).toBe(true);
  });

  it.each([
    "null",
    "[]",
    '"0.3.3"',
    '{"fromVersion":"0.3.2"}',
    '{"fromVersion":"","toVersion":"0.3.3"}',
    '{"fromVersion":"0.3.2","toVersion":3}',
  ])("rejects malformed marker content: %s", (raw) => {
    expect(parsePendingInstall(raw)).toBeNull();
  });

  it("defaults a marker written before the cask token field existed to the stable token", () => {
    // Real markers on disk today have no caskToken key at all.
    const legacyRaw = JSON.stringify({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });

    // Asserted against the imported constant, never a re-spelled literal:
    // the migration default has to BE homebrew's stable token, and a literal
    // here would keep passing after that token moved on.
    expect(parsePendingInstall(legacyRaw)?.caskToken).toBe(
      HOMEBREW_STABLE_CASK_TOKEN,
    );
  });

  /**
   * REGRESSION: `STABLE_CASK_TOKEN` used to be re-declared here with the
   * literal spelled a second time. A `: CaskToken` annotation catches an
   * outright rename, but not the dangerous shape — adding a channel token
   * while `"fixlang"` stays in `KNOWN_CASK_TOKENS` for legacy markers, so
   * `homebrew.ts` moves its stable token forward while this module's
   * MIGRATION DEFAULT still points at the legacy string, with no type error
   * and no test failure. Mocking that move is the only way to see it.
   */
  it("takes its stable token from homebrew rather than re-spelling the literal", async () => {
    const movedStableToken = "fixlang@moved";
    vi.resetModules();
    vi.doMock("./homebrew", () => ({
      STABLE_CASK_TOKEN: movedStableToken,
      BETA_CASK_TOKEN,
      isCaskToken: (value: string): boolean =>
        value === movedStableToken || value === BETA_CASK_TOKEN,
    }));

    try {
      const freshModule = await import("./pendingInstall");

      expect(freshModule.STABLE_CASK_TOKEN).toBe(movedStableToken);
      expect(
        freshModule.parsePendingInstall(
          JSON.stringify({ fromVersion: "0.3.2", toVersion: "0.3.3" }),
        )?.caskToken,
      ).toBe(movedStableToken);
    } finally {
      vi.doUnmock("./homebrew");
      vi.resetModules();
    }
  });

  it("re-exports the same stable token constant homebrew declares", () => {
    expect(STABLE_CASK_TOKEN).toBe(HOMEBREW_STABLE_CASK_TOKEN);
  });

  it("round-trips the source cask token a channel switch started from", () => {
    const store = createPendingInstallStore(markerPath());

    store.write({
      fromVersion: "2.0.0-beta.3",
      toVersion: "1.9.5",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
      caskToken: "fixlang",
      fromCaskToken: "fixlang@beta",
    });

    expect(store.read()?.fromCaskToken).toBe("fixlang@beta");
  });

  it.each([undefined, "FIXLANG", "", 42, null, {}])(
    "leaves the source cask token absent rather than guessing when it is unusable: %s",
    (fromCaskToken) => {
      const raw = JSON.stringify({
        fromVersion: "0.3.2",
        toVersion: "0.3.3",
        startedAt: 1_000,
        fromCaskToken,
      });

      expect(parsePendingInstall(raw)?.fromCaskToken).toBeUndefined();
    },
  );

  it.each(["FIXLANG", "fixlang@stable", "", 42, null, {}])(
    "falls back to the stable token for a corrupt cask token value: %s",
    (caskToken) => {
      const raw = JSON.stringify({
        fromVersion: "0.3.2",
        toVersion: "0.3.3",
        startedAt: 1_000,
        caskToken,
      });

      expect(parsePendingInstall(raw)?.caskToken).toBe("fixlang");
    },
  );

  /**
   * REGRESSION: `CaskToken` and its runtime allow-list used to be redeclared
   * independently here from `./homebrew`'s `KNOWN_CASK_TOKENS` — a third
   * channel token added there without a matching edit here would silently
   * coerce back to stable on read. Parsing is now driven entirely by
   * `./homebrew`'s own `isCaskToken`, so this asserts that exact equivalence
   * for a spread of tokens — known, unknown, and edge-shaped — rather than
   * re-testing only the two literals this file used to hardcode.
   */
  it.each(["fixlang", "fixlang@beta", "fixlang@nightly", "FIXLANG", ""])(
    "accepts a cask token if and only if homebrew.ts's isCaskToken accepts it: %s",
    (caskToken) => {
      const raw = JSON.stringify({
        fromVersion: "0.3.2",
        toVersion: "0.3.3",
        startedAt: 1_000,
        caskToken,
      });

      const expected = isCaskToken(caskToken) ? caskToken : "fixlang";
      expect(parsePendingInstall(raw)?.caskToken).toBe(expected);
    },
  );
});

describe("pending install reconciliation", () => {
  const STARTED_AT = 1_000_000;
  const INSTALLED_PATH = "/Applications/FixLang.app";
  const STRAY_PATH = "/Users/dev/code/fix-lang/release/mac-arm64/FixLang.app";
  const marker = {
    fromVersion: "0.3.2",
    toVersion: "0.3.3",
    startedAt: STARTED_AT,
    appPath: INSTALLED_PATH,
    caskToken: "fixlang" as const,
  };
  const context = (
    overrides: Partial<{
      now: number;
      isTargetInstalled: boolean;
      runningAppPath: string | null;
      isVersionInstalled: (version: string, caskToken: CaskToken) => boolean;
    }> = {},
  ): ReconcileContext => {
    const base = {
      now: overrides.now ?? STARTED_AT + 1_000,
      isTargetInstalled: overrides.isTargetInstalled ?? false,
      runningAppPath:
        overrides.runningAppPath === undefined
          ? INSTALLED_PATH
          : overrides.runningAppPath,
    };

    return overrides.isVersionInstalled === undefined
      ? base
      : { ...base, isVersionInstalled: overrides.isVersionInstalled };
  };

  /** A revert: beta build, stable target — and so the STABLE token, which is
   * what production writes for this direction. */
  const revertMarker: PendingInstall = {
    fromVersion: "2.0.0-beta.3",
    toVersion: "1.9.5",
    startedAt: STARTED_AT,
    appPath: INSTALLED_PATH,
    caskToken: "fixlang",
    fromCaskToken: "fixlang@beta",
  };

  /** A switch onto the pre-release channel: the opposite direction. */
  const switchMarker: PendingInstall = {
    fromVersion: "1.9.5",
    toVersion: "2.0.0-beta.1",
    startedAt: STARTED_AT,
    appPath: INSTALLED_PATH,
    caskToken: "fixlang@beta",
    fromCaskToken: "fixlang",
  };

  it("reports nothing when no update was started", () => {
    expect(reconcilePendingInstall(null, "0.3.2", context())).toBe("none");
  });

  it("reports success once the version actually changed", () => {
    expect(reconcilePendingInstall(marker, "0.3.3", context())).toBe(
      "installed",
    );
  });

  it("keeps waiting when the helper is still inside the grace window", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ now: STARTED_AT + UPGRADE_GRACE_MS - 1 }),
      ),
    ).toBe("in-progress");
  });

  it("asks for a restart once Homebrew staged the new version", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ isTargetInstalled: true }),
      ),
    ).toBe("restart-required");
  });

  it("prefers the installed result over an expired grace window", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({
          now: STARTED_AT + UPGRADE_GRACE_MS * 10,
          isTargetInstalled: true,
        }),
      ),
    ).toBe("restart-required");
  });

  /**
   * The bug this guards: `open -b <bundle id>` after an upgrade can launch a
   * stray build that shares the id, and a "version changed" test then reports
   * that downgrade as a completed update.
   */
  it("refuses to call a different bundle an update, even at another version", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.2.9",
        context({ runningAppPath: STRAY_PATH }),
      ),
    ).toBe("wrong-bundle");
  });

  it("still reports wrong-bundle once Homebrew staged the target", () => {
    // A restart is the remedy either way, but only this outcome knows the
    // restart has to open another path instead of re-executing this one.
    expect(
      reconcilePendingInstall(
        marker,
        "0.2.9",
        context({ runningAppPath: STRAY_PATH, isTargetInstalled: true }),
      ),
    ).toBe("wrong-bundle");
  });

  /**
   * REGRESSION: version equality used to be tested BEFORE bundle identity, so
   * a stray bundle that happened to report the target version was announced
   * as a completed install and the path mismatch was discarded. The revert
   * direction is what makes that ordering unsafe: a revert targets a version
   * the user was running until recently, so a leftover copy at exactly that
   * version (a manual DMG install, say) is an ordinary thing to find on disk
   * — where an upgrade's target had never existed on the machine before.
   * Bundle identity is the reliable test and has to come first.
   */
  it("refuses to call a stray bundle an update even when it reports the target version", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.3",
        context({ runningAppPath: STRAY_PATH }),
      ),
    ).toBe("wrong-bundle");
  });

  it("refuses a stray bundle sitting at the version a revert targeted", () => {
    // Install and rollback both failed, /Applications is empty, and the
    // helper's `open -b` resolved a leftover copy at exactly `toVersion`.
    expect(
      reconcilePendingInstall(
        revertMarker,
        "1.9.5",
        context({ runningAppPath: STRAY_PATH }),
      ),
    ).toBe("wrong-bundle");
  });

  it("treats a version beyond the target as installed, not as a wrong bundle", () => {
    // Same bundle, upgraded past the target by hand between click and launch.
    expect(reconcilePendingInstall(marker, "0.4.0", context())).toBe(
      "installed",
    );
  });

  it.each([
    ["an unknown running path", { runningAppPath: null }],
    ["a marker written before app paths were recorded", {}],
  ])("falls back to the version test with %s", (_label, overrides) => {
    const legacyMarker =
      Object.keys(overrides).length === 0 ? { ...marker, appPath: "" } : marker;

    expect(
      reconcilePendingInstall(legacyMarker, "0.2.9", context(overrides)),
    ).toBe("installed");
  });

  it("reports failure once the grace window closes with nothing installed", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ now: STARTED_AT + UPGRADE_GRACE_MS }),
      ),
    ).toBe("failed");
  });

  it("treats a marker with no timestamp as long expired", () => {
    expect(
      reconcilePendingInstall(
        { ...marker, startedAt: 0 },
        "0.3.2",
        context({ now: UPGRADE_GRACE_MS }),
      ),
    ).toBe("failed");
  });

  it.each([undefined, -1, 1.5, "1000", Number.MAX_VALUE])(
    "reads an unusable startedAt as 0 rather than trusting it: %s",
    (startedAt) => {
      expect(
        parsePendingInstall(
          JSON.stringify({
            fromVersion: "0.3.2",
            toVersion: "0.3.3",
            startedAt,
          }),
        ),
      ).toEqual({
        fromVersion: "0.3.2",
        toVersion: "0.3.3",
        startedAt: 0,
        appPath: "",
        caskToken: "fixlang",
      });
    },
  );

  it.each([undefined, 42, null, { path: "/Applications" }])(
    "reads an unusable appPath as empty rather than trusting it: %s",
    (appPath) => {
      expect(
        parsePendingInstall(
          JSON.stringify({
            fromVersion: "0.3.2",
            toVersion: "0.3.3",
            startedAt: 1_000,
            appPath,
          }),
        )?.appPath,
      ).toBe("");
    },
  );

  /**
   * The failure this guards: a revert lands a version LOWER than the one
   * running, under a DIFFERENT cask token than the one currently installed.
   * Nothing about "the target is newer" may be baked into reconcile — only
   * the recorded token and version equalities decide the outcome. If the
   * token were silently dropped or defaulted wrong, a successful revert (or
   * a switch onto the pre-release channel) would read exactly like a failed
   * upgrade: the marker gets cleared, an error shows, and the install button
   * re-arms onto a second `brew` operation that dies on the first one's
   * download lock.
   */
  it("reconciles a revert to a LOWER version under the pre-release token correctly", () => {
    // Parsed from JSON, not hand-built, so the marker under test is exactly
    // the shape production writes: `caskToken` is the TARGET token, which for
    // a revert is the STABLE one (`updateService.ts` writes
    // `caskToken: targetToken`), and the beta channel is named only by
    // `fromCaskToken`.
    const parsed = parsePendingInstall(
      JSON.stringify({
        fromVersion: "2.0.0-beta.3",
        toVersion: "1.9.5",
        startedAt: STARTED_AT,
        appPath: INSTALLED_PATH,
        caskToken: "fixlang",
        fromCaskToken: "fixlang@beta",
      }),
    );
    expect(parsed?.caskToken).toBe("fixlang");
    expect(parsed?.fromCaskToken).toBe("fixlang@beta");
    if (parsed === null) throw new Error("marker failed to parse");

    // Helper still working: the old, higher version is still what is running.
    expect(
      reconcilePendingInstall(
        parsed,
        "2.0.0-beta.3",
        context({ isTargetInstalled: false }),
      ),
    ).toBe("in-progress");

    // Homebrew staged the lower target under its own token's Caskroom.
    expect(
      reconcilePendingInstall(
        parsed,
        "2.0.0-beta.3",
        context({ isTargetInstalled: true }),
      ),
    ).toBe("restart-required");

    // App relaunched into the reverted, lower version.
    expect(
      reconcilePendingInstall(
        parsed,
        "1.9.5",
        context({ isTargetInstalled: true }),
      ),
    ).toBe("installed");
  });

  /**
   * The contract `ReconcileContext` used to state in prose only: the staged
   * target is resolved against the MARKER's token, not the caller's bound
   * (stable) one. A pre-resolved boolean cannot be asserted — it records
   * neither which version nor which token was probed — so this pins the pair
   * the resolver is actually called with.
   */
  it("probes the staged target against the marker's own cask token", () => {
    const probed: (readonly [string, CaskToken])[] = [];

    reconcilePendingInstall(
      switchMarker,
      switchMarker.fromVersion,
      context({
        isVersionInstalled: (version, caskToken) => {
          probed.push([version, caskToken] as const);
          return false;
        },
      }),
    );

    expect(probed).toContainEqual([
      switchMarker.toVersion,
      switchMarker.caskToken,
    ]);
  });

  it("prefers the resolver over the pre-resolved boolean when both are supplied", () => {
    expect(
      reconcilePendingInstall(
        switchMarker,
        switchMarker.fromVersion,
        context({ isTargetInstalled: false, isVersionInstalled: () => true }),
      ),
    ).toBe("restart-required");
  });

  /**
   * The failure this guards: a channel switch whose install fails rolls back
   * by reinstalling the SOURCE cask, which installs the tap's CURRENT version
   * of that channel — normally not the one the user had. The version has
   * therefore moved, the trap reopens the same bundle path, and the old
   * "version moved anyway, still an update" branch announced a failed
   * operation as a completed one. The user asked to leave the pre-release
   * channel, is still on it under a build they never chose, and clearing the
   * marker destroyed the only record of it.
   */
  it("refuses to call a revert that rolled back onto the pre-release channel an update", () => {
    expect(
      reconcilePendingInstall(revertMarker, "2.0.0-beta.4", context()),
    ).toBe("rolled-back");
  });

  it("refuses to call a switch that rolled back onto a different stable version an update", () => {
    expect(reconcilePendingInstall(switchMarker, "1.9.7", context())).toBe(
      "rolled-back",
    );
  });

  it("detects the rollback from the Caskroom when the resolver is supplied", () => {
    expect(
      reconcilePendingInstall(
        revertMarker,
        "2.0.0-beta.4",
        context({
          isVersionInstalled: (version, caskToken) =>
            version === "2.0.0-beta.4" && caskToken === "fixlang@beta",
        }),
      ),
    ).toBe("rolled-back");
  });

  /**
   * The mirror of the test above, and the case the shape comparison gets
   * exactly backwards: the pre-release cask is holding a build whose version
   * string has NO `-beta.N` suffix — the tap's beta entry tracking a build cut
   * from a release branch — so the shape says "this is a stable version, the
   * revert landed" while the Caskroom says the stable cask holds nothing and
   * the beta one is still staged.
   *
   * A disjunct lets the shape win here, because an OR can only ever flip the
   * probe's `false` up to `true`. That is the one direction that turns a
   * rollback into a reported success: the user who pressed Revert is still on
   * the pre-release channel, on a build they never chose, and the marker that
   * was the only record of it is cleared. The probe is the evidence; the shape
   * is a guess, and it only gets a vote when no probe was supplied.
   */
  it("lets the Caskroom overrule a rolled-back version whose shape belongs to the target channel", () => {
    const rolledBackOntoBeta: PendingInstall = {
      fromVersion: "0.2.0-beta.1",
      toVersion: "0.1.9",
      startedAt: STARTED_AT,
      appPath: INSTALLED_PATH,
      caskToken: "fixlang",
      fromCaskToken: "fixlang@beta",
    };

    expect(
      reconcilePendingInstall(
        rolledBackOntoBeta,
        "0.3.0",
        context({
          isVersionInstalled: (version, caskToken) =>
            version === "0.3.0" && caskToken === "fixlang@beta",
        }),
      ),
    ).toBe("rolled-back");
  });

  it("detects the rollback on a marker written before the source token was recorded", () => {
    // `fromCaskToken` is absent on markers written by the first shipped
    // version of the channel switch; only a beta build can start a revert, so
    // the source channel is still recoverable from `fromVersion`.
    const { fromCaskToken: _omitted, ...withoutSourceToken } = revertMarker;

    expect(
      reconcilePendingInstall(withoutSourceToken, "2.0.0-beta.4", context()),
    ).toBe("rolled-back");
  });

  /**
   * The mirror risk of the rollback check: while the helper is still working,
   * the SOURCE cask is legitimately the one installed, and calling that a
   * rollback would clear the marker and re-arm the button into the running
   * helper's download lock — the exact failure the grace window exists to
   * prevent. An unmoved version is never a rollback.
   */
  it("keeps waiting on an in-flight switch instead of reading the source cask as a rollback", () => {
    expect(
      reconcilePendingInstall(
        switchMarker,
        switchMarker.fromVersion,
        context({
          isVersionInstalled: (version, caskToken) =>
            version === "1.9.5" && caskToken === "fixlang",
        }),
      ),
    ).toBe("in-progress");
  });

  it("still accepts a switch that landed a newer build of the target channel", () => {
    // The tap moved between the click and the launch: beta.2 rather than the
    // beta.1 that was targeted, but the target CHANNEL is where it landed.
    expect(
      reconcilePendingInstall(switchMarker, "2.0.0-beta.2", context()),
    ).toBe("installed");
  });

  it("still accepts a hand-moved version on an ordinary stable upgrade", () => {
    // No channel operation at all: the pre-existing "version moved anyway"
    // behaviour has to survive the rollback check untouched.
    expect(reconcilePendingInstall(marker, "0.4.0", context())).toBe(
      "installed",
    );
  });
});
