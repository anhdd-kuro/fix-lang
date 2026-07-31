/**
 * @file profileChange.ts
 * @description The one chokepoint every profile activation goes through — the
 * profile-switch global hotkey, `apply-profile`, and `switch-to-next-profile`.
 *
 * It exists because activating a profile has a second obligation beyond
 * telling the renderers: any Ask AI input window still waiting for the user to
 * type must be dismissed. That window holds a `runAskFlow` callback which
 * captured the OLD profile's preset (its name, output mode and markdown
 * preference) while `fixGrammar(message, preset.id)` re-resolves that id
 * against whatever profile is active at SUBMIT time. Leave it open across a
 * switch and the selection captured under profile A goes out through profile
 * B's model, provider and API key — one request the user never authorized
 * against that provider, plus a history row whose preset and model disagree.
 *
 * Broadcasting directly instead of calling this helper is what a
 * `profileChange.test.ts` guard forbids: three sites already had to remember
 * this, and a fourth would have skipped it silently.
 */
import { abortAutocomplete } from "~/features/autocomplete/main/service";
import { ACTIVE_PROFILE_CHANGED } from "~/features/core/shared/ipcChannels";
import { dismissAskInputWindow } from "./webViewWindows/askInputWindow";
import { broadcastToAllWindows } from "./webViewWindows/broadcast";

/**
 * Dismisses any pending Ask AI input, then tells every window the active
 * profile changed. Dismissal comes first so no renderer can act on the new
 * profile while a stale question is still submittable.
 */
export const notifyActiveProfileChanged = (): void => {
  dismissAskInputWindow();
  // Same reasoning as the dismissal above, one layer down: a suggestion
  // resolved after the switch would carry profile A's model into a window now
  // scoped to B, and the next request would resolve its ref against B's
  // providers.
  abortAutocomplete();
  broadcastToAllWindows(ACTIVE_PROFILE_CHANGED);
};
