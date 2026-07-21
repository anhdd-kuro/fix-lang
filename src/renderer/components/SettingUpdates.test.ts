import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingUpdates } from "./SettingUpdates";

type UpdateState = {
  phase:
    | "unsupported"
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  progress?: {
    percent?: number;
    transferred?: number;
    total?: number;
  };
  message?: string;
};

type UpdateApi = {
  getUpdateState: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
  openUpdateRelease: ReturnType<typeof vi.fn>;
  onUpdateStateChanged: ReturnType<typeof vi.fn>;
};

const readyState = (phase: UpdateState["phase"] = "idle"): UpdateState => ({
  phase,
  currentVersion: "0.1.0",
});

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("SettingUpdates", () => {
  let container: HTMLDivElement;
  let root: Root;
  let updateListener: ((state: UpdateState) => void) | undefined;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let api: UpdateApi;

  const render = async (state: UpdateState) => {
    unsubscribe = vi.fn();
    api = {
      getUpdateState: vi.fn().mockResolvedValue(state),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      openUpdateRelease: vi.fn().mockResolvedValue(undefined),
      onUpdateStateChanged: vi.fn((listener: (next: UpdateState) => void) => {
        updateListener = listener;
        return unsubscribe;
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(SettingUpdates));
    });
    await waitForUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    updateListener = undefined;
    vi.restoreAllMocks();
  });

  it("explains that updates require an installed release when unavailable", async () => {
    await render({
      phase: "unsupported",
      currentVersion: "0.1.0-dev",
    });

    expect(container.textContent).toContain("FixLang v0.1.0-dev");
    expect(container.textContent).toContain(
      "Updates are available in installed release builds.",
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Check for updates",
      ),
    ).toBeUndefined();
  });

  it("checks for updates from the idle state", async () => {
    await render(readyState());

    const check = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Check for updates",
    );
    expect(check).toBeDefined();

    await click(check!);
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("announces checking and prevents another check while one is in progress", async () => {
    await render(readyState("checking"));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Checking for updates…",
    );
    const check = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Check for updates",
    );
    expect(check?.hasAttribute("disabled")).toBe(true);
  });

  it("reports when the installed version is already current", async () => {
    await render(readyState("up-to-date"));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "FixLang is up to date.",
    );
    expect(container.textContent).toContain("Check again");
  });

  it("offers an available release for download without rendering its notes as HTML", async () => {
    await render({
      ...readyState("available"),
      availableVersion: "0.2.0",
      releaseNotes: "<strong>Safer updater</strong>",
    });

    expect(container.textContent).toContain(
      "Version v0.2.0 is available (you have v0.1.0).",
    );
    expect(container.innerHTML).toContain("&lt;strong&gt;Safer updater&lt;/strong&gt;");

    const download = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Download update",
    );
    await click(download!);
    expect(api.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("exposes semantic download progress while an update is downloading", async () => {
    await render({
      ...readyState("downloading"),
      availableVersion: "0.2.0",
      progress: { percent: 42, transferred: 12_400_000, total: 29_800_000 },
    });

    const progress = container.querySelector("progress");
    expect(progress).not.toBeNull();
    expect(progress).toHaveProperty("value", 42);
    expect(progress).toHaveProperty("max", 100);
    expect(progress?.getAttribute("aria-label")).toBe(
      "Downloading version 0.2.0",
    );
    expect(container.textContent).toContain("Downloading 42%");
  });

  it("installs a downloaded update only after the user chooses restart", async () => {
    await render({
      ...readyState("downloaded"),
      availableVersion: "0.2.0",
    });

    expect(container.textContent).toContain(
      "Version v0.2.0 is ready to install.",
    );
    const install = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restart to update",
    );
    await click(install!);
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("lets the user retry and open the release page after an error", async () => {
    await render({
      ...readyState("error"),
      message: "Could not reach GitHub Releases.",
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not reach GitHub Releases.",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    );
    const releases = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "View releases",
    );
    await click(retry!);
    await click(releases!);

    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.openUpdateRelease).toHaveBeenCalledTimes(1);
  });

  it("subscribes to update state changes and cleans up on unmount", async () => {
    await render(readyState());

    expect(api.onUpdateStateChanged).toHaveBeenCalledTimes(1);
    await act(async () => {
      updateListener?.({
        ...readyState("available"),
        availableVersion: "0.2.0",
      });
    });
    expect(container.textContent).toContain("Version v0.2.0 is available");

    await act(async () => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    root = undefined as unknown as Root;
  });
});
