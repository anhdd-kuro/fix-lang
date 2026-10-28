/**
 * @file guards.edgeInputs.test.ts
 * @description Pins exactly which values the selection-guard preload bridge
 * accepts and rejects at its edges — non-finite and huge numbers, `-0`, boxed
 * primitives, sparse arrays, inherited and null-prototype fields, extra keys,
 * and the raw-length bounds that apply BEFORE canonicalisation. These are the
 * cases a hand-written predicate and a schema library are most likely to
 * disagree on, so any change of verdict here is a change of the guard rail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { textLabel } from "~/features/i18n/shared/message";
import {
  MAX_APP_BUNDLE_PATH_LENGTH,
  MAX_APP_BUNDLE_PATHS,
} from "~/features/guards/shared/appBundleIds";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  MAX_BUNDLE_ID_LENGTH,
  MAX_DENIED_BUNDLE_IDS,
} from "~/features/guards/shared/guardSettings";
import { EMPTY_SECURITY_STATS } from "~/features/guards/shared/securityStats";
import { selectionGuardsFeature } from "./guards";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getPathForFile: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: { invoke: electronMocks.invoke },
  webUtils: { getPathForFile: electronMocks.getPathForFile },
}));

const valid = {
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
};

const defaults = {
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

const SLACK = "/Applications/Slack.app";

/** An array whose index 0 was never assigned. */
const withLeadingHole = (last: string): string[] => {
  const entries = [last];
  entries.length = 2;
  entries.reverse();
  return entries;
};

/** Whatever the mocked `ipcRenderer.invoke` may resolve with. */
type InvokeReply = Parameters<typeof electronMocks.invoke.mockResolvedValue>[0];

const replyOf = async (reply: InvokeReply) => {
  electronMocks.invoke.mockResolvedValue(reply);
  return selectionGuardsFeature.getSelectionGuards();
};

describe("getSelectionGuards — reply edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts -0 and a huge integer as non-negative integers", async () => {
    const result = await replyOf({
      ...valid,
      clipboardMaxAgeSeconds: -0,
      maxSelectionChars: 1e20,
    });
    expect(Object.is(result.clipboardMaxAgeSeconds, -0)).toBe(true);
    expect(result.maxSelectionChars).toBe(1e20);
  });

  it.each([
    ["a fraction", 1.5],
    ["a negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a boxed number", new Number(5)],
    ["a numeric string", "5"],
  ])("rejects %s as a number field", async (_label, junk) => {
    expect(await replyOf({ ...valid, clipboardMaxAgeSeconds: junk })).toEqual(
      defaults,
    );
    expect(await replyOf({ ...valid, maxSelectionChars: junk })).toEqual(
      defaults,
    );
  });

  it("keeps extra keys on an accepted reply", async () => {
    expect(await replyOf({ ...valid, extra: true })).toEqual({
      ...valid,
      extra: true,
    });
  });

  it("accepts null-prototype and inherited-field replies", async () => {
    const nullProto = Object.assign(Object.create(null), valid);
    expect(await replyOf(nullProto)).toEqual(valid);

    const inherited = Object.assign(
      Object.create({ clipboardMaxAgeSeconds: 7 }),
      { maxSelectionChars: 9, deniedBundleIds: [] },
    );
    const result = await replyOf(inherited);
    expect(result.clipboardMaxAgeSeconds).toBe(7);
    expect(result.maxSelectionChars).toBe(9);
    expect(result.deniedBundleIds).toEqual([]);
  });

  it.each([
    ["a function carrying the fields", Object.assign(() => 1, valid)],
    ["a Date", new Date(0)],
    ["a boxed string", new String("x")],
  ])("rejects %s", async (_label, reply) => {
    expect(await replyOf(reply)).toEqual(defaults);
  });

  it("bounds the deny-list at MAX_DENIED_BUNDLE_IDS entries", async () => {
    const atCap = Array.from(
      { length: MAX_DENIED_BUNDLE_IDS },
      (_, index) => `com.example.app${index}`,
    );
    expect(
      (await replyOf({ ...valid, deniedBundleIds: atCap })).deniedBundleIds,
    ).toBe(atCap);
    expect(
      await replyOf({ ...valid, deniedBundleIds: [...atCap, "com.one.more"] }),
    ).toEqual(defaults);
  });

  it("bounds each entry by its RAW length, before trimming", async () => {
    const exact = "a".repeat(MAX_BUNDLE_ID_LENGTH);
    expect(
      (await replyOf({ ...valid, deniedBundleIds: [exact] })).deniedBundleIds,
    ).toEqual([exact]);
    const paddedButShort = ` ${"a".repeat(MAX_BUNDLE_ID_LENGTH - 1)} `;
    expect(paddedButShort.trim().length).toBeLessThan(MAX_BUNDLE_ID_LENGTH);
    expect(paddedButShort.length).toBeGreaterThan(MAX_BUNDLE_ID_LENGTH);
    expect(
      await replyOf({ ...valid, deniedBundleIds: [paddedButShort] }),
    ).toEqual(defaults);
  });

  it("accepts non-canonical and duplicate entries (canonicalising is the store's job)", async () => {
    const ids = ["  COM.Example.App ", "com.example.app", "com.example.app"];
    expect(
      (await replyOf({ ...valid, deniedBundleIds: ids })).deniedBundleIds,
    ).toEqual(ids);
  });

  it("skips a hole in the deny-list array, as Array#every does", async () => {
    const holey = withLeadingHole("com.example.app");
    expect(0 in holey).toBe(false);
    const result = await replyOf({ ...valid, deniedBundleIds: holey });
    expect(result.deniedBundleIds).toHaveLength(2);
    expect(result.deniedBundleIds[1]).toBe("com.example.app");
  });

  it.each([
    ["a blank entry", ["   "]],
    ["a control character", ["com.example\u0007app"]],
    ["an explicit undefined", [undefined]],
    ["a boxed string", [new String("com.example.app")]],
  ])("rejects a deny-list with %s", async (_label, deniedBundleIds) => {
    expect(await replyOf({ ...valid, deniedBundleIds })).toEqual(defaults);
  });
});

