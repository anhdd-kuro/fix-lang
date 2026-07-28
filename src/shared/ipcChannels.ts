/**
 * @file ipcChannels.ts
 * @description Channel names shared by main and preload. Electron-free.
 *
 * Most channels in this app are string literals at both ends, which is fine
 * while each has exactly one sender and one listener. `ACTIVE_PROFILE_CHANGED`
 * is not: it is raised from three unrelated main-process paths (the
 * `apply-profile` handler, the `switch-to-next-profile` handler, and the global
 * hotkey, which never passes through preload) and consumed by windows that must
 * drop credential-scoped state. A typo at any one of those ends would leave a
 * window showing another profile's data with no error anywhere.
 */

/**
 * The ACTIVE profile changed, so every profile-scoped thing differs now:
 * API/admin keys, presets, cached models, history. Distinct from
 * `profile-updated`, which means the profile LIST was edited.
 */
export const ACTIVE_PROFILE_CHANGED = "active-profile-changed";
