/**
 * @file dashboardTabIds.ts
 * @description The dashboard tab id union, owned in ONE place. Electron-free so
 * preload and renderer can both import it.
 *
 * Preload used to keep its own hand-copied union for `showMainWindowTab`. Both
 * copies compiled, so renaming a tab in the renderer left preload advertising
 * an id that no longer matched any tab: `DASHBOARD_TABS.findIndex` returned -1
 * and the tray button silently did nothing. Nothing but a click could catch it.
 * Tab ORDER and labels stay in `MainWindow/dashboardTabs.ts` — only the ids
 * live here, because only the ids cross the preload boundary.
 */
export type DashboardTabId =
  | "overview"
  | "history"
  | "models"
  | "usage"
  | "logs"
  | "about";