describe("setSelectionGuards — outgoing edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.invoke.mockResolvedValue({ success: true });
  });

  it("forwards an accepted payload as the same object", async () => {
    const payload = { ...valid, clipboardMaxAgeSeconds: 1e20, extra: 1 };
    await selectionGuardsFeature.setSelectionGuards(payload);
    expect(electronMocks.invoke).toHaveBeenCalledTimes(1);
    expect(electronMocks.invoke.mock.calls[0][1]).toBe(payload);
  });

  it("forwards a payload whose deny-list has a hole", async () => {
    const payload = {
      ...valid,
      deniedBundleIds: withLeadingHole("com.example.app"),
    };
    const result = await selectionGuardsFeature.setSelectionGuards(payload);
    expect(result.success).toBe(true);
    expect(electronMocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("refuses a fractional number without invoking main", async () => {
    const result = await selectionGuardsFeature.setSelectionGuards({
      ...valid,
      maxSelectionChars: 0.5,
    });
    expect(result.success).toBe(false);
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
});

describe("getRecentActiveApps — reply edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an accepted reply as the same array, extra keys and all", async () => {
    const apps = [{ name: "Slack", bundleId: null, pid: 1 }];
    electronMocks.invoke.mockResolvedValue(apps);
    expect(await selectionGuardsFeature.getRecentActiveApps()).toBe(apps);
  });

  it("accepts an empty list, inherited fields, and a hole", async () => {
    electronMocks.invoke.mockResolvedValue([]);
    expect(await selectionGuardsFeature.getRecentActiveApps()).toEqual([]);

    const inherited = [
      Object.assign(Object.create({ name: "Slack" }), { bundleId: "a.b" }),
    ];
    electronMocks.invoke.mockResolvedValue(inherited);
    expect(await selectionGuardsFeature.getRecentActiveApps()).toBe(inherited);

    const holey = [{ name: "Slack", bundleId: null }];
    holey.length = 2;
    electronMocks.invoke.mockResolvedValue(holey);
    expect(await selectionGuardsFeature.getRecentActiveApps()).toBe(holey);
  });

  it.each([
    ["a null entry", [null]],
    ["a boxed name", [{ name: new String("Slack"), bundleId: null }]],
    ["an undefined bundleId", [{ name: "Slack", bundleId: undefined }]],
    ["a function entry", [Object.assign(() => 1, { bundleId: null })]],
    ["a non-array object", { 0: { name: "Slack", bundleId: null } }],
  ])("rejects %s", async (_label, reply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    expect(await selectionGuardsFeature.getRecentActiveApps()).toEqual([]);
  });
});

describe("resolveAppBundleIds — outgoing path edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.invoke.mockResolvedValue({ success: true, bundleIds: [] });
  });

  it("accepts a path at exactly the length bound and an upper-case suffix", async () => {
    const exact = `/${"a".repeat(MAX_APP_BUNDLE_PATH_LENGTH - 5)}.APP`;
    expect(exact.length).toBe(MAX_APP_BUNDLE_PATH_LENGTH);
    const result = await selectionGuardsFeature.resolveAppBundleIds([exact]);
    expect(result.success).toBe(true);
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "resolve-app-bundle-ids",
      [exact],
    );
  });

  it("accepts exactly MAX_APP_BUNDLE_PATHS paths", async () => {
    const atCap = Array.from({ length: MAX_APP_BUNDLE_PATHS }, () => SLACK);
    expect(
      (await selectionGuardsFeature.resolveAppBundleIds(atCap)).success,
    ).toBe(true);
  });

  it("forwards a holey list with the hole spread to undefined", async () => {
    const holey = withLeadingHole(SLACK);
    await selectionGuardsFeature.resolveAppBundleIds(holey);
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      "resolve-app-bundle-ids",
      [undefined, SLACK],
    );
  });

  it.each([
    [
      "one character over the bound",
      `/${"a".repeat(MAX_APP_BUNDLE_PATH_LENGTH - 4)}.app`,
    ],
    ["a DEL character", "/Applications/Sl\u007fack.app"],
    ["a C1 control character", "/Applications/Sl\u0085ack.app"],
    ["a trailing slash", "/Applications/Slack.app/"],
  ])("rejects %s without invoking main", async (_label, entry) => {
    const result = await selectionGuardsFeature.resolveAppBundleIds([entry]);
    expect(result.success).toBe(false);
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
});

