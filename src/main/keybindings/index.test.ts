/**
 * @file index.test.ts
 * @description `reloadHotkeys()` must re-arm the combo cancel accelerator
 * (`rearmCancelAcceleratorForActiveCombo`, `comboCancel.ts`) synchronously,
 * in the same call, right after it re-registers everything else — replacing
 * a deleted 1s poll (see `comboCancel.ts`'s file header for why). Just as
 * important is where this call must NOT happen: `unregisterHotkeys()` alone
 * (the `pause-hotkeys` IPC handler, and app quit/close in `src/main/index.ts`)
 * deliberately leaves every accelerator unregistered, so `HotkeyInput` can
 * capture a raw keypress or the app can shut down cleanly — re-arming on
 * either of those paths would silently re-claim the chord and defeat both.
 */
import { globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mainWindow: undefined as unknown }));
vi.mock("electron", () => ({
  globalShortcut: { unregisterAll: vi.fn(), register: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn() },
}));
vi.mock("~/features/core/shared/features", () => ({
  isPromptGenEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock("./correction", () => ({ registerCorrectionShortcut: vi.fn() }));
vi.mock("./comboCancel", () => ({
  rearmCancelAcceleratorForActiveCombo: vi.fn(),
}));
vi.mock("./profileSwitch", () => ({ registerProfileSwitchShortcut: vi.fn() }));
vi.mock("./promptGen", () => ({ registerPromptGenShortcut: vi.fn() }));
vi.mock("./utils", () => ({ checkShortcut: vi.fn() }));
vi.mock("../webViewWindows/mainWindow", () => ({
  getMainWindow: vi.fn(() => mocks.mainWindow),
}));
import { rearmCancelAcceleratorForActiveCombo } from "./comboCancel";
import { registerCorrectionShortcut } from "./correction";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import { reloadHotkeys, unregisterHotkeys } from "./index";

describe("reloadHotkeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mainWindow = { id: "main" } as unknown as BrowserWindow;
  });

  it("unregisters, re-registers, then re-arms the cancel accelerator — in that order", () => {
    const order: string[] = [];
    (globalShortcut.unregisterAll as Mock).mockImplementation(() =>
      order.push("unregisterAll"),
    );
    (registerCorrectionShortcut as Mock).mockImplementation(() => order.push("register"));
    (rearmCancelAcceleratorForActiveCombo as Mock).mockImplementation(() =>
      order.push("rearm"),
    );

    reloadHotkeys();

    expect(order).toEqual(["unregisterAll", "register", "rearm"]);
  });

  it("still re-arms even when there is no main window to re-register hotkeys against", () => {
    mocks.mainWindow = null;

    reloadHotkeys();

    expect(registerCorrectionShortcut).not.toHaveBeenCalled();
    expect(rearmCancelAcceleratorForActiveCombo).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterHotkeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The negative space of the fix above: `pause-hotkeys` and app quit/close
  // call this function directly, never `reloadHotkeys()`, specifically so
  // nothing gets re-armed. A future refactor that moved the rearm call INTO
  // `unregisterHotkeys()` itself would silently break both.
  it("never re-arms the cancel accelerator on its own", () => {
    unregisterHotkeys();

    expect(globalShortcut.unregisterAll).toHaveBeenCalledTimes(1);
    expect(rearmCancelAcceleratorForActiveCombo).not.toHaveBeenCalled();
  });
});
