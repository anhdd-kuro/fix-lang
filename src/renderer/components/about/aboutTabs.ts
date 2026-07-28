/**
 * @file aboutTabs.ts
 * @description PURE sub-tab logic for the dashboard's About tab, kept out of
 * the React component so it is unit-testable without a DOM testing library
 * (none is installed). Mirrors `usage/usageTabs.ts` and
 * `MainWindow/dashboardTabs.ts`.
 *
 * The About tab holds two unrelated readings: what version is installed and
 * how to move to a newer one (`updates`), and how to actually use the app
 * (`guide`). Updates stays FIRST and is the default, because the tray's
 * check-for-updates button and every release note link land on this tab
 * expecting the update controls to be what they see.
 */
import type { MessageKey } from "~/shared/i18n/message";

export type AboutTabId = "updates" | "guide";

export type AboutTabMeta = {
  id: AboutTabId;
  /** `about.tab.*` translation key — resolved via `t()` at render time. */
  labelKey: MessageKey;
};

export const ABOUT_TABS: readonly AboutTabMeta[] = Object.freeze([
  { id: "updates", labelKey: "about.tab.updates" },
  { id: "guide", labelKey: "about.tab.guide" },
] satisfies AboutTabMeta[]);

export const DEFAULT_ABOUT_TAB_ID: AboutTabId = "updates";

export const isAboutTabId = (value: unknown): value is AboutTabId =>
  ABOUT_TABS.some((tab) => tab.id === value);

/**
 * Resolve which sub-tab renders. Anything that is not a live tab id — null on
 * first render, a stale id from a renamed tab — falls back to the default
 * rather than blanking the panel.
 */
export const resolveActiveAboutTab = (current: unknown): AboutTabId =>
  isAboutTabId(current) ? current : DEFAULT_ABOUT_TAB_ID;