describe("chooseDeniedApps — reply edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const replyOfChooser = async (reply: InvokeReply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    return selectionGuardsFeature.chooseDeniedApps();
  };

  it.each([
    ["a success with extra keys", { success: true, bundleIds: [], extra: 1 }],
    [
      "a success that also carries an error",
      { success: true, bundleIds: ["a"], error: "x" },
    ],
    [
      "a failure that also carries ids",
      { success: false, error: textLabel("no"), bundleIds: [1] },
    ],
    [
      "a null-prototype success",
      Object.assign(Object.create(null), { success: true, bundleIds: [] }),
    ],
  ])("accepts %s", async (_label, reply) => {
    const result = await replyOfChooser(reply);
    expect(result).toEqual(reply);
  });

  it("accepts an inherited success flag", async () => {
    const result = await replyOfChooser(
      Object.assign(Object.create({ success: true }), { bundleIds: ["a"] }),
    );
    expect(result.success).toBe(true);
    expect(result.success && result.bundleIds).toEqual(["a"]);
  });

  it("accepts a success whose id list has a hole", async () => {
    const holey = withLeadingHole("com.example.app");
    const result = await replyOfChooser({ success: true, bundleIds: holey });
    expect(result.success).toBe(true);
  });

  it.each([
    ["a boxed id", { success: true, bundleIds: [new String("a")] }],
    [
      "a label with an extra key",
      { success: false, error: { ...textLabel("no"), extra: 1 } },
    ],
    ["a truthy non-boolean success", { success: 1, bundleIds: [] }],
    ["an array", [true]],
    ["a string", "ok"],
  ])("rejects %s", async (_label, reply) => {
    const result = await replyOfChooser(reply);
    expect(result).toEqual({
      success: false,
      error: textLabel("Malformed app bundle ids reply"),
    });
  });
});

describe("getSecurityStats — range and reply edge inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["all", "30d", "7d"] as const)(
    "accepts the %s range",
    async (range) => {
      electronMocks.invoke.mockResolvedValue(EMPTY_SECURITY_STATS);
      await expect(
        selectionGuardsFeature.getSecurityStats(range),
      ).resolves.toEqual(EMPTY_SECURITY_STATS);
    },
  );

  // Junk the parameter type cannot express, arriving through a JSON
  // boundary the way it would from an untyped renderer.
  it.each([
    ["an upper-case range", '"ALL"'],
    ["a number", "7"],
    ["null", "null"],
  ])("throws on %s without invoking main", async (_label, rangeJson) => {
    await expect(
      selectionGuardsFeature.getSecurityStats(JSON.parse(rangeJson)),
    ).rejects.toThrow("Malformed security stats range");
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    [
      "-0 and huge counts",
      { ...EMPTY_SECURITY_STATS, eventCount: -0, blockedByApp: 1e20 },
    ],
    ["extra keys", { ...EMPTY_SECURITY_STATS, extra: "x" }],
    [
      "a Date as ruleCounts",
      { ...EMPTY_SECURITY_STATS, ruleCounts: new Date(0) },
    ],
    [
      "a null-prototype ruleCounts",
      {
        ...EMPTY_SECURITY_STATS,
        ruleCounts: Object.assign(Object.create(null), { a: 2 }),
      },
    ],
    [
      "a string lastEventAt",
      { ...EMPTY_SECURITY_STATS, lastEventAt: "not a date" },
    ],
  ])("accepts a reply with %s", async (_label, reply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    await expect(
      selectionGuardsFeature.getSecurityStats("all"),
    ).resolves.toEqual(reply);
  });

  it.each([
    ["a fractional count", { ...EMPTY_SECURITY_STATS, secretMasked: 0.5 }],
    ["a NaN count", { ...EMPTY_SECURITY_STATS, eventCount: Number.NaN }],
    ["a boxed count", { ...EMPTY_SECURITY_STATS, eventCount: new Number(1) }],
    ["a missing count", { ...EMPTY_SECURITY_STATS, legacyEvents: undefined }],
    [
      "a negative rule count",
      { ...EMPTY_SECURITY_STATS, ruleCounts: { a: -1 } },
    ],
    ["an array ruleCounts", { ...EMPTY_SECURITY_STATS, ruleCounts: [] }],
    ["a null ruleCounts", { ...EMPTY_SECURITY_STATS, ruleCounts: null }],
    [
      "a missing lastEventAt",
      { ...EMPTY_SECURITY_STATS, lastEventAt: undefined },
    ],
    ["a numeric lastEventAt", { ...EMPTY_SECURITY_STATS, lastEventAt: 5 }],
    ["an array reply", [EMPTY_SECURITY_STATS]],
  ])("rejects a reply with %s", async (_label, reply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    await expect(
      selectionGuardsFeature.getSecurityStats("all"),
    ).rejects.toThrow("Malformed security stats reply");
  });
});
