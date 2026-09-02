/**
 * @file statusDescriptor.ts
 * @description Shared locale-free status/error descriptor for action-result
 * banners across Settings components (SettingGeneral, SettingCorrection,
 * SettingPromptGen, HotkeyInput). Replaces the pattern of storing an
 * already-`t()`-resolved string in `useState` — that freezes the message
 * into whatever locale was active when the action ran, so a later language
 * switch leaves a stale-locale banner sitting on screen until the next
 * action re-triggers it. Storing a descriptor instead and resolving it via
 * `resolveStatus()` during render keeps the banner locale-correct on every
 * render, including immediately after a locale switch. See the fixlang-i18n
 * skill's "aggregations return descriptors, never prose" note.
 *
 * `plain` is a single catalog message rendered as-is via `tm()`. `wrapped`
 * composes the generic `"settings.general.error"` ("Error: {message}")
 * template around a `Label` at render time — this lets a provider/IPC
 * -reported error (raw text, a `Label` "text" case) and a catalog fallback
 * (translated, a `Label` "message" case) share one wrapper without either
 * half freezing into a string before render.
 */
import { msg, type Label, type Message, type MessageKey, type MessageParams, type Translate } from "~/features/i18n/shared/message";

export type StatusDescriptor =
  | { kind: "plain"; message: Message }
  | { kind: "wrapped"; reason: Label };

/** Builds a `StatusDescriptor` for a single catalog message (no wrapper). */
export const plainStatus = (key: MessageKey, params?: MessageParams): StatusDescriptor => ({
  kind: "plain",
  message: msg(key, params),
});

/** Builds a `StatusDescriptor` that wraps `reason` in the generic "settings.general.error" template. */
export const wrappedError = (reason: Label): StatusDescriptor => ({ kind: "wrapped", reason });

/**
 * Resolves a `StatusDescriptor` to display text. Call only during render
 * (never inside a `useMemo`/`useCallback` unless `t`/`tm`/`tl` are also in
 * its dependency array) so it always reflects the currently active locale.
 */
export const resolveStatus = (
  status: StatusDescriptor | null,
  t: Translate,
  tm: (message: Message) => string,
  tl: (label: Label) => string,
): string => {
  if (!status) return "";
  return status.kind === "plain"
    ? tm(status.message)
    : t("settings.general.error", { message: tl(status.reason) });
};
