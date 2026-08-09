/**
 * @file recentActiveApps.ts
 * @description "Recently used apps" chips for the deny-list editor, so a user
 * blocking a password manager does not need to already know its bundle id.
 *
 * In-memory only, on purpose, and never persisted: a durable list of every
 * app the user has transformed text in would be a behavioural profile
 * written to disk as part of a *privacy* feature. It lives for the process
 * lifetime and nothing longer — restart FixLang and the list is empty again.
 */
import type { ActiveApp } from "~/main/accessibility/activeApp";

/** Chips shown in the deny-list editor; a handful is plenty, unbounded growth is not. */
export const RECENT_ACTIVE_APPS_MAX = 12;

let recent: ActiveApp[] = [];

const isSameApp = (a: ActiveApp, b: ActiveApp): boolean =>
  a.bundleId !== null && b.bundleId !== null ? a.bundleId === b.bundleId : a.name === b.name;

/**
 * Move `app` to the front of the MRU, deduplicating a repeat sighting rather
 * than growing the list, then drop anything past {@link RECENT_ACTIVE_APPS_MAX}.
 */
export const recordActiveApp = (app: ActiveApp): void => {
  recent = [app, ...recent.filter((entry) => !isSameApp(entry, app))].slice(
    0,
    RECENT_ACTIVE_APPS_MAX,
  );
};

/** Most-recently-seen first. A fresh array each call — never a live reference. */
export const getRecentActiveApps = (): readonly ActiveApp[] => [...recent];
