/**
 * @file TrayWindowMain.test.ts
 * @description Regression guard for the duplicated Providers card.
 *
 * `useActiveProfileId` returns "" until `get-current-profile` resolves, and the
 * tray keys TWO siblings by it. React's array reconciliation maps old children by
 * `key`, so two siblings sharing the key "" collide: the second overwrites the
 * first in that map, and when the key flips to the real profile id the evicted
 * fiber is never deleted — its DOM node stays behind as a second card. Production
 * React logs no duplicate-key warning, so only a rendered count catches it.
 *
 * The heavy children are stubbed: this file is about reconciliation of the tray's
 * profile-keyed siblings, not about what a model picker fetches.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";

vi.mock("../components/ModelSelect", () => ({
  ModelSelect: () => createElement("div", { "data-stub": "model-select" }),
}));
vi.mock("../components/DefaultReasoningEffortSlider", () => ({
  DefaultReasoningEffortSlider: () =>
    createElement("div", { "data-stub": "reasoning-slider" }),
}));
vi.mock("../components/LanguageTabs", () => ({
  LanguageTabs: () => createElement("div", { "data-stub": "language-tabs" }),
}));
vi.mock("../components/OutputModeTabs", () => ({
  OutputModeTabs: () => createElement("div", { "data-stub": "output-mode-tabs" }),
}));
vi.mock("../components/Tooltip", () => ({
  default: () => createElement("span", { "data-stub": "tooltip" }),
}));
vi.mock("./components/TrayToolbar", () => ({
  TrayToolbar: () => createElement("div", { "data-stub": "tray-toolbar" }),
}));
vi.mock("./components/TrayActivityHeatmap", () => ({
  TrayActivityHeatmapLoader: () => createElement("div", { "data-stub": "heatmap" }),
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ themeId: "default", setTheme: vi.fn(), isLoading: false }),
}));

vi.mock("../hooks/useAppearanceTypography", () => ({
  useAppearanceTypography: () => ({
    typography: { fontSize: "md", fontFamily: "system" },
    setFontSize: vi.fn(),
    setFontFamily: vi.fn(),
    isLoading: false,
  }),
}));

const { I18nProvider } = await import("../i18n/I18nProvider");
const { TrayWindowMain } = await import("./TrayWindowMain");

const tEn = createTranslator("en");

const waitForUi = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("TrayWindowMain", () => {
  // Undefined for the source-scanning test, which renders nothing.
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    const mounted = root;
    if (mounted) {
      await act(async () => {
        mounted.unmount();
      });
    }
    container?.remove();
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
  });

  /**
   * @param resolveProfileAfterMount when true, `get-current-profile` settles only
   *   after the first commit — the ordering that made the profile key change from
   *   "" to a real id, which is what triggered the duplicate.
   */
  const render = async (resolveProfileAfterMount: boolean): Promise<void> => {
    const profileResult = { currentProfileId: "profile_1", currentProfile: null };
    let releaseProfile: () => void = vi.fn();
    const pendingProfile = new Promise<typeof profileResult>((resolve) => {
      releaseProfile = () => resolve(profileResult);
    });

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn(() => vi.fn()),
        getCurrentProfile: vi.fn(() =>
          resolveProfileAfterMount
            ? pendingProfile
            : Promise.resolve(profileResult),
        ),
        onActiveProfileChanged: vi.fn(() => vi.fn()),
        onSettingsUpdated: vi.fn(() => vi.fn()),
        // No connected provider: the card renders its empty state, which is all
        // this file needs — one card, whatever is inside it.
        getProviderStates: vi.fn().mockResolvedValue({}),
      },
    });

    const mountPoint = document.createElement("div");
    container = mountPoint;
    document.body.append(mountPoint);
    const mounted = createRoot(mountPoint);
    root = mounted;
    await act(async () => {
      mounted.render(
        createElement(I18nProvider, null, createElement(TrayWindowMain)),
      );
    });
    await waitForUi();

    if (resolveProfileAfterMount) {
      await act(async () => {
        releaseProfile();
        await pendingProfile;
      });
      await waitForUi();
    }
  };

  const cardTitleCount = (): number =>
    [...(container?.querySelectorAll("div") ?? [])].filter(
      (node) => node.textContent === tEn("tray.providers.title"),
    ).length;

  it("renders exactly one Providers card once the profile id resolves", async () => {
    await render(true);
    expect(cardTitleCount()).toBe(1);
  });

  it("renders exactly one Providers card when the profile id is known up front", async () => {
    await render(false);
    expect(cardTitleCount()).toBe(1);
  });

  it("keeps every profile-keyed sibling on a distinct key prefix", () => {
    // The bug was structural, not visual: two siblings keyed by the same value.
    // Asserting the count above only catches it for the card that happened to
    // lose the collision, so pin the arrangement itself.
    const source = readFileSync(
      join(import.meta.dirname, "TrayWindowMain.tsx"),
      "utf8",
    );
    const keys = [...source.matchAll(/key=\{`([^`]*)\$\{profileId\}`\}/g)].map(
      (match) => match[1],
    );
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
    // A bare `key={profileId}` is the shape that collided.
    expect(source).not.toContain("key={profileId}");
  });
});
