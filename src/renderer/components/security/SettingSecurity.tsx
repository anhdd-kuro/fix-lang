/**
 * @file SettingSecurity.tsx
 * @description Settings → Security: one scrolling page configuring all four
 * guard rails (stale-clipboard age, selection size cap, app deny-list, secret
 * guard). Self-fetching load/error/ready panel, same shape as
 * `AutocompletePanel.tsx`.
 *
 * Configuration only. What the guards DID is the Security dashboard tab
 * (`SecurityStatsPanel.tsx`), which reads the persisted logs and never writes
 * either store.
 *
 * All derivation — the age/size guard's "running" vs. "disabled" hint, the
 * deny-list's empty states, the secret guard's mask hint, and the
 * `isBundleIdDenied`-derived chip state — lives in `securityView.ts`, which
 * returns `StatusDescriptor`s rather than resolved strings. Nothing here
 * stores a `t()`-resolved string in `useState`: the load/error/ready
 * discriminant and the two settings objects are the only React state, and
 * every piece of copy is resolved fresh on every render via `t()`/`resolve()`
 * — see `statusDescriptor.ts` for the locale-switch regression this pattern
 * exists to prevent.
 *
 * Neither the preload bridge nor the main `get` handler for either store
 * wraps its call in try/catch (see `~/features/guards/preload/guards.ts` and
 * `~/features/secretGuard/preload/secretGuard.ts`), so a thrown main-process
 * error reaches this panel as an uncaught rejected promise. This panel is the
 * first live caller of both bridges, so every load and every persist below
 * is wrapped in its own try/catch rather than assuming the bridge already
 * handled it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  normalizeBundleId,
} from "~/features/guards/shared/guardSettings";
import { DEFAULT_SECRET_GUARD_SETTINGS, SECRET_GUARD_MODES } from "~/features/secretGuard/shared/secretGuardSettings";
import {
  resolveSecurityView,
  withDeniedBundleId,
  withoutDeniedBundleId,
  type RecentAppChip,
} from "./securityView";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import { SegmentedControl } from "../SegmentedControl";
import { plainStatus, resolveStatus, wrappedError, type StatusDescriptor } from "../statusDescriptor";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type { SecretGuardMode, SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      guardSettings: SelectionGuardSettings;
      secretSettings: SecretGuardSettings;
      recentApps: ActiveApp[];
    };

/**
 * Outcome of one settings-store write, used to combine the two
 * `handleRestoreDefaults` writes into a single order-independent status —
 * see the comment above that handler for why arrival order must not decide
 * what the user is told.
 */
type PersistResult = { success: true } | { success: false; error: StatusDescriptor };

const defaultGuardSettings = (): SelectionGuardSettings => ({
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
});

const recentAppChipKey = (chip: RecentAppChip, index: number): string =>
  chip.app.bundleId ?? `${chip.app.name}-${String(index)}`;

