/**
 * @file autocompleteModel.ts
 * @description Resolves which model ref an autocomplete request should use.
 *
 * Electron-free — shared by main, preload, and renderer.
 */
import { AUTOCOMPLETE_INHERIT_ASK_MODEL } from "~/features/autocomplete/shared/autocompleteSettings";

/**
 * Walks the inherit chain: the stored autocomplete ref, else the Ask AI preset's
 * ref, else the profile's global default.
 *
 * Three hops rather than two because Ask's own model may itself be the inherit
 * sentinel — a preset that follows the global default is the common case, so
 * stopping at Ask would resolve autocomplete to `""` and leave the caller to
 * rediscover the global default on its own.
 *
 * "Same as Ask" is stored as `""` and resolved here at request time, never
 * snapshotted: it is a default, so changing Ask's model must move autocomplete
 * with it. A named sentinel would be worse than verbose — `parseModelRef` reads
 * an unprefixed string as a bare model id, and `resolveModelRef` scans every
 * provider for a bare id, so `"ask"` could silently match a real model called
 * `ask`.
 *
 * Returns `""` when nothing is configured anywhere; callers treat that as "no
 * model selected" and make no request.
 */
export const resolveAutocompleteModelRef = (
  storedRef: string,
  askPresetRef: string,
  globalDefaultRef: string,
): string =>
  storedRef.trim() ||
  askPresetRef.trim() ||
  globalDefaultRef.trim() ||
  AUTOCOMPLETE_INHERIT_ASK_MODEL;
