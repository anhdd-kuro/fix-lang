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
 * The deny-list has three ways in: a typed bundle id, the native `.app`
 * picker (`chooseDeniedApps`), and a drop of `.app` bundles onto the Blocked
 * apps section. The last two only ever hand PATHS to main, which re-validates
 * them and reads `CFBundleIdentifier` itself — this panel never learns a path
 * except through `getAppBundlePathForFile` (Electron 43 removed `File.path`),
 * and never derives a bundle id from a filename.
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
  MAX_DENIED_BUNDLE_IDS,
  normalizeBundleId,
} from "~/features/guards/shared/guardSettings";
import { DEFAULT_SECRET_GUARD_SETTINGS, SECRET_GUARD_MODES } from "~/features/secretGuard/shared/secretGuardSettings";
import {
  SECRET_GUARD_LIMITATION_KEYS,
  resolveSecurityView,
  withDeniedBundleIds,
  withoutDeniedBundleId,
  type RecentAppChip,
} from "./securityView";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import { Input } from "../Input";
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

/**
 * `derivesFromBase: false` marks a write whose payload does not read the
 * current settings at all — only Restore defaults. Ordinary writes must refuse
 * when the store cannot be read, because they persist the WHOLE object and
 * would otherwise carry a rejected value into it. Restore has nothing to carry,
 * so gating it on a readable store would disable the one control whose job is
 * to escape a store the panel can no longer read.
 */
