// Preload-boundary guard for `Label`-typed IPC result fields.
import { isLabel, type Label } from "~/features/i18n/shared/message";

/**
 * Narrows a raw `error` field from `ipcRenderer.invoke(...)` to a `Label`,
 * dropping it (returning `undefined`) when malformed. Main is trusted code
 * in this app, but the preload boundary is where this codebase validates IPC
 * payload shapes (see `isMessage`/`isUpdateState` in `~/features/update/shared/update.ts`) —
 * a shape mismatch here should degrade to "no error text" rather than reach
 * `tl()`/`resolveLabel()` with something they do not expect.
 */
export const asLabel = (value: unknown): Label | undefined =>
  isLabel(value) ? value : undefined;
