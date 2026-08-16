/**
 * @file update.test.ts
 * @description IPC wiring tests for the update handlers, stable and
 * pre-release. Three things are pinned here, none of which any other suite in
 * the repo can see:
 *
 * 1. Registration HAPPENS. `registerPrereleaseUpdateHandlers` shipped as an
 *    exported registrar with zero call sites, so all four pre-release channels
 *    were unregistered at runtime and Settings -> Updates rejected on mount
 *    with "No handler registered for 'updates:prerelease:get-state'". The
 *    preload suite could not see it: it mocks `ipcRenderer.invoke`, and a
 *    mocked invoke resolves whether or not a handler exists. So everything
 *    below registers through `registerUpdateHandlers` — `src/main`'s only
 *    entry point — rather than by calling the pre-release registrar directly,
 *    which would pass just as happily with nothing wired up.
 * 2. Channel NAMES. They are the entire contract: main sends on a string,
 *    preload listens on a string, and nothing in between type-checks them
 *    against each other. A typo makes the matching button silently do nothing.
 *    Every name is written out as a literal below rather than imported from
 *    the module under test, which would make these assertions agree with any
 *    typo they were meant to catch.
 * 3. SEPARATION. Pre-release state broadcasts on `updates:prerelease-state`
 *    and never on `updates:state`, and the tray references neither the
 *    pre-release channel nor the pre-release bridge.
 *
 * Electron is mocked at the seam the other main-process IPC suites use (see
 * `src/features/i18n/main/locale.test.ts`): `ipcMain.handle` records
 * registrations, `BrowserWindow.getAllWindows` returns fake windows whose
 * `webContents.send` is a spy.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerUpdateHandlers } from "./update";
import type { PrereleaseState } from "~/features/update/shared/prerelease";
import type { UpdateState } from "~/features/update/shared/update";
import type { UpdateService } from "~/main/update";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

const { getAllWindowsMock, openExternalMock } = vi.hoisted(() => ({
  getAllWindowsMock: vi.fn(),
  openExternalMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener);
    },
  },
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  shell: { openExternal: openExternalMock },
}));

const unsubscribe = vi.fn();

const fakeWindow = (isDestroyed: boolean) => ({
  isDestroyed: () => isDestroyed,
  webContents: { send: vi.fn() },
});

const stableState: UpdateState = { phase: "idle", currentVersion: "0.32.0" };
const prereleaseState: PrereleaseState = {
  phase: "available",
  activeChannel: "stable",
  offeredVersion: "0.33.0-beta.1",
};

/**
 * Typed as the real `UpdateService` with no cast, which is the point: the one
 * service `src/main/index.ts` already passes carries the pre-release surface
 * too, so wiring the pre-release channels needs no second service and no
 * second call site. If `UpdateService` ever stops declaring those five
 * members, this object stops type-checking here and the internal
 * `registerPrereleaseHandlers(service)` call stops type-checking in
 * `update.ts` — rather than the channels quietly going unregistered again.
 */
const buildService = () => {
  const stableListeners: ((state: UpdateState) => void)[] = [];
  const prereleaseListeners: ((state: PrereleaseState) => void)[] = [];
  const service: UpdateService = {
    getState: vi.fn().mockReturnValue(stableState),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue({ success: true }),
    restartForUpdate: vi.fn().mockReturnValue({ success: true }),
    getReleaseUrl: vi.fn().mockReturnValue(null),
    subscribe: vi.fn((listener: (state: UpdateState) => void) => {
      stableListeners.push(listener);
      return unsubscribe;
    }),
    getPrereleaseState: vi.fn().mockReturnValue(prereleaseState),
    checkForPrerelease: vi.fn().mockResolvedValue(prereleaseState),
    switchToPrerelease: vi.fn().mockResolvedValue({ success: true }),
    revertToStable: vi.fn().mockResolvedValue({ success: true }),
    subscribeToPrereleaseState: vi.fn(
      (listener: (state: PrereleaseState) => void) => {
        prereleaseListeners.push(listener);
        return unsubscribe;
      },
    ),
  };
  return { service, stableListeners, prereleaseListeners };
};

