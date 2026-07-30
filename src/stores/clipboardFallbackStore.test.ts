/**
 * @file clipboardFallbackStore.test.ts
 * @description Covers the pure normalizer AND the store that wraps it. The
 * store half exists because the normalizer alone cannot pin the run's central
 * behavioural decision — that the fallback ships default ON. `electron-store`
 * is replaced with a stateful in-memory mock whose `get` returns a persisted
 * `null` rather than the default, which is what the real dot-prop does and
 * what makes the getter's read-time re-normalization load-bearing. Modelled on
 * `src/stores/localeStore.test.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLIPBOARD_FALLBACK_ENABLED,
  normalizeClipboardFallbackEnabled,
} from "~/shared/clipboardFallback";

const { storeData, configFile } = vi.hoisted(() => ({
  storeData: {} as Record<string, unknown>,
  configFile: { path: "" },
}));

/**
 * Reproduces the two `conf` constructor behaviours the corrupt-config warning
 * depends on, both verified against the real `conf@15.1.0`:
 *
 * - `clearInvalidConfig: false` THROWS while reading an unparseable file and
 *   leaves it on disk untouched.
 * - `clearInvalidConfig: true` swallows the parse error and then REPAIRS the
 *   file in place before the constructor returns, so afterwards the corruption
 *   is undetectable.
 *
 * A mock that skipped the repair would let a check running too late still pass.
 */
vi.mock("electron-store", () => {
  class MockStore {
    readonly path: string;
    constructor(options: {
      defaults?: Record<string, unknown>;
      clearInvalidConfig?: boolean;
    }) {
      this.path = configFile.path;

      let persisted: string;
      try {
        persisted = readFileSync(this.path, "utf8");
      } catch {
        return;
      }

      try {
        JSON.parse(persisted);
      } catch {
        if (options.clearInvalidConfig !== true) {
          throw new SyntaxError("Unexpected token in JSON");
        }
        writeFileSync(
          this.path,
          JSON.stringify(options.defaults ?? {}),
          "utf8",
        );
      }
    }
    get(key: string, defaultValue?: unknown) {
      return key in storeData ? storeData[key] : defaultValue;
    }
    set(key: string, value: unknown) {
      storeData[key] = value;
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});

const tempDir = mkdtempSync(join(tmpdir(), "fixlang-clipboard-fallback-"));

/** Path to a file that does not exist — a fresh install with no config yet. */
const missingConfigPath = join(tempDir, "absent.json");

const writeConfig = (contents: string): string => {
  const path = join(tempDir, `config-${String(Math.random()).slice(2)}.json`);
  writeFileSync(path, contents, "utf8");
  return path;
};

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * The store is a module-level singleton whose constructor runs the
 * corrupt-config check, so each test needs a fresh module instance.
 */
const loadStore = async () => {
  vi.resetModules();
  const module = await import("~/stores/clipboardFallbackStore");
  return module.clipboardFallbackStore;
};

describe("clipboard fallback enabled", () => {
  it("defaults absent/garbage persisted values to enabled (on)", () => {
    expect(normalizeClipboardFallbackEnabled(undefined)).toBe(true);
    expect(normalizeClipboardFallbackEnabled(null)).toBe(true);
    expect(normalizeClipboardFallbackEnabled("nonsense")).toBe(true);
    expect(normalizeClipboardFallbackEnabled(0)).toBe(true);
    expect(normalizeClipboardFallbackEnabled(true)).toBe(true);
  });

  it("disables only on an explicit false", () => {
    expect(normalizeClipboardFallbackEnabled(false)).toBe(false);
  });
});

describe("clipboardFallbackStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
    configFile.path = missingConfigPath;
    vi.clearAllMocks();
  });

  it("ships enabled: a fresh store reports the fallback ON", async () => {
    const store = await loadStore();

    expect(store.getClipboardFallbackEnabled()).toBe(true);
    expect(DEFAULT_CLIPBOARD_FALLBACK_ENABLED).toBe(true);
  });

  it("round-trips an explicit choice in both directions", async () => {
    const store = await loadStore();

    store.setClipboardFallbackEnabled(false);
    expect(store.getClipboardFallbackEnabled()).toBe(false);

    store.setClipboardFallbackEnabled(true);
    expect(store.getClipboardFallbackEnabled()).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "yes"],
    ["a number", 0],
  ])(
    "re-normalizes %s left in the config file back to ON",
    async (_label, persisted) => {
      // A persisted `null` reaches the getter as `null` rather than falling
      // through to the default, so only the getter's own re-normalization
      // keeps it from crossing IPC as a non-boolean.
      storeData.clipboardFallbackEnabled = persisted;
      const store = await loadStore();

      expect(store.getClipboardFallbackEnabled()).toBe(true);
    },
  );

  it("warns instead of silently discarding an OFF when the config is corrupt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configFile.path = writeConfig('{"clipboardFallbackEnabled": fal');

    const store = await loadStore();

    // conf's `clearInvalidConfig` has thrown the user's choice away, so the
    // getter cannot do anything but report the default — the warning is the
    // only signal that an explicit OFF was lost.
    expect(store.getClipboardFallbackEnabled()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(configFile.path);
  });

  it("detects the corruption before conf repairs the file, and still ends up with a usable store", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configFile.path = writeConfig('{"clipboardFallbackEnabled": fal');

    const store = await loadStore();

    // The file conf could not parse has been rewritten by the time startup
    // finishes, which is precisely why the check cannot run afterwards: read
    // the file at that point and it parses like any healthy config.
    expect(() =>
      JSON.parse(readFileSync(configFile.path, "utf8")),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    // And the surviving store must be the lenient one — a strict store would
    // throw from the same getter `set()` reads, leaving the user unable to turn
    // the setting off after exactly this kind of corruption.
    expect(() => {
      store.setClipboardFallbackEnabled(false);
    }).not.toThrow();
    expect(store.getClipboardFallbackEnabled()).toBe(false);
  });

  it("stays quiet for a fresh install and for a readable config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await loadStore();
    expect(warn).not.toHaveBeenCalled();

    configFile.path = writeConfig('{"clipboardFallbackEnabled": false}');
    await loadStore();
    expect(warn).not.toHaveBeenCalled();
  });
});
