/**
 * @file historyDb.ts
 * @description Electron-touching DB lifecycle for the SQLite history store.
 *
 * This is the ONLY history module that imports `electron` / `node:sqlite`. It
 * resolves the per-user writable DB path (under `app.getPath("userData")`, NOT
 * inside the code-signed app bundle) and exposes a lazy file-DB singleton plus
 * a repo singleton. Keeping this thin lets `historyRepo.ts` stay electron-free
 * and unit-testable against `:memory:`.
 *
 * node:sqlite emits an `ExperimentalWarning` at runtime; this is accepted (the
 * driver is the team's chosen backend) and intentionally not suppressed.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { createHistoryRepo, type HistoryRepo } from "./historyRepo";

let dbInstance: DatabaseSync | null = null;
let repoInstance: HistoryRepo | null = null;

/** Absolute path to the history SQLite file in the user's writable data dir. */
export const getHistoryDbPath = (): string =>
  path.join(app.getPath("userData"), "history.sqlite");

/** Lazy singleton: open the file DB once. */
export const getHistoryDb = (): DatabaseSync => {
  if (dbInstance === null) {
    dbInstance = new DatabaseSync(getHistoryDbPath());
  }
  return dbInstance;
};

/** Lazy singleton repository bound to the file DB. */
export const getHistoryRepo = (): HistoryRepo => {
  if (repoInstance === null) {
    repoInstance = createHistoryRepo(getHistoryDb());
  }
  return repoInstance;
};
