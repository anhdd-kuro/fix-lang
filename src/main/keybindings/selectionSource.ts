/**
 * @file selectionSource.ts
 * @description Pure, dependency-injected decision table for where a
 * transform's input text comes from: the Accessibility selection read
 * (`~/main/accessibility/selectedText`) first, the clipboard (⌘C) as a
 * user-configurable fallback. `resolveSelectedText`'s own dependencies
 * (`readAx`/`readClipboard`/`clipboardFallbackEnabled`) arrive as injected
 * parameters and are exercised in tests with plain `vi.fn()` fakes — no
 * `vi.mock` needed for them. The module itself is not Electron-free, though:
 * it imports `AccessibilityPermissionError` from
 * `~/main/notifications/error`, which transitively constructs a real
 * `electron-store` `Store` at module scope (via `~/main/i18n` →
 * `~/stores/localeStore`) and throws outside a real Electron `app`. Any test
 * that imports this module for the real error class needs the same three
 * `vi.mock` calls `selectionSource.test.ts` uses: `electron`,
 * `~/stores/localeStore`, and `~/main/webViewWindows/errorPopupWindow`.
 */
import { AccessibilityPermissionError } from "~/main/notifications/error";
import type { AxSelectedTextResult } from "~/main/accessibility/selectedText";

export type SelectionSource = "accessibility" | "clipboard";

/**
 * `selectedText` matches `SENSITIVE_KEY` in `~/shared/logging.ts`
 * (`selected[-_]?text`), so a caller that logs this outcome by spreading it
 * (`{ ...outcome }`) gets `[REDACTED]` from the structural redactor for
 * free — a bare `text` key would not match and would leak the user's
 * plaintext selection into the on-disk JSONL. This object is what the
 * hotkey handlers hold in a variable next to their existing structured
 * `logger.info` call, so keep the field named `selectedText`; do not rename
 * it back to `text`.
 */
export type SelectionOutcome =
  | { selectedText: string; source: SelectionSource }
  | {
      selectedText: null;
      source: null;
      reason: "secureField" | "axEmpty" | "clipboardEmpty";
    };

type ResolveSelectedTextDependencies = {
  readAx: () => Promise<AxSelectedTextResult>;
  readClipboard: () => Promise<string>;
  clipboardFallbackEnabled: boolean;
};

/**
 * Decides where a transform's input text comes from, in this fixed order:
 *
 * 1. AX reports a secure field — refuse outright, unconditionally. This
 *    check runs first, before even the non-blank-selection check below, on
 *    purpose: `AxSelectedTextResult` is a flat object, so a future producer
 *    change that (incorrectly) paired `status: "secure"` with a non-empty
 *    `selectedText` would still type-check. Checking `secure` before ever
 *    looking at `selectedText` means the refusal cannot depend on the
 *    producer keeping those two fields consistent — synthesizing ⌘C into a
 *    password field is the one irreversible mistake this module can make,
 *    so no setting, and no future producer bug, is allowed to route around
 *    it.
 * 2. AX has a non-blank selection — use it (untrimmed: whitespace is part
 *    of what the user selected, the trim below is only the emptiness test).
 * 3. Fallback disabled — refuse without ever touching the clipboard.
 * 4. Otherwise fall back to the clipboard.
 *
 * Whitespace-only AX text deliberately falls through to the fallback rather
 * than being returned: either the real selection is whitespace (⌘C would
 * read the same thing) or the app reported a spurious empty string.
 */
export const resolveSelectedText = async ({
  readAx,
  readClipboard,
  clipboardFallbackEnabled,
}: ResolveSelectedTextDependencies): Promise<SelectionOutcome> => {
  const ax = await readAx();

  if (ax.status === "secure") {
    return { selectedText: null, source: null, reason: "secureField" };
  }

  if (ax.status === "ok" && ax.selectedText.trim().length > 0) {
    return { selectedText: ax.selectedText, source: "accessibility" };
  }

  if (!clipboardFallbackEnabled) {
    // No ⌘C happens in this branch, so a revoked Accessibility permission
    // would otherwise never surface beyond a bare "No text selected" —
    // throw here so `handleError` still fires the actionable permission
    // dialog. With the fallback ON, the clipboard attempt below runs
    // instead and surfaces the same permission failure on its own.
    if (ax.permissionDenied) {
      // `ax.permissionDenied` is set by `isAxPermissionDenied`
      // (`~/main/accessibility/axPermission.ts`), which matches BOTH macOS
      // permission buckets: assistive-access denial (System Settings >
      // Privacy & Security > Accessibility) and Apple-event/Automation
      // denial for System Events (System Settings > Privacy & Security >
      // Automation, error -1743/-25211). This branch cannot tell which one
      // actually fired — that would require changing what
      // `isAxPermissionDenied`/`getAxSelectedText` reports — so the
      // devMessage below names both possibilities rather than asserting
      // the wrong one. The failure itself is in the AX attribute read
      // (`getAxSelectedText`), never in keystroke synthesis, which is why
      // the devMessage does not use the class default.
      throw new AccessibilityPermissionError(
        "Reading the Accessibility selection (kAXSelectedText) failed: " +
          "either the Accessibility permission or the Automation " +
          "(System Events) permission was denied or revoked.",
      );
    }

    return { selectedText: null, source: null, reason: "axEmpty" };
  }

  const clipboardText = await readClipboard();
  if (clipboardText.trim().length > 0) {
    return { selectedText: clipboardText, source: "clipboard" };
  }

  return { selectedText: null, source: null, reason: "clipboardEmpty" };
};