export const SettingSecurity = () => {
  const { t, tm, tl } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saveStatus, setSaveStatus] = useState<StatusDescriptor | null>(null);
  const [newBundleId, setNewBundleId] = useState("");

  /**
   * The only path that may hold a pending `flashSaved` timeout — a ref
   * rather than state because scheduling/clearing it must never itself
   * trigger a render. Every write to `saveStatus` goes through `setStatus`
   * below instead of calling `setSaveStatus` directly, so a later status
   * (e.g. a `handleRestoreDefaults` partial-failure message) always cancels
   * an earlier flash's still-pending timeout instead of racing it — see the
   * doc comment on `handleRestoreDefaults` for the user-facing failure this
   * prevents.
   */
  const saveStatusTimeoutRef = useRef<number | null>(null); // `window.setTimeout` returns a number, not Node's `Timeout`.

  const clearSaveStatusTimeout = (): void => {
    if (saveStatusTimeoutRef.current !== null) {
      window.clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = null;
    }
  };

  useEffect(() => clearSaveStatusTimeout, []);

  const setStatus = (status: StatusDescriptor | null): void => {
    clearSaveStatusTimeout();
    setSaveStatus(status);
  };

  const resolve = (status: StatusDescriptor | null): string => resolveStatus(status, t, tm, tl);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setState({ status: "loading" });
      try {
        const [guardSettings, secretSettings, recentApps] = await Promise.all([
          window.electronAPI.getSelectionGuards(),
          window.electronAPI.getSecretGuardSettings(),
          window.electronAPI.getRecentActiveApps(),
        ]);
        if (!cancelled) {
          setState({ status: "ready", guardSettings, secretSettings, recentApps });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const flashSaved = (): void => {
    setStatus(plainStatus("security.saved"));
    saveStatusTimeoutRef.current = window.setTimeout(() => setStatus(null), 2000);
  };

  /**
   * Writes the selection-guard store and reports the outcome instead of
   * touching `saveStatus` itself. `persistGuardSettings` (below) is the only
   * single-write caller and still flashes/sets status right away; when both
   * stores are written together (`handleRestoreDefaults`), the caller waits
   * for both `PersistResult`s before deriving one status, so a fast success
   * can never overwrite a slower failure's message.
   */
  const persistGuardResult = async (
    next: SelectionGuardSettings,
    previous: SelectionGuardSettings,
  ): Promise<PersistResult> => {
    setState((current) => (current.status === "ready" ? { ...current, guardSettings: next } : current));
    try {
      const result = await window.electronAPI.setSelectionGuards(next);
      if (result.success) return { success: true };
      setState((current) =>
        current.status === "ready" ? { ...current, guardSettings: previous } : current,
      );
      return {
        success: false,
        error: result.error ? wrappedError(result.error) : plainStatus("security.saveError"),
      };
    } catch {
      setState((current) =>
        current.status === "ready" ? { ...current, guardSettings: previous } : current,
      );
      return { success: false, error: plainStatus("security.saveError") };
    }
  };

  /** Secret-guard-store counterpart of `persistGuardResult` — see its doc comment. */
  const persistSecretResult = async (
    next: SecretGuardSettings,
    previous: SecretGuardSettings,
  ): Promise<PersistResult> => {
    setState((current) => (current.status === "ready" ? { ...current, secretSettings: next } : current));
    try {
      const result = await window.electronAPI.setSecretGuardSettings(next);
      if (result.success) return { success: true };
      setState((current) =>
        current.status === "ready" ? { ...current, secretSettings: previous } : current,
      );
      return {
        success: false,
        error: result.error ? wrappedError(result.error) : plainStatus("security.saveError"),
      };
    } catch {
      setState((current) =>
        current.status === "ready" ? { ...current, secretSettings: previous } : current,
      );
      return { success: false, error: plainStatus("security.saveError") };
    }
  };

  const persistGuardSettings = async (
    next: SelectionGuardSettings,
    previous: SelectionGuardSettings,
  ): Promise<void> => {
    const result = await persistGuardResult(next, previous);
    if (result.success) {
      flashSaved();
    } else {
      setStatus(result.error);
    }
  };

  const persistSecretSettings = async (
    next: SecretGuardSettings,
    previous: SecretGuardSettings,
  ): Promise<void> => {
    const result = await persistSecretResult(next, previous);
    if (result.success) {
      flashSaved();
    } else {
      setStatus(result.error);
    }
  };

  const view = useMemo(
    () =>
      state.status === "ready"
        ? resolveSecurityView(state.guardSettings, state.secretSettings, state.recentApps)
        : null,
    [state],
  );

  if (state.status === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">{t("security.loading")}</p>;
  }

  if (state.status === "error" || view === null) {
    return <p className="p-4 text-sm text-muted-foreground">{t("security.error.loadFailed")}</p>;
  }

  const { guardSettings, secretSettings } = state;

  const handleClipboardAgeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(event.target.value);
    const clipboardMaxAgeSeconds = Number.isFinite(raw)
      ? Math.max(0, Math.floor(raw))
      : guardSettings.clipboardMaxAgeSeconds;
    void persistGuardSettings({ ...guardSettings, clipboardMaxAgeSeconds }, guardSettings);
  };

  const handleSelectionSizeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(event.target.value);
    const maxSelectionChars = Number.isFinite(raw)
      ? Math.max(0, Math.floor(raw))
      : guardSettings.maxSelectionChars;
    void persistGuardSettings({ ...guardSettings, maxSelectionChars }, guardSettings);
  };

  const canAddBundleId = normalizeBundleId(newBundleId) !== null;

  const handleAddDeniedApp = (): void => {
    const next = withDeniedBundleId(guardSettings, newBundleId);
    if (next === guardSettings) return;
    setNewBundleId("");
    void persistGuardSettings(next, guardSettings);
  };

  const handleRemoveDeniedApp = (bundleId: string): void => {
    const next = withoutDeniedBundleId(guardSettings, bundleId);
    if (next === guardSettings) return;
    void persistGuardSettings(next, guardSettings);
  };

  const handleToggleRecentApp = (chip: RecentAppChip): void => {
    if (chip.app.bundleId === null) return;
    const next = chip.blocked
      ? withoutDeniedBundleId(guardSettings, chip.app.bundleId)
      : withDeniedBundleId(guardSettings, chip.app.bundleId);
    if (next === guardSettings) return;
    void persistGuardSettings(next, guardSettings);
  };

  const handleModeChange = (mode: SecretGuardMode): void => {
    void persistSecretSettings({ ...secretSettings, mode }, secretSettings);
  };

  const handleHighEntropyChange = (highEntropyRule: boolean): void => {
    void persistSecretSettings({ ...secretSettings, highEntropyRule }, secretSettings);
  };

  /**
   * Fires both restore writes concurrently — concurrency is not the defect,
   * an unsequenced shared write is. `Promise.all` waits for BOTH
   * `PersistResult`s before touching `saveStatus`, so the derived status
   * depends only on which write(s) failed, never on which one happened to
   * settle last. A failure always wins over a success: restoring is not
   * "done" if either store silently reverted, and "Saved." must never be
   * shown while one guard is actually still off.
   */
  const handleRestoreDefaults = (): void => {
    void (async () => {
      const [guardResult, secretResult] = await Promise.all([
        persistGuardResult(defaultGuardSettings(), guardSettings),
        persistSecretResult({ ...DEFAULT_SECRET_GUARD_SETTINGS }, secretSettings),
      ]);

      if (guardResult.success && secretResult.success) {
        flashSaved();
        return;
      }
      if (!guardResult.success && !secretResult.success) {
        setStatus(plainStatus("security.saveError"));
        return;
      }
      setStatus(
        guardResult.success
          ? plainStatus("security.restorePartial.secretFailed")
          : plainStatus("security.restorePartial.guardFailed"),
      );
    })();
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
      {/* 1. Blocked apps */}
      <section className="flex flex-col gap-3 rounded-lg border border-card-control-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("security.deniedApps.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("security.deniedApps.description")}</p>

        {view.deniedApps.deniedBundleIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{resolve(view.deniedApps.listHint)}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {view.deniedApps.deniedBundleIds.map((bundleId) => (
              <span
                key={bundleId}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground"
              >
                {bundleId}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("security.deniedApps.removeLabel", { app: bundleId })}
                  onClick={() => handleRemoveDeniedApp(bundleId)}
                  className="px-1 py-0 text-xs leading-none"
                >
                  ×
                </Button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newBundleId}
            onChange={(event) => setNewBundleId(event.target.value)}
            placeholder={t("security.deniedApps.addPlaceholder")}
            aria-label={t("security.deniedApps.addLabel")}
            className="flex-1 rounded border border-control-border bg-input p-1 text-sm text-foreground"
          />
          <Button type="button" variant="secondary" disabled={!canAddBundleId} onClick={handleAddDeniedApp}>
            {t("security.deniedApps.addLabel")}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-card-foreground">
            {t("security.deniedApps.recentHeading")}
          </h3>
          {view.deniedApps.recentApps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{resolve(view.deniedApps.recentHint)}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {view.deniedApps.recentApps.map((chip, index) => (
                <Button
                  key={recentAppChipKey(chip, index)}
                  type="button"
                  variant={chip.blocked ? "destructive" : "secondary"}
                  aria-pressed={chip.blocked}
                  disabled={chip.app.bundleId === null}
                  onClick={() => handleToggleRecentApp(chip)}
                  className="rounded-full px-3 py-1 text-sm"
                >
                  {chip.app.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. Stale clipboard */}
      <section className="flex flex-col gap-3 rounded-lg border border-card-control-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("security.clipboardAge.title")}
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="security-clipboard-age" className="text-sm text-card-foreground">
            {t("security.clipboardAge.limitLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="security-clipboard-age"
              type="number"
              min={0}
              value={view.clipboardAge.maxAgeSeconds}
              onChange={handleClipboardAgeChange}
              className="w-24 rounded border border-control-border bg-input p-1 text-foreground"
            />
            <span className="text-sm text-muted-foreground">
              {t("security.clipboardAge.limitUnit")}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{resolve(view.clipboardAge.hint)}</p>
      </section>

      {/* 3. Large selections */}
      <section className="flex flex-col gap-3 rounded-lg border border-card-control-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("security.selectionSize.title")}
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="security-selection-size" className="text-sm text-card-foreground">
            {t("security.selectionSize.limitLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="security-selection-size"
              type="number"
              min={0}
              value={view.selectionSize.maxChars}
              onChange={handleSelectionSizeChange}
              className="w-32 rounded border border-control-border bg-input p-1 text-foreground"
            />
            <span className="text-sm text-muted-foreground">
              {t("security.selectionSize.limitUnit")}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{resolve(view.selectionSize.hint)}</p>
      </section>

      {/* 4. Secret guard */}
      <section className="flex flex-col gap-3 rounded-lg border border-card-control-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("security.secretGuard.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("security.secretGuard.description")}</p>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-card-foreground">{t("security.secretGuard.mode.label")}</span>
          <SegmentedControl
            value={view.secretGuard.mode}
            onChange={handleModeChange}
            ariaLabel={t("security.secretGuard.mode.label")}
            options={SECRET_GUARD_MODES.map((mode) => ({
              value: mode,
              label: t(`security.secretGuard.mode.${mode}`),
            }))}
          />
        </div>
        {view.secretGuard.maskHint && (
          <p className="text-sm text-muted-foreground">{resolve(view.secretGuard.maskHint)}</p>
        )}

        <Checkbox
          checked={view.secretGuard.highEntropyRule}
          onChange={handleHighEntropyChange}
          label={t("security.secretGuard.highEntropy.label")}
          className="text-card-foreground"
        />
        <p className="text-sm text-muted-foreground">{t("security.secretGuard.highEntropy.hint")}</p>

        <div className="flex flex-col gap-1 rounded-md bg-background/60 p-3">
          <h3 className="text-sm font-semibold text-card-foreground">
            {t("security.secretGuard.limitations.title")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("security.secretGuard.limitations.body")}
          </p>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={handleRestoreDefaults}>
          {t("security.restoreDefaults")}
        </Button>
        <span className="text-sm text-muted-foreground" role="status">
          {resolve(saveStatus)}
        </span>
      </div>
    </div>
  );
};
