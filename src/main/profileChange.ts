/**
 * @file profileChange.ts
 * @description The one chokepoint every profile activation goes through — the
 * profile-switch global hotkey, `apply-profile`, and `switch-to-next-profile`.
 *
 * It exists because activating a profile has obligations beyond telling the
 * renderers. Any Ask AI input window still waiting for the user to type must
 * be dismissed: that window holds a `runAskFlow` callback which captured the
 * OLD profile's preset (its name, output mode and markdown preference) while
 * `fixGrammar(message, preset.id)` re-resolves that id against whatever
 * profile is active at SUBMIT time. Leave it open across a switch and the
 * selection captured under profile A goes out through profile B's model,
 * provider and API key — one request the user never authorized against that
 * provider, plus a history row whose preset and model disagree.
 *
 * A running Combo has the same problem one step further out (E5): each step
 * re-resolves its `presetId` against the LIVE profile via `fixGrammar`, so a
 * profile switch mid-chain would send a later step through another
 * profile's model, provider and key. `abortActiveCombo()` stops that chain
 * here, before the broadcast, rather than leaving each hotkey handler to
 * remember to subscribe on its own.
 *
 * Broadcasting directly instead of calling this helper is what a
 * `profileChange.test.ts` guard forbids: three sites already had to remember
 * this, and a fourth would have skipped it silently.
 */
import { ACTIVE_PROFILE_CHANGED } from "~/features/core/shared/ipcChannels";
import { abortActiveCombo } from "./keybindings/comboCancel";
import { dismissAskInputWindow } from "./webViewWindows/askInputWindow";
import { broadcastToAllWindows } from "./webViewWindows/broadcast";

/**
 * Dismisses any pending Ask AI input, aborts an in-flight Combo run, then
 * tells every window the active profile changed. Dismissal and abort come
 * first so nothing stale (a submittable question, a chain mid-step) can act
 * against the new profile before the renderers even hear about it.
 */
export const notifyActiveProfileChanged = (): void => {
  dismissAskInputWindow();
  abortActiveCombo();
  broadcastToAllWindows(ACTIVE_PROFILE_CHANGED);
};
