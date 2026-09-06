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

    // Imported constant, not a literal: a literal keeps passing after it moves.
    expect(parsePendingInstall(legacyRaw)?.caskToken).toBe(
      HOMEBREW_STABLE_CASK_TOKEN,
    );
  });

  // Mocking the token's move is the only way to see a migration default left on
  // the legacy string, which stays valid for old markers.
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

  // Equivalence with `./homebrew`'s `isCaskToken`: a third channel token added
  // there but not here would silently coerce back to stable on read.
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

  /** A revert: beta build, stable target — and so the STABLE token. */
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

  // `open -b <bundle id>` can launch a stray build that shares the id.
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
    // Restart is the remedy either way; only this outcome knows it must open
    // another path.
    expect(
      reconcilePendingInstall(
        marker,
        "0.2.9",
        context({ runningAppPath: STRAY_PATH, isTargetInstalled: true }),
      ),
    ).toBe("wrong-bundle");
  });

  // Identity must be tested BEFORE version equality: a revert targets a version
  // the user just ran, so a leftover copy at it is ordinary.
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
    // Install and rollback both failed, and `open -b` found a copy at `toVersion`.
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
   * Nothing about "the target is newer" may be baked into reconcile — only the
   * recorded token and version equalities decide, or a successful revert reads
   * exactly like a failed upgrade and re-arms the install button.
   */
  it("reconciles a revert to a LOWER version under the pre-release token correctly", () => {
    // Parsed from JSON, so the marker is exactly the shape production writes:
    // `caskToken` is the TARGET token, and beta appears only in `fromCaskToken`.
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

    expect(
      reconcilePendingInstall(
        parsed,
        "1.9.5",
        context({ isTargetInstalled: true }),
      ),
    ).toBe("installed");
  });

  // Asserted as the pair the resolver is CALLED with: a pre-resolved boolean
  // records neither the version nor the token that was probed.
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

  // A rollback reinstalls the SOURCE cask at the tap's current version, so the
  // version moves and a bare "version moved anyway" branch calls it a success.
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

  // A beta cask can hold a version with NO `-beta.N` suffix, so the shape says
  // "the revert landed" while the Caskroom says otherwise. The probe must
  // overrule it: OR-ing them only flips `false` up to `true`.
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
    // `fromCaskToken` is absent on the first shipped switch's markers, and only a
    // beta build can start a revert, so `fromVersion` still names the channel.
    const { fromCaskToken: _omitted, ...withoutSourceToken } = revertMarker;

    expect(
      reconcilePendingInstall(withoutSourceToken, "2.0.0-beta.4", context()),
    ).toBe("rolled-back");
  });

  // While the helper works the SOURCE cask is legitimately the installed one, so
  // an unmoved version is never a rollback.
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
    // The tap moved between click and launch; the target CHANNEL still matches.
    expect(
      reconcilePendingInstall(switchMarker, "2.0.0-beta.2", context()),
    ).toBe("installed");
  });

  it("still accepts a hand-moved version on an ordinary stable upgrade", () => {
    // No channel operation: the "version moved anyway" path survives untouched.
    expect(reconcilePendingInstall(marker, "0.4.0", context())).toBe(
      "installed",
    );
  });
});
