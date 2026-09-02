/**
 * @file profileChange.test.ts
 * @description A pending Ask AI input window outlives the profile it was
 * opened under: `runAskFlow` is a callback held by `askInputWindow`, and the
 * `preset` captured in it supplies the name/outputMode/markdownOutput while
 * `fixGrammar(message, preset.id)` re-resolves that id against whatever
 * profile is active AT SUBMIT TIME. Open Ask under profile A, switch to B,
 * submit — and A's selection context goes out through B's model, provider and
 * API key, landing one mixed-profile row in history.
 *
 * The fix is to dismiss the pending input on every profile activation, which
 * makes `notifyActiveProfileChanged` the chokepoint all three activation sites
 * must go through. This file pins both halves: the dismissal happens, and the
 * broadcast every renderer depends on still happens with it.
 *
 * A running Combo has the same "resolves against the live profile" problem
 * one step further out (E5): `abortActiveCombo()` is wired into the same
 * chokepoint so a mid-chain profile switch stops the run instead of sending
 * a later step through another profile's model, provider and key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./webViewWindows/broadcast", () => ({
  broadcastToAllWindows: vi.fn(),
}));
vi.mock("./webViewWindows/askInputWindow", () => ({
  dismissAskInputWindow: vi.fn(),
}));
// Mocked wholesale (not just its `electron` import) so this file never has to
// mock `globalShortcut` — profileChange.ts only needs to know the funnel
// calls this hook, not how the cancel wrapper implements it.
vi.mock("./keybindings/comboCancel", () => ({
  abortActiveCombo: vi.fn(),
}));
vi.mock("~/features/autocomplete/main/service", () => ({
  abortAutocomplete: vi.fn(),
}));
import { abortAutocomplete } from "~/features/autocomplete/main/service";
import { ACTIVE_PROFILE_CHANGED } from "~/features/core/shared/ipcChannels";
import { abortActiveCombo } from "./keybindings/comboCancel";
import { notifyActiveProfileChanged } from "./profileChange";
import { dismissAskInputWindow } from "./webViewWindows/askInputWindow";
import { broadcastToAllWindows } from "./webViewWindows/broadcast";

describe("notifyActiveProfileChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dismisses a pending Ask input window so its question cannot be submitted against the new profile", () => {
    notifyActiveProfileChanged();

    expect(dismissAskInputWindow).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight Combo run so a later step cannot resolve against the new profile", () => {
    notifyActiveProfileChanged();

    expect(abortActiveCombo).toHaveBeenCalledTimes(1);
  });

  it("still broadcasts ACTIVE_PROFILE_CHANGED to every window", () => {
    notifyActiveProfileChanged();

    expect(broadcastToAllWindows).toHaveBeenCalledWith(ACTIVE_PROFILE_CHANGED);
  });

  it("dismisses and aborts before broadcasting, so no renderer reacts to the new profile while a stale ask or combo is still in flight", () => {
    const order: string[] = [];
    (dismissAskInputWindow as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push("dismiss"),
    );
    (abortActiveCombo as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push("abort-combo"),
    );
    (broadcastToAllWindows as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push("broadcast"),
    );

    notifyActiveProfileChanged();

    expect(order).toEqual(["dismiss", "abort-combo", "broadcast"]);
  });
});

describe("every profile activation site goes through the chokepoint", () => {
  /**
   * Guards the reason this helper exists at all: three separate call sites
   * (the profile-switch hotkey, `apply-profile`, `switch-to-next-profile`)
   * each used to broadcast directly, and a fourth added later would silently
   * skip the dismissal. Asserted as source text because the alternative is
   * booting three IPC handlers and a global shortcut.
   */
  it("no main-process file broadcasts ACTIVE_PROFILE_CHANGED directly except profileChange.ts", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (entry) => {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
            ? [full]
            : [];
        }),
      );
      return nested.flat();
    };

    const files = await walk(join(process.cwd(), "src/main"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith("profileChange.ts")) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("broadcastToAllWindows(ACTIVE_PROFILE_CHANGED)")) {
        offenders.push(file.replace(`${process.cwd()}/`, ""));
      }
    }

    expect(offenders).toEqual([]);
  });
});

// An in-flight suggestion outlives the profile the same way a pending Ask
// input does: resolved after the switch, it carries profile A's model into a
// window now scoped to B.
describe("notifyActiveProfileChanged — autocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aborts every in-flight suggestion", () => {
    notifyActiveProfileChanged();

    expect(abortAutocomplete).toHaveBeenCalledOnce();
  });

  it("aborts across all surfaces, not just one", () => {
    notifyActiveProfileChanged();

    expect(abortAutocomplete).toHaveBeenCalledWith();
  });
});