describe("registerUpdateHandlers wires every update channel", () => {
  let service: UpdateService;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    getAllWindowsMock.mockReturnValue([]);
    ({ service } = buildService());
    registerUpdateHandlers(service);
  });

  // The zero-call-site regression in one assertion: with the pre-release
  // registration detached from this entry point, the four `prerelease` names
  // vanish from this list and every pre-release button becomes a rejected
  // invoke in the renderer.
  it("registers exactly these nine channels, by name", () => {
    expect([...handlers.keys()].sort()).toEqual([
      "updates:check",
      "updates:get-state",
      "updates:install",
      "updates:open-release",
      "updates:prerelease:check",
      "updates:prerelease:get-state",
      "updates:prerelease:revert",
      "updates:prerelease:switch",
      "updates:restart",
    ]);
  });

  it("routes updates:prerelease:get-state to getPrereleaseState", () => {
    expect(handlers.get("updates:prerelease:get-state")?.({})).toEqual(
      prereleaseState,
    );
    expect(service.getPrereleaseState).toHaveBeenCalledTimes(1);
    expect(service.getState).not.toHaveBeenCalled();
  });

  it("routes updates:prerelease:check to checkForPrerelease", async () => {
    await expect(
      handlers.get("updates:prerelease:check")?.({}),
    ).resolves.toEqual(prereleaseState);
    expect(service.checkForPrerelease).toHaveBeenCalledTimes(1);
    // A pre-release check that also ran the stable check would republish the
    // stable state as a side effect of opening the beta section.
    expect(service.checkForUpdates).not.toHaveBeenCalled();
  });

  it("routes updates:prerelease:switch to switchToPrerelease", async () => {
    await expect(
      handlers.get("updates:prerelease:switch")?.({}),
    ).resolves.toEqual({ success: true });
    expect(service.switchToPrerelease).toHaveBeenCalledTimes(1);
    expect(service.revertToStable).not.toHaveBeenCalled();
  });

  it("routes updates:prerelease:revert to revertToStable", async () => {
    await expect(
      handlers.get("updates:prerelease:revert")?.({}),
    ).resolves.toEqual({ success: true });
    expect(service.revertToStable).toHaveBeenCalledTimes(1);
    expect(service.switchToPrerelease).not.toHaveBeenCalled();
  });

  // Switch and revert take no renderer input, so a renderer message cannot
  // choose which channel the machine gets moved to.
  it("passes no renderer-supplied argument to the switch and revert actions", async () => {
    await handlers.get("updates:prerelease:switch")?.({}, "beta", {
      evil: true,
    });
    await handlers.get("updates:prerelease:revert")?.({}, "stable");

    expect(service.switchToPrerelease).toHaveBeenCalledWith();
    expect(service.revertToStable).toHaveBeenCalledWith();
  });

  it("routes the stable channels to the stable service methods", async () => {
    expect(handlers.get("updates:get-state")?.({})).toEqual(stableState);
    await handlers.get("updates:check")?.({});
    await handlers.get("updates:install")?.({});
    handlers.get("updates:restart")?.({});

    expect(service.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.installUpdate).toHaveBeenCalledTimes(1);
    expect(service.restartForUpdate).toHaveBeenCalledTimes(1);
    expect(service.checkForPrerelease).not.toHaveBeenCalled();
    expect(service.switchToPrerelease).not.toHaveBeenCalled();
  });

  it("subscribes to both states, so each one reaches the renderer at all", () => {
    expect(service.subscribe).toHaveBeenCalledTimes(1);
    expect(service.subscribeToPrereleaseState).toHaveBeenCalledTimes(1);
  });
});

describe("the two states broadcast on their own channels", () => {
  let stableListeners: ((state: UpdateState) => void)[];
  let prereleaseListeners: ((state: PrereleaseState) => void)[];
  let live: ReturnType<typeof fakeWindow>;
  let alsoLive: ReturnType<typeof fakeWindow>;
  let destroyed: ReturnType<typeof fakeWindow>;

  const sentChannels = () =>
    [
      ...live.webContents.send.mock.calls,
      ...alsoLive.webContents.send.mock.calls,
    ].map(([channel]) => channel);

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    live = fakeWindow(false);
    alsoLive = fakeWindow(false);
    destroyed = fakeWindow(true);
    getAllWindowsMock.mockReturnValue([live, destroyed, alsoLive]);
    const built = buildService();
    stableListeners = built.stableListeners;
    prereleaseListeners = built.prereleaseListeners;
    registerUpdateHandlers(built.service);
  });

  it("sends pre-release state on updates:prerelease-state and on no other channel", () => {
    prereleaseListeners[0](prereleaseState);

    expect(live.webContents.send).toHaveBeenCalledWith(
      "updates:prerelease-state",
      prereleaseState,
    );
    expect(alsoLive.webContents.send).toHaveBeenCalledWith(
      "updates:prerelease-state",
      prereleaseState,
    );
    // The whole point of the second channel: a pre-release payload that also
    // (or instead) rode `updates:state` would reach every window already
    // listening to the stable channel, where `isUpdateState` would either
    // reject it or, worse, accept it as a stable update.
    expect(sentChannels()).toEqual([
      "updates:prerelease-state",
      "updates:prerelease-state",
    ]);
  });

  it("sends stable state on updates:state and on no other channel", () => {
    stableListeners[0](stableState);

    expect(live.webContents.send).toHaveBeenCalledWith(
      "updates:state",
      stableState,
    );
    expect(sentChannels()).toEqual(["updates:state", "updates:state"]);
  });

  it("skips destroyed windows on both broadcasts", () => {
    stableListeners[0](stableState);
    prereleaseListeners[0](prereleaseState);

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });
});

/**
 * The receive half of the separation. Card criterion 3 says the tray never
 * subscribes to the pre-release channel; `TrayToolbar.test.ts` cannot notice a
 * breach of that (it declares its own local `UpdateState` and never mentions
 * the pre-release bridge), so it is checked here by reading the tray's own
 * sources. A structural scan is the honest shape for a "this code does not
 * exist anywhere over there" claim.
 */
describe("the tray never subscribes to the pre-release channel", () => {
  const trayDirectory = fileURLToPath(
    new URL("../../../renderer/TrayWindow", import.meta.url),
  );

  const traySources = readdirSync(trayDirectory, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);

  // Without these two, the scan below would pass just as happily against an
  // empty directory listing or a misresolved path.
  it("reads the real tray sources", () => {
    expect(traySources.length).toBeGreaterThanOrEqual(5);
    expect(
      traySources.some((file) => file.endsWith("components/TrayToolbar.tsx")),
    ).toBe(true);
  });

  it("uses the stable update surface, which is what it is allowed to use", () => {
    const toolbar = traySources.find((file) =>
      file.endsWith("components/TrayToolbar.tsx"),
    );
    expect(readFileSync(toolbar as string, "utf8")).toContain("checkForUpdates");
  });

  it.each([
    "updates:prerelease-state",
    "onPrereleaseStateChanged",
    "getPrereleaseState",
    "checkForPrerelease",
    "switchToPrerelease",
    "revertToStable",
    "PrereleaseState",
  ])("mentions %s nowhere under src/renderer/TrayWindow", (identifier) => {
    const offenders = traySources.filter((file) =>
      readFileSync(file, "utf8").includes(identifier),
    );

    expect(offenders).toEqual([]);
  });
});