type WriteOptions = { readonly derivesFromBase?: boolean };

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
  const [isDropTarget, setIsDropTarget] = useState(false);

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

  /**
   * The latest settings each store is believed to hold, tracked synchronously
   * alongside `state` because React state is not readable synchronously.
   *
   * Every write persists the WHOLE settings object, so a write whose payload
   * was built from a stale copy silently erases whatever landed in between.
   * These refs are the base each queued write builds on — see `runGuardWrite`
   * for why the base is read when the write RUNS rather than when the user
   * acted.
   */
  const latestGuardSettingsRef = useRef<SelectionGuardSettings | null>(null);

  /** Secret-guard counterpart of `latestGuardSettingsRef`, for the same reason. */
  const latestSecretSettingsRef = useRef<SecretGuardSettings | null>(null);

  /**
   * Whether the matching `latest*SettingsRef` is still believed to match the
   * store. Cleared the moment a write fails, and restored only by a
   * successful re-read. A write refuses to run on an untrusted base rather
   * than persisting a whole object assembled around a value the store
   * rejected — see `reconcileGuardFromStore`.
   */
  const guardBaseTrustedRef = useRef(true);
  const secretBaseTrustedRef = useRef(true);

  /**
   * Serializes writes to each store: one in flight at a time, next one starts
   * only after the previous has settled AND recovered.
   *
   * Concurrency here was never a feature — it is what made a failed write
   * unrecoverable. While two writes overlap, no rewind target is trustworthy
   * (it may be the other writer's optimistic state), and a failure's recovery
   * races the next write's payload. Queuing removes the overlap instead of
   * trying to referee it, which is why there is no longer a write revision to
   * compare: a reconcile can no longer be superseded, because nothing else is
   * running while it happens.
   */
  const guardWriteChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const secretWriteChainRef = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Monotonic id for whoever currently owns `saveStatus`. Completions are not
   * ordered, so without this an older success can erase a newer failure's
   * message — the live region would announce "Saved." for a write that failed.
   * Each user-initiated mutation claims the status and only reports if it
   * still holds it when its promise settles.
   */
  const statusRevisionRef = useRef(0);

  const claimStatus = (): (() => boolean) => {
    const revision = ++statusRevisionRef.current;
    return () => statusRevisionRef.current === revision;
  };

  /**
   * Re-reads the authoritative store after a failed write instead of rewinding
   * to whatever `previous` that write happened to capture.
   *
   * No rewind target computed by a writer can be trusted: it may itself be
   * another writer's optimistic state, so rewinding to it re-installs a value
   * the store never held. Only the store knows what actually persisted, so on
   * failure we ask it.
   *
   * Returns the settings on success and `null` when the re-read ITSELF fails.
   * That case is the one that must not be swallowed: the panel is then showing
   * a value the store rejected and has no way to learn the real one, so trust
   * stays revoked and the next write refuses rather than persisting a whole
   * object built around that phantom.
   */
  const reconcileGuardFromStore = async (): Promise<SelectionGuardSettings | null> => {
    try {
      const stored = await window.electronAPI.getSelectionGuards();
      latestGuardSettingsRef.current = stored;
      guardBaseTrustedRef.current = true;
      setState((current) =>
        current.status === "ready" ? { ...current, guardSettings: stored } : current,
      );
      return stored;
    } catch {
      // The write error is already being reported; a failed re-read must not
      // replace it with a second, less useful message — but it must not be
      // mistaken for a recovery either.
      guardBaseTrustedRef.current = false;
      return null;
    }
  };

  /** Secret-guard counterpart of `reconcileGuardFromStore` — see its doc comment. */
  const reconcileSecretFromStore = async (): Promise<SecretGuardSettings | null> => {
    try {
      const stored = await window.electronAPI.getSecretGuardSettings();
      latestSecretSettingsRef.current = stored;
      secretBaseTrustedRef.current = true;
      setState((current) =>
        current.status === "ready" ? { ...current, secretSettings: stored } : current,
      );
      return stored;
    } catch {
      secretBaseTrustedRef.current = false;
      return null;
    }
  };

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
          latestGuardSettingsRef.current = guardSettings;
          latestSecretSettingsRef.current = secretSettings;
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

  /**
   * Runs one selection-guard write, queued behind every earlier one.
   *
   * `update` receives the base settings and is called when this write's turn
   * comes, NOT when the user acted. That is the whole point: by then every
   * earlier write has settled and, if it failed, has already reconciled — so
   * the base is what the store holds rather than a value some other writer
   * optimistically installed and may yet have rejected. Returning `null` from
   * `update` means "nothing to do" and skips the write entirely.
   *
   * Resolves to `null` for a skipped write, so callers can tell "no change was
   * needed" apart from "the change was saved".
   */
  const runGuardWrite = (
    update: (base: SelectionGuardSettings) => SelectionGuardSettings | null,
    options: WriteOptions = {},
  ): Promise<PersistResult | null> => {
    const task = guardWriteChainRef.current.then(async (): Promise<PersistResult | null> => {
      // An untrusted base means an earlier failure's re-read also failed. Try
      // once more rather than persisting a whole object built around a value
      // the store already rejected; if that read fails too, refuse the write.
      const base = guardBaseTrustedRef.current
        ? latestGuardSettingsRef.current ?? guardSettings
        : await reconcileGuardFromStore();
      if (base === null && options.derivesFromBase !== false) {
        return { success: false, error: plainStatus("security.saveError") };
      }

      // A pure updater over plain objects should not throw, but if one ever
      // does, the queue must report it rather than reject this task — the
      // callers are fire-and-forget, so a rejection would surface as an
      // unhandled one AND leave the claimed status line silent.
      let next: SelectionGuardSettings | null;
      try {
        next = update(base ?? defaultGuardSettings());
      } catch {
        return { success: false, error: plainStatus("security.saveError") };
      }
      if (next === null) return null;

      latestGuardSettingsRef.current = next;
      setState((current) =>
        current.status === "ready" ? { ...current, guardSettings: next } : current,
      );

      try {
        const result = await window.electronAPI.setSelectionGuards(next);
        if (result.success) return { success: true };
        guardBaseTrustedRef.current = false;
        await reconcileGuardFromStore();
        return {
          success: false,
          error: result.error ? wrappedError(result.error) : plainStatus("security.saveError"),
        };
      } catch {
        guardBaseTrustedRef.current = false;
        await reconcileGuardFromStore();
        return { success: false, error: plainStatus("security.saveError") };
      }
    });
    // The chain must never reject, or one thrown write would wedge the queue
    // shut for the rest of the session.
    guardWriteChainRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  /** Secret-guard-store counterpart of `runGuardWrite` — see its doc comment. */
  const runSecretWrite = (
    update: (base: SecretGuardSettings) => SecretGuardSettings | null,
    options: WriteOptions = {},
  ): Promise<PersistResult | null> => {
    const task = secretWriteChainRef.current.then(async (): Promise<PersistResult | null> => {
      const base = secretBaseTrustedRef.current
        ? latestSecretSettingsRef.current ?? secretSettings
        : await reconcileSecretFromStore();
      if (base === null && options.derivesFromBase !== false) {
        return { success: false, error: plainStatus("security.saveError") };
      }

      let next: SecretGuardSettings | null;
      try {
        next = update(base ?? DEFAULT_SECRET_GUARD_SETTINGS);
      } catch {
        return { success: false, error: plainStatus("security.saveError") };
      }
      if (next === null) return null;

      latestSecretSettingsRef.current = next;
      setState((current) =>
        current.status === "ready" ? { ...current, secretSettings: next } : current,
      );

      try {
        const result = await window.electronAPI.setSecretGuardSettings(next);
        if (result.success) return { success: true };
        secretBaseTrustedRef.current = false;
        await reconcileSecretFromStore();
        return {
          success: false,
          error: result.error ? wrappedError(result.error) : plainStatus("security.saveError"),
        };
      } catch {
        secretBaseTrustedRef.current = false;
        await reconcileSecretFromStore();
        return { success: false, error: plainStatus("security.saveError") };
      }
    });
    secretWriteChainRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  /**
   * Every ordinary single-store mutation. Claims the status at the user's
   * action and reports only if it still owns it when the write settles, so a
   * slower earlier write can never overwrite a newer one's message.
   */
  const persistGuardUpdate = (
    update: (base: SelectionGuardSettings) => SelectionGuardSettings | null,
  ): void => {
    const ownsStatus = claimStatus();
    void (async () => {
      const result = await runGuardWrite(update);
      if (result === null || !ownsStatus()) return;
      if (result.success) {
        flashSaved();
      } else {
        setStatus(result.error);
      }
    })();
  };

  /** Secret-guard counterpart of `persistGuardUpdate`. */
  const persistSecretUpdate = (
    update: (base: SecretGuardSettings) => SecretGuardSettings | null,
  ): void => {
    const ownsStatus = claimStatus();
    void (async () => {
      const result = await runSecretWrite(update);
      if (result === null || !ownsStatus()) return;
      if (result.success) {
        flashSaved();
      } else {
        setStatus(result.error);
      }
    })();
  };

  // Both numeric handlers rebuild from the base they are given rather than a
  // captured snapshot, for the same reason the deny-list ones do: a scalar
  // edit made while an app resolution is still pending must carry that
  // deny-list forward, or persisting the whole object here would erase the app
  // the user just blocked.
  const handleClipboardAgeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(event.target.value);
    persistGuardUpdate((base) => ({
      ...base,
      clipboardMaxAgeSeconds: Number.isFinite(raw)
        ? Math.max(0, Math.floor(raw))
        : base.clipboardMaxAgeSeconds,
    }));
  };

  const handleSelectionSizeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(event.target.value);
    persistGuardUpdate((base) => ({
      ...base,
      maxSelectionChars: Number.isFinite(raw)
        ? Math.max(0, Math.floor(raw))
        : base.maxSelectionChars,
    }));
  };

  const canAddBundleId = normalizeBundleId(newBundleId) !== null;

  /**
   * The ONE path by which bundle ids are added, whatever their source: the
   * text field, a recent-app chip, the file dialog, or a drop. Routing all
   * four through `withDeniedBundleIds` means the deny-list invariants
   * (canonical form, no duplicates, the `MAX_DENIED_BUNDLE_IDS` cap) and the
   * capacity feedback are decided in exactly one place — a single-id add that
   * silently did nothing at the cap is how "Add" came to look broken.
   *
   * The capacity count is whatever the write's own base produced, so it
   * describes the list the user actually has rather than one guessed before
   * the queue drained. It is reported only once that partial write lands: on
   * failure, saying only "these did not fit" would leave the user believing
   * the rest were saved.
   *
   * Resolves to whether a change was persisted, which is what tells the typed
   * add whether to clear its field.
   */
  const addDeniedBundleIds = (bundleIds: readonly string[]): Promise<boolean> => {
    const ownsStatus = claimStatus();
    let droppedForCapacity = 0;

    return (async () => {
      const result = await runGuardWrite((base) => {
        const addition = withDeniedBundleIds(base, bundleIds);
        droppedForCapacity = addition.droppedForCapacity;
        return addition.settings === base ? null : addition.settings;
      });

      const capacityStatus =
        droppedForCapacity > 0
          ? plainStatus("security.deniedApps.capacityReached", {
              dropped: droppedForCapacity,
              max: MAX_DENIED_BUNDLE_IDS,
            })
          : null;

      if (!ownsStatus()) return result?.success === true;

      // Nothing fitted — there was no write to make, so the cap IS the outcome.
      if (result === null) {
        if (capacityStatus) setStatus(capacityStatus);
        return false;
      }
      if (!result.success) {
        setStatus(result.error);
        return false;
      }
      if (capacityStatus) {
        setStatus(capacityStatus);
      } else {
        flashSaved();
      }
      return true;
    })();
  };

  const handleAddDeniedApp = (): void => {
    const submitted = newBundleId;
    void (async () => {
      if (!(await addDeniedBundleIds([submitted]))) return;
      // Clears only once the id actually landed, so a rejected entry stays in
      // the field for the user to see rather than vanishing — and only if the
      // field still holds it, so typing during the write is not wiped.
      setNewBundleId((current) => (current === submitted ? "" : current));
    })();
  };

  const handleRemoveDeniedApp = (bundleId: string): void => {
    persistGuardUpdate((base) => {
      const next = withoutDeniedBundleId(base, bundleId);
      return next === base ? null : next;
    });
  };

  const handleChooseApps = (): void => {
    const ownsStatus = claimStatus();
    void (async () => {
      try {
        const result = await window.electronAPI.chooseDeniedApps();
        if (!result.success) {
          if (ownsStatus()) setStatus(wrappedError(result.error));
          return;
        }
        // Re-claims the status itself: the dialog closing is a newer user
        // action than anything that happened while it sat open.
        await addDeniedBundleIds(result.bundleIds);
      } catch {
        if (ownsStatus()) setStatus(plainStatus("security.deniedApps.dropError"));
      }
    })();
  };

  /**
   * `File.path` is gone in Electron 43, so the path comes from
   * `webUtils.getPathForFile` behind the preload bridge, which returns `null`
   * for anything that is not an `.app`.
   *
   * A drop is ALL-OR-NOTHING, matching `resolveAppBundleIds` in main: if any
   * dropped item fails to resolve to an `.app` path, the whole drop is
   * refused. Filtering the unresolvable ones out instead would block a
   * SUBSET of what was dropped and report success — and the item that
   * silently vanished could well be the app the user actually meant to
   * block, which they would only discover by not being protected by it.
   */
  const handleAppDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setIsDropTarget(false);
    const ownsStatus = claimStatus();
    const files = [...event.dataTransfer.files];
    const paths = files
      .map((file) => window.electronAPI.getAppBundlePathForFile(file))
      .filter((path): path is string => path !== null);
    // A shorter list than was dropped means something did not resolve.
    if (files.length === 0 || paths.length !== files.length) {
      setStatus(plainStatus("security.deniedApps.dropInvalid"));
      return;
    }
    void (async () => {
      try {
        const result = await window.electronAPI.resolveAppBundleIds(paths);
        if (!result.success) {
          if (ownsStatus()) setStatus(wrappedError(result.error));
          return;
        }
        await addDeniedBundleIds(result.bundleIds);
      } catch {
        if (ownsStatus()) setStatus(plainStatus("security.deniedApps.dropError"));
      }
    })();
  };

  const handleToggleRecentApp = (chip: RecentAppChip): void => {
    const { bundleId } = chip.app;
    if (bundleId === null) return;
    // Blocking goes through the shared add path so a chip clicked at the cap
    // explains itself instead of looking dead; unblocking has no cap to hit.
    if (!chip.blocked) {
      void addDeniedBundleIds([bundleId]);
      return;
    }
    persistGuardUpdate((base) => {
      const next = withoutDeniedBundleId(base, bundleId);
      return next === base ? null : next;
    });
  };

  const handleModeChange = (mode: SecretGuardMode): void => {
    persistSecretUpdate((base) => ({ ...base, mode }));
  };

  const handleHighEntropyChange = (highEntropyRule: boolean): void => {
    persistSecretUpdate((base) => ({ ...base, highEntropyRule }));
  };

  /**
   * Fires both restore writes concurrently — they target different stores, so
   * nothing is shared for them to race over; each still queues behind that
   * store's own pending writes. `Promise.all` waits for BOTH `PersistResult`s
   * before touching `saveStatus`, so the derived status depends only on which
   * write(s) failed, never on which one happened to settle last. A failure
   * always wins over a success: restoring is not "done" if either store
   * silently reverted, and "Saved." must never be shown while one guard is
   * actually still off.
   *
   * `derivesFromBase: false` because restore ignores the current settings
   * entirely — see `WriteOptions`. That also means neither write can resolve
   * to "nothing to do".
   */
  const handleRestoreDefaults = (): void => {
    const ownsStatus = claimStatus();
    void (async () => {
      const [guardResult, secretResult] = await Promise.all([
        runGuardWrite(() => defaultGuardSettings(), { derivesFromBase: false }),
        runSecretWrite(() => ({ ...DEFAULT_SECRET_GUARD_SETTINGS }), { derivesFromBase: false }),
      ]);

      if (!ownsStatus()) return;

      if (guardResult?.success === true && secretResult?.success === true) {
        flashSaved();
        return;
      }
      if (guardResult?.success !== true && secretResult?.success !== true) {
        setStatus(plainStatus("security.saveError"));
        return;
      }
      setStatus(
        guardResult?.success === true
          ? plainStatus("security.restorePartial.secretFailed")
          : plainStatus("security.restorePartial.guardFailed"),
      );
    })();
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-6 pb-8">
      {/* 1. Blocked apps — also the drop target for `.app` bundles. The whole
          section accepts the drop (not a narrow strip) so aiming is forgiving;
          the Choose app button is the keyboard-reachable equivalent, since a
          drag-and-drop cannot be performed from the keyboard at all. */}
      <section
        className={`flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors ${
          isDropTarget
            ? "border-primary bg-primary/10"
            : "border-card-control-border"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDropTarget(true);
        }}
        // `dragleave` bubbles from every child, so dragging across the chips
        // and inputs inside this section would strobe the highlight off and on.
        // Only a leave that actually exits the section counts.
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDropTarget(false);
        }}
        onDrop={handleAppDrop}
      >
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

        {/* Wraps rather than squeezing: two buttons beside the field leave it
            unusably narrow in the settings modal's narrower column. */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            value={newBundleId}
            onChange={(event) => setNewBundleId(event.target.value)}
            placeholder={t("security.deniedApps.addPlaceholder")}
            aria-label={t("security.deniedApps.addLabel")}
            className="min-w-48 flex-1"
          />
          <Button type="button" variant="secondary" disabled={!canAddBundleId} onClick={handleAddDeniedApp} className="shrink-0 rounded px-3 py-2 text-sm font-semibold">
            {t("security.deniedApps.addLabel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleChooseApps}
            className="shrink-0 rounded px-3 py-2 text-sm font-semibold"
          >
            {t("security.deniedApps.chooseLabel")}
          </Button>
        </div>

        <p className={`text-sm ${isDropTarget ? "text-primary" : "text-muted-foreground"}`}>
          {t("security.deniedApps.dropHint")}
        </p>

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
            <Input
              id="security-clipboard-age"
              type="number"
              min={0}
              value={view.clipboardAge.maxAgeSeconds}
              onChange={handleClipboardAgeChange}
              className="w-24"
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
            <Input
              id="security-selection-size"
              type="number"
              min={0}
              value={view.selectionSize.maxChars}
              onChange={handleSelectionSizeChange}
              className="w-32"
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
          {/* `SegmentedControl` is a flex row; in this `flex-col` parent it
              would stretch to the panel width and leave the three options
              floating in a bar of empty background. `self-start` sizes it to
              its options instead — fixed at the call site, since the stretched
              form is what other consumers (the equal-width language picker)
              actually want. */}
          <SegmentedControl
            value={view.secretGuard.mode}
            onChange={handleModeChange}
            ariaLabel={t("security.secretGuard.mode.label")}
            className="self-start"
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

        {/* One bullet per claim rather than one paragraph: this copy is
            load-bearing (it once shipped saying masking meant "nothing is
            sent", which was false), and a wall of text is the form in which a
            reader skips it. The order comes from
            `SECRET_GUARD_LIMITATION_KEYS`, not from this file. */}
        <div className="flex flex-col gap-2 rounded-md bg-background/60 p-3">
          <h3 className="text-sm font-semibold text-card-foreground">
            {t("security.secretGuard.limitations.title")}
          </h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            {SECRET_GUARD_LIMITATION_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-card-control-border pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={handleRestoreDefaults}
          className="rounded px-3 py-2 text-sm font-semibold"
        >
          {t("security.restoreDefaults")}
        </Button>
        <span className="text-sm text-muted-foreground" role="status">
          {resolve(saveStatus)}
        </span>
      </div>
    </div>
  );
};
