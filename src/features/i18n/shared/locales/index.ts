/**
 * @file locales/index.ts
 * @description Merges the per-namespace JSON catalogs into one flat catalog per locale.
 *
 * Catalogs are split by namespace file so that separate features can add keys
 * without fighting over a single JSON blob. Keys stay globally unique and
 * dotted (`"tray.toolbar.title"`) — the namespace is the file, not a nesting level.
 *
 * Type note: TypeScript widens JSON string *values* to `string`, so the key
 * union below is type-checked but interpolation placeholders are not. Parity of
 * placeholders across locales is enforced by `locales.test.ts` instead.
 */

import enCommon from "./en/common.json";
import enDashboard from "./en/dashboard.json";
import enHistory from "./en/history.json";
import enLogs from "./en/logs.json";
import enModels from "./en/models.json";
import enNotifications from "./en/notifications.json";
import enProfiles from "./en/profiles.json";
import enSettings from "./en/settings.json";
import enTray from "./en/tray.json";
import enUsage from "./en/usage.json";
import jaCommon from "./ja/common.json";
import jaDashboard from "./ja/dashboard.json";
import jaHistory from "./ja/history.json";
import jaLogs from "./ja/logs.json";
import jaModels from "./ja/models.json";
import jaNotifications from "./ja/notifications.json";
import jaProfiles from "./ja/profiles.json";
import jaSettings from "./ja/settings.json";
import jaTray from "./ja/tray.json";
import jaUsage from "./ja/usage.json";
import type { Locale } from "../registry";

/** English is the source of truth: every key must exist here. */
export const EN_CATALOG = {
  ...enCommon,
  ...enDashboard,
  ...enHistory,
  ...enLogs,
  ...enModels,
  ...enNotifications,
  ...enProfiles,
  ...enSettings,
  ...enTray,
  ...enUsage,
};

/**
 * Every translatable key in the app.
 *
 * A typo or removed key is a compile error at every `t()` call site.
 */
export type TranslationKey = keyof typeof EN_CATALOG;

/**
 * Non-default locales are partial on purpose: a new language can ship
 * incrementally and fall back to English. `ja` completeness is enforced by test,
 * not by the type system.
 */
export const JA_CATALOG: Partial<Record<TranslationKey, string>> = {
  ...jaCommon,
  ...jaDashboard,
  ...jaHistory,
  ...jaLogs,
  ...jaModels,
  ...jaNotifications,
  ...jaProfiles,
  ...jaSettings,
  ...jaTray,
  ...jaUsage,
};

export const CATALOGS: Record<Locale, Partial<Record<TranslationKey, string>>> =
  {
    en: EN_CATALOG,
    ja: JA_CATALOG,
  };

/** Namespace file stems, used by the catalog integrity tests. */
export const CATALOG_NAMESPACES = [
  "common",
  "dashboard",
  "history",
  "logs",
  "models",
  "notifications",
  "profiles",
  "settings",
  "tray",
  "usage",
] as const;
