import { readFile } from "node:fs/promises";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopyButton from "./CopyButton";
import { SettingTabBtn } from "./SettingTabBtn";

describe("Button behavioral wrappers", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  const render = async (element: ReactElement): Promise<HTMLButtonElement> => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(element);
    });

    const button = container.querySelector("button");
    if (button === null) {
      throw new Error("Expected the wrapper to render a native button");
    }
    return button;
  };

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = undefined;
    root = undefined;
    vi.restoreAllMocks();
  });

  it("keeps CopyButton keyboard-capable and delegates its copy handler once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const button = await render(
      createElement(CopyButton, {
        value: "Copied value",
        label: "Copy value",
        showLabel: true,
      }),
    );

    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Copy value");
    expect(button.title).toBe("Copy value");
    expect(button.className).toContain("focus-visible:ring-offset-background");

    await act(async () => {
      button.focus();
      button.click();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Copied value");
  });

  it("keeps SettingTabBtn selected state, tab semantics, and one activation", async () => {
    const onClick = vi.fn();
    const button = await render(
      createElement(SettingTabBtn, {
        icon: createElement("span", null, "icon"),
        label: "General",
        active: true,
        ariaControls: "settings-general",
        tabIndex: 0,
        id: "tab-general",
        onClick,
      }),
    );

    expect(button.type).toBe("button");
    expect(button.getAttribute("role")).toBe("tab");
    expect(button.getAttribute("aria-selected")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("settings-general");
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("focus-visible:ring-offset-background");

    await act(async () => {
      button.focus();
      button.click();
    });

    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "CopyButton",
      "src/renderer/components/CopyButton/index.tsx",
      [
        "variant={variant}",
        'type="button"',
        "aria-label={label}",
        "title={label}",
        "onClick={handleCopy}",
        "cursor-pointer",
        "min-w-6 min-h-6",
      ],
    ],
    [
      "TrashButton",
      "src/renderer/components/TrashButton.tsx",
      [
        'variant="destructive"',
        'type="button"',
        "onClick={onClick}",
        'aria-label={t("common.trashButton.ariaLabel")}',
        "flex items-center gap-2 rounded-md text-sm transition-colors",
        'showLabel ? "px-3 py-1.5" : "p-1"',
      ],
    ],
    [
      "SettingTabBtn",
      "src/renderer/components/SettingTabBtn.tsx",
      [
        'variant={active ? "primary" : "ghost"}',
        'role="tab"',
        'aria-selected={active ? "true" : "false"}',
        "aria-controls={ariaControls}",
        'type="button"',
        "onClick={onClick}",
        "py-1 min-w-min",
      ],
    ],
    [
      "SettingsButton",
      "src/renderer/components/SettingsIcon.tsx",
      [
        'variant="ghost"',
        'type="button"',
        "aria-label={resolvedTitle}",
        "title={resolvedTitle}",
        "onClick={onClick}",
        "rounded-md cursor-pointer",
      ],
    ],
    [
      "Dialog close",
      "src/renderer/components/Dialog.tsx",
      [
        'variant="ghost"',
        'type="button"',
        'aria-label={t("common.close")}',
        'title={t("common.close")}',
        "onClick={onClose}",
        "text-muted-foreground hover:text-foreground",
      ],
    ],
    [
      "HistoryReviewModal close",
      "src/renderer/components/HistoryReviewModal.tsx",
      [
        'variant="primary"',
        'type="button"',
        'aria-label={t("history.reviewModal.closeAriaLabel")}',
        "onClick={onClose}",
        "px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary",
      ],
    ],
    [
      "SettingsModal close",
      "src/renderer/components/SettingsModal.tsx",
      [
        'variant="ghost"',
        'type="button"',
        'aria-label={t("settings.modal.close")}',
        'title={t("settings.modal.close")}',
        "onClick={onClose}",
        "rounded-md p-1.5 text-muted-foreground hover:text-foreground",
      ],
    ],
    [
      "SettingsModal tabs",
      "src/renderer/components/SettingsModal.tsx",
      [
        'variant={isActive ? "primary" : "ghost"}',
        'role="tab"',
        'aria-selected": true',
        "aria-controls={`settings-${tab.id}`}",
        "onClick={() => setActiveTab(index)}",
        "grid-cols-2 gap-2",
      ],
    ],
    [
      "CorrectionResultWindow close",
      "src/renderer/CorrectionResultWindow/index.tsx",
      [
        'variant="outline"',
        'type="button"',
        "rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary",
        "onClick={() => window.electronAPI.closeCorrectionResultWindow()}",
        "closeCorrectionResultWindow()",
      ],
    ],
    [
      "dashboard tabs",
      "src/renderer/MainWindow/App.tsx",
      [
        'variant={isActive ? "primary" : "ghost"}',
        'role="tab"',
        "aria-selected={isActive}",
        "onClick={() => setActiveDashboardTab(index)}",
        "rounded-md px-3 py-1.5 text-sm",
      ],
    ],
    [
      "dashboard ranges",
      "src/renderer/MainWindow/App.tsx",
      [
        "SegmentedControl",
        "onChange={setRange}",
        'ariaLabel={t("dashboard.range.ariaLabel")}',
      ],
    ],
    [
      "TrayProviderSummary tabs",
      "src/renderer/TrayWindow/components/TrayProviderSummary.tsx",
      [
        'variant={isActive ? "primary" : "ghost"}',
        'type="button"',
        'role="tab"',
        "aria-selected={isActive}",
        "onClick={() => setChosenProvider(tab.provider)}",
        "rounded-md px-2 py-0.5 text-xs font-medium",
      ],
    ],
    [
      "TrayProviderSummary panel",
      "src/renderer/TrayWindow/components/TrayProviderSummary.tsx",
      [
        'variant="ghost"',
        'type="button"',
        "onClick={() => openUsageTab(activeProvider)}",
        "-mx-1 w-full rounded-md px-1 py-0.5 text-left hover:bg-accent",
      ],
    ],
    [
      "TrayIconButton",
      "src/renderer/TrayWindow/components/TrayToolbar.tsx",
      [
        'variant="ghost"',
        'type="button"',
        "onClick={onClick}",
        "disabled={disabled}",
        "aria-label={ariaLabel}",
        "rounded-md p-1.5 cursor-pointer",
      ],
    ],
  ])(
    "keeps the %s Button variant, behavior props, and caller geometry",
    async (_name, relativePath, expectedFragments) => {
      const source = await readFile(
        path.join(process.cwd(), relativePath),
        "utf8",
      );

      expect(source).toContain("<Button");
      for (const fragment of expectedFragments) {
        expect(source).toContain(fragment);
      }
    },
  );
});
