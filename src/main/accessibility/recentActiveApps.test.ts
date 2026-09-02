/**
 * @file recentActiveApps.test.ts
 * @description Covers the "recently used apps" MRU: bounded to
 * `RECENT_ACTIVE_APPS_MAX` (12), most-recently-seen first, deduplicating a
 * repeat sighting instead of growing forever, fed by `logActiveAppRead` (the
 * funnel `~/utils` and `getActiveApp` already share), and — the load-bearing
 * constraint — never touching disk.
 *
 * The module is a singleton MRU list, so every test loads a fresh module
 * graph via `vi.resetModules()` + dynamic `import()`, the same idiom
 * `clipboardChangeTracker.test.ts` uses for its own singleton.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveApp } from "./activeApp";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

const appOf = (name: string, bundleId: string | null = `com.example.${name.toLowerCase()}`): ActiveApp => ({
  name,
  bundleId,
});

describe("recentActiveApps", () => {
  beforeEach(() => {
    vi.resetModules();
    loggerMock.debug.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty", async () => {
    const { getRecentActiveApps } = await import("./recentActiveApps");
    expect(getRecentActiveApps()).toEqual([]);
  });

  it("records an app and returns it most-recent-first", async () => {
    const { recordActiveApp, getRecentActiveApps } = await import("./recentActiveApps");

    recordActiveApp(appOf("Slack"));
    recordActiveApp(appOf("Notes"));

    expect(getRecentActiveApps()).toEqual([appOf("Notes"), appOf("Slack")]);
  });

  it("moves a repeat sighting to the front instead of duplicating it", async () => {
    const { recordActiveApp, getRecentActiveApps } = await import("./recentActiveApps");

    recordActiveApp(appOf("Slack"));
    recordActiveApp(appOf("Notes"));
    recordActiveApp(appOf("Slack"));

    expect(getRecentActiveApps()).toEqual([appOf("Slack"), appOf("Notes")]);
  });

  it("is bounded to RECENT_ACTIVE_APPS_MAX (12), dropping the oldest entry", async () => {
    const { recordActiveApp, getRecentActiveApps, RECENT_ACTIVE_APPS_MAX } = await import(
      "./recentActiveApps"
    );
    expect(RECENT_ACTIVE_APPS_MAX).toBe(12);

    for (let i = 0; i < RECENT_ACTIVE_APPS_MAX + 3; i++) {
      recordActiveApp(appOf(`App${i}`));
    }

    const recent = getRecentActiveApps();
    expect(recent).toHaveLength(RECENT_ACTIVE_APPS_MAX);
    expect(recent[0]).toEqual(appOf(`App${RECENT_ACTIVE_APPS_MAX + 2}`));
    expect(recent.some((app) => app.name === "App0")).toBe(false);
    expect(recent.some((app) => app.name === "App2")).toBe(false);
    expect(recent.some((app) => app.name === "App3")).toBe(true);
  });

  it("dedupes by bundleId even when the reported name changed", async () => {
    const { recordActiveApp, getRecentActiveApps } = await import("./recentActiveApps");

    recordActiveApp({ name: "Slack", bundleId: "com.tinyspeck.slackmacgap" });
    recordActiveApp({ name: "Slack (renamed)", bundleId: "com.tinyspeck.slackmacgap" });

    const recent = getRecentActiveApps();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toEqual({ name: "Slack (renamed)", bundleId: "com.tinyspeck.slackmacgap" });
  });

  it("falls back to matching by name when bundleId is null", async () => {
    const { recordActiveApp, getRecentActiveApps } = await import("./recentActiveApps");

    recordActiveApp({ name: "Terminal", bundleId: null });
    recordActiveApp({ name: "Terminal", bundleId: null });

    expect(getRecentActiveApps()).toHaveLength(1);
  });

  it("exposes the current list as a read-only snapshot, not a live reference", async () => {
    const { recordActiveApp, getRecentActiveApps } = await import("./recentActiveApps");

    recordActiveApp(appOf("Slack"));
    const first = getRecentActiveApps();
    recordActiveApp(appOf("Notes"));
    const second = getRecentActiveApps();

    expect(first).not.toBe(second);
    expect(first).toEqual([appOf("Slack")]);
  });

  it("is fed by logActiveAppRead — a successful read is recorded", async () => {
    const { logActiveAppRead } = await import("./activeApp");
    const { getRecentActiveApps } = await import("./recentActiveApps");

    logActiveAppRead(appOf("Xcode"), "Xcode\tcom.example.xcode");

    expect(getRecentActiveApps()).toEqual([appOf("Xcode")]);
  });

  it("is fed by logActiveAppRead — a dropped read (null app) records nothing", async () => {
    const { logActiveAppRead } = await import("./activeApp");
    const { getRecentActiveApps } = await import("./recentActiveApps");

    logActiveAppRead(null, "FixLang\tcom.fixlang.app");

    expect(getRecentActiveApps()).toEqual([]);
  });

  it("never writes to disk — no fs, electron-store, or userData import in source", () => {
    const source = readFileSync(path.join(__dirname, "recentActiveApps.ts"), "utf8");
    expect(source).not.toMatch(/from ["']node:fs|from ["']fs["']|electron-store|getPath/);
  });
});
