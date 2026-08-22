import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isMessage, msg, type Message } from "~/features/i18n/shared/message";
import { Button } from "./Button";
import CopyButton from "./CopyButton";
import { Spinner } from "./Spinner";
import { useI18n } from "../i18n/useI18n";
import type { PrereleaseState } from "~/features/update/shared/prerelease";
import type { UpdateState } from "~/features/update/shared/update";

const GITHUB_PROFILE_URL = "https://github.com/anhdd-kuro";

/**
 * `PrereleaseState` carries no per-release URL (main's `releaseUrl` is scoped
 * to the stable channel), so a manual beta install lands on the index.
 */
const GITHUB_RELEASES_URL = "https://github.com/anhdd-kuro/fix-lang/releases";

const GitHubProfileIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const CommandBlock = ({ command }: { command: string }) => {
  const { t } = useI18n();
  return (
    <div className="relative mt-1 rounded border border-control-border bg-secondary/60">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all px-2 py-1.5 pr-6 font-mono text-sm text-card-foreground">
        {command}
      </pre>
      <CopyButton
        value={command}
        label={t("settings.updates.copyCommand", { command })}
        size="sm"
        className="absolute right-1 top-1"
      />
    </div>
  );
};

/**
 * The host a click would actually reach, or null when the click is inert (only
 * `http(s)` is dispatched below). The markdown label is attacker-chosen, so
 * NOTHING here reads it — every allow-list of "URL-looking" labels loses to a
 * leading zero-width space. `host`, not the raw href and not `hostname`:
 * `https://github.com@evil.example.com/…` has `github.com` as a USERNAME, and
 * a non-default port is part of the host a reader means. Shown whole, since
 * the deceptive half of `github.com.evil.example.com` is the end.
 *
 * RESIDUAL GAPS: a same-host path swap (`github.com/attacker/fix-lang` under
 * an `anhdd-kuro/fix-lang` label) is disclosed only in `title`, and `URL`
 * punycodes mixed-script homographs but not ASCII look-alikes (`githulb.com`).
 */
const dispatchedLinkHost = (href: string | undefined): string | null => {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.host || null;
  } catch {
    return null;
  }
};

/**
 * Compact markdown overrides for GitHub release notes. No raw HTML is enabled;
 * react-markdown escapes it by default, which keeps untrusted notes XSS-safe.
 */
const releaseNotesComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 text-sm font-semibold text-card-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-2 text-sm font-semibold text-card-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 text-sm font-semibold text-card-foreground">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mt-1 text-sm text-muted-foreground">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-muted-foreground">{children}</li>
  ),
  code: ({ children }) => (
    <code className="rounded bg-secondary px-1 py-0.5 font-mono text-sm">
      {children}
    </code>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-card-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => {
    const host = dispatchedLinkHost(href);
    return (
      <a
        href={href}
        // The click dispatches `href`, so `href` is the only honest tooltip.
        title={href}
        onClick={(e) => {
          e.preventDefault();
          if (host !== null && href) {
            void window.electronAPI.openExternalLink(href);
          }
        }}
        className="text-primary underline hover:no-underline"
      >
        {/* The annotation is ADDITIVE and unconditional: nothing rewrites the
            author's label, and no link may read as "trusted" by lacking one. */}
        {children}
        {host !== null && (
          <span className="font-mono text-xs text-muted-foreground">{` (${host})`}</span>
        )}
      </a>
    );
  },
  // Untrusted content — a remote image would be a tracking pixel.
  img: () => null,
};

const ReleaseNotes = ({ notes }: { notes: string }) => (
  <div className="mt-1 text-sm text-muted-foreground">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={releaseNotesComponents}
    >
      {notes}
    </ReactMarkdown>
  </div>
);

/**
 * `PrereleaseState` is flat, so any phase MAY carry a descriptor and main's
 * initial `unsupported` carries one this section never shows. These are the
 * phases whose JSX actually renders it.
 */
const MESSAGE_RENDERING_PRERELEASE_PHASES = new Set<PrereleaseState["phase"]>([
  "error",
  "installing",
  "restart-required",
]);

export const phaseRendersPrereleaseMessage = (
  phase: PrereleaseState["phase"],
): boolean => MESSAGE_RENDERING_PRERELEASE_PHASES.has(phase);

const initialState: UpdateState = {
  phase: "unsupported",
  currentVersion: "",
};

/** Separate flow: shares no field, broadcast channel, or state with stable. */
const initialPrereleaseState: PrereleaseState = {
  phase: "unsupported",
  activeChannel: "stable",
};

const updateApi = () => window.electronAPI;

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** Pre-formatted for `t()`, which would otherwise re-format a bare number. */
const formatMegabytes = (bytes: number): string =>
  `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;

const displayVersion = (version: string | undefined): string =>
  version?.startsWith("v") ? version : `v${version ?? ""}`;

/**
 * Shallow over `params` by contract — `MessageParams` values are `string |
 * number`. An absent descriptor on either side is never "the same".
 */
const isSameMessage = (
  left: Message | undefined,
  right: Message | undefined,
): boolean => {
  if (left === undefined || right === undefined) return false;
  if (left.key !== right.key) return false;
  const leftParams = left.params ?? {};
  const rightParams = right.params ?? {};
  const leftKeys = Object.keys(leftParams);
  return (
    leftKeys.length === Object.keys(rightParams).length &&
    leftKeys.every((key) => leftParams[key] === rightParams[key])
  );
};

/** Main validates GitHub metadata; this only renders state and opens links. */
export const SettingUpdates = () => {
  const { t, tm } = useI18n();
  const [state, setState] = useState<UpdateState>(initialState);
  const [actionPending, setActionPending] = useState(false);
  // Narrower than `actionPending` on purpose: only `installUpdate` claims
  // main's shared `installing` flag, and only that flag blocks pre-release.
  const [installActionPending, setInstallActionPending] = useState(false);
  // Only the mount-time `getUpdateState()` rejection, kept out of
  // `state.message` so it is never read as a service-reported error.
  const [mountLoadError, setMountLoadError] = useState<Message | null>(null);

  // A pre-release check must never write into `state` above; its own pending
  // and mount-error state mirror the stable ones one-for-one.
  const [prereleaseState, setPrereleaseState] = useState<PrereleaseState>(
    initialPrereleaseState,
  );
  const [prereleaseActionPending, setPrereleaseActionPending] = useState(false);
  const [prereleaseMountLoadError, setPrereleaseMountLoadError] =
    useState<Message | null>(null);
  // Switch or revert only — never a check — so `isBusy` freezes exactly while
  // main holds its shared `installing` flag.
  const [channelActionPending, setChannelActionPending] = useState(false);
  // A refusal main REPORTED BACK instead of publishing. A declined confirm is
  // a no-op in the service, so this is the only place it can be surfaced.
  const [prereleaseActionNotice, setPrereleaseActionNotice] =
    useState<Message | null>(null);
  /**
   * The LIVE state the closure variable is not: main publishes its failure and
   * returns the same descriptor, so `runPrerelease`'s async tail would compare
   * against a render-old snapshot. Written on apply, not during render, since
   * React need not have re-rendered between broadcast and resolution.
   */
  const prereleaseStateRef = useRef(prereleaseState);
  const applyPrereleaseState = (next: PrereleaseState): void => {
    prereleaseStateRef.current = next;
    setPrereleaseState(next);
  };

  useEffect(() => {
    const api = updateApi();
    let mounted = true;
    let receivedLiveState = false;

    // Subscribe before fetching so a late snapshot cannot overwrite a newer event.
    const unsubscribe = api.onUpdateStateChanged((next) => {
      receivedLiveState = true;
      if (mounted) {
        setActionPending(false);
        setMountLoadError(null);
        setState(next);
      }
    });

    void api
      .getUpdateState()
      .then((next) => {
        if (mounted && !receivedLiveState) {
          setMountLoadError(null);
          setState(next);
        }
      })
      .catch(() => {
        if (mounted && !receivedLiveState) {
          setMountLoadError(msg("settings.updates.loadFailed"));
          setState((current) => ({ ...current, phase: "error" }));
        }
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const api = updateApi();
    // This also mounts inside the About tab, where a throwing effect would tear
    // down the user guide; an unanswerable bridge leaves it on `unsupported`.
    if (
      typeof api.onPrereleaseStateChanged !== "function" ||
      typeof api.getPrereleaseState !== "function"
    ) {
      return;
    }

    let mounted = true;
    let receivedLivePrereleaseState = false;

    const unsubscribe = api.onPrereleaseStateChanged((next) => {
      receivedLivePrereleaseState = true;
      if (mounted) {
        setPrereleaseActionPending(false);
        setPrereleaseMountLoadError(null);
        setPrereleaseActionNotice(null);
        applyPrereleaseState(next);
      }
    });

    void api
      .getPrereleaseState()
      .then((next) => {
        if (mounted && !receivedLivePrereleaseState) {
          setPrereleaseMountLoadError(null);
          applyPrereleaseState(next);
        }
      })
      .catch(() => {
        if (mounted && !receivedLivePrereleaseState) {
          setPrereleaseMountLoadError(
            msg("settings.updates.prerelease.genericError"),
          );
          applyPrereleaseState({
            ...prereleaseStateRef.current,
            phase: "error",
          });
        }
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const run = async (
    request: () => Promise<unknown>,
    failureMessage: Message,
    /** True for the one stable request that claims main's `installing` flag. */
    isInstallRequest = false,
  ) => {
    if (actionPending) return;

    // Main's own descriptor wins: it names WHICH failure it was, and this runs
    // after its broadcast, so a bound generic here would overwrite the answer.
    // The bound message is the fallback for a rejected request only.
    const reportFailure = (reported: Message | null) => {
      setMountLoadError(null);
      setState((current) => ({
        ...current,
        phase: "error",
        message: reported ?? failureMessage,
      }));
    };

    setActionPending(true);
    if (isInstallRequest) setInstallActionPending(true);
    try {
      const result = await request();
      if (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === false
      ) {
        reportFailure(
          "error" in result && isMessage(result.error) ? result.error : null,
        );
        return;
      }
    } catch {
      reportFailure(null);
    } finally {
      setActionPending(false);
      if (isInstallRequest) setInstallActionPending(false);
    }
  };

  /**
   * Pre-release twin of `run()`, with two places a failure could land instead
   * of one. OWNERSHIP RULE: a descriptor main PUBLISHED is already in the
   * phase box, so the notice stays silent rather than have a screen reader
   * announce one sentence twice; the notice carries only what main returned
   * WITHOUT publishing (declined confirm, `canSwitch` false, `installing`
   * held, phase mismatch), which is those guards' sole visible trace.
   */
  const runPrerelease = async (
    request: () => Promise<unknown>,
    failureMessage: Message,
    isChannelOperation: boolean,
  ) => {
    if (prereleaseActionPending) return;

    setPrereleaseActionPending(true);
    setPrereleaseActionNotice(null);
    if (isChannelOperation) setChannelActionPending(true);
    try {
      const result = await request();
      if (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === false
      ) {
        const reported =
          "error" in result && isMessage(result.error) ? result.error : null;
        const notice = reported ?? failureMessage;
        // A phase can carry a `message` it never renders, so matching on the
        // descriptor alone would leave the sentence nowhere at all.
        const alreadyOnScreen =
          phaseRendersPrereleaseMessage(prereleaseStateRef.current.phase) &&
          isSameMessage(notice, prereleaseStateRef.current.message);
        if (!alreadyOnScreen) {
          setPrereleaseActionNotice(notice);
        }
      }
    } catch {
      // The bridge itself broke — no descriptor came back to prefer.
      setPrereleaseMountLoadError(null);
      applyPrereleaseState({
        ...prereleaseStateRef.current,
        phase: "error",
        message: failureMessage,
      });
    } finally {
      setPrereleaseActionPending(false);
      if (isChannelOperation) setChannelActionPending(false);
    }
  };

  const isBusy =
    actionPending ||
    state.phase === "checking" ||
    state.phase === "downloading" ||
    state.phase === "installing" ||
    // A channel switch holds main's shared `installing` flag while
    // `UpdateState` still reads `available`/`canInstall`, and its confirm has
    // no parent window — so Install stays pressable and quits the app into a
    // switch this section never mentioned.
    channelActionPending ||
    prereleaseState.phase === "downloading" ||
    prereleaseState.phase === "installing";
  const latestVersion = displayVersion(state.availableVersion);
  const downloadedBytes = state.downloadedBytes ?? 0;
  // Null rather than an invented denominator; the bar runs indeterminate.
  const downloadTotal =
    state.totalBytes !== undefined && state.totalBytes > 0
      ? state.totalBytes
      : null;
  const downloadPercent =
    downloadTotal === null
      ? null
      : Math.min(100, Math.round((downloadedBytes / downloadTotal) * 100));

  // The renderer cannot observe main's shared `installing` flag, so these
  // terms PREDICT which stable phases hold it: `checkForPrerelease` bails on
  // that flag but returns unchanged state with no `success` field, so a check
  // pressed then is dropped in total silence. `restart-required` is in the
  // list because the flag it claimed is never cleared.
  const prereleaseIsBusy =
    prereleaseActionPending ||
    prereleaseState.phase === "checking" ||
    prereleaseState.phase === "downloading" ||
    prereleaseState.phase === "installing" ||
    installActionPending ||
    state.phase === "downloading" ||
    state.phase === "installing" ||
    state.phase === "restart-required";
  // Only work this section started spins — `restart-required` never clears, so
  // spinning on `prereleaseIsBusy` would park a permanent spinner.
  const prereleaseCheckRunning =
    prereleaseActionPending || prereleaseState.phase === "checking";
  // Homebrew owns the app from here on; nothing in this section may re-arm.
  const prereleaseWorking =
    prereleaseState.phase === "downloading" ||
    prereleaseState.phase === "installing" ||
    prereleaseState.phase === "restart-required";
  const prereleaseVersion = displayVersion(prereleaseState.offeredVersion);
  const prereleaseDownloadedBytes = prereleaseState.downloadedBytes ?? 0;
  const prereleaseDownloadTotal =
    prereleaseState.totalBytes !== undefined && prereleaseState.totalBytes > 0
      ? prereleaseState.totalBytes
      : null;
  const prereleaseDownloadPercent =
    prereleaseDownloadTotal === null
      ? null
      : Math.min(
          100,
          Math.round(
            (prereleaseDownloadedBytes / prereleaseDownloadTotal) * 100,
          ),
        );
  // Exactly `switchToPrerelease`'s own precondition, so the button is offered
  // only when pressing it can succeed rather than bounce off a refusal.
  const canSwitchToPrerelease =
    prereleaseState.phase === "available" &&
    prereleaseState.canSwitch === true &&
    prereleaseState.activeChannel === "stable";
  // Likewise `revertToStable`'s, in every settled phase — getting off a
  // misbehaving beta is the point. Revert asks no confirmation, so this
  // predicate is the whole gate in front of the switch and the app quit.
  const canRevertToStable =
    prereleaseState.phase !== "unsupported" &&
    prereleaseState.canSwitch === true &&
    prereleaseState.activeChannel === "beta" &&
    !prereleaseWorking;
  const showPrereleaseCheck =
    prereleaseState.phase !== "unsupported" && !prereleaseWorking;

  return (
    <section aria-labelledby="app-updates-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="app-updates-heading"
            className="text-base font-medium text-card-foreground"
          >
            {t("settings.updates.title")}
          </h2>
          {state.currentVersion && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.updates.versionLabel", {
                version: state.currentVersion,
              })}
            </p>
          )}
        </div>
        <a
          href={GITHUB_PROFILE_URL}
          onClick={(event) => {
            event.preventDefault();
            void window.electronAPI.openExternalLink(GITHUB_PROFILE_URL);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("settings.updates.githubLinkLabel")}
          title={t("settings.updates.githubLinkLabel")}
        >
          <GitHubProfileIcon className="size-5" />
        </a>
      </div>

      {state.phase === "unsupported" && (
        <p
          className="mt-1 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {t("settings.updates.unsupported")}
        </p>
      )}

      {state.phase === "idle" && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.updates.idleDescription")}
          </p>
          <Button
            onClick={() =>
              void run(
                () => updateApi().checkForUpdates(),
                msg("settings.updates.checkFailed"),
              )
            }
            disabled={isBusy}
            className="mt-2 rounded px-3 py-1.5 text-base"
          >
            {isBusy && <Spinner className="mr-2 inline size-4 align-[-2px]" />}
            {t("settings.updates.checkButton")}
          </Button>
        </>
      )}

      {state.phase === "checking" && (
        <>
          <p
            className="mt-1 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {t("settings.updates.checking")}
          </p>
          <Button disabled className="mt-2 rounded px-3 py-1.5 text-base">
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            {t("settings.updates.checkButton")}
          </Button>
        </>
      )}

      {state.phase === "up-to-date" && (
        <>
          <p
            className="mt-1 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {t("settings.updates.upToDate")}
          </p>
          {/* A release Homebrew cannot install yet: not an offer, because the
              Install button would have nothing to do. */}
          {state.message && (
            <p className="mt-1 text-sm text-muted-foreground">
              {tm(state.message)}
            </p>
          )}
          {state.message && state.releaseNotes && (
            <ReleaseNotes notes={state.releaseNotes} />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void run(
                  () => updateApi().checkForUpdates(),
                  msg("settings.updates.checkFailed"),
                )
              }
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-base"
            >
              {isBusy && (
                <Spinner className="mr-2 inline size-4 align-[-2px]" />
              )}
              {t("settings.updates.checkButton")}
            </Button>
            {/* Only with the tap-pending notice, whose release URL main has
                pointed at the published tag; without it, nothing to open. */}
            {state.message && (
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    () => updateApi().openUpdateRelease(),
                    msg("settings.updates.openReleaseFailed"),
                  )
                }
                disabled={isBusy}
                className="rounded px-3 py-1.5 text-base text-foreground"
              >
                {t("settings.updates.downloadButton")}
              </Button>
            )}
          </div>
        </>
      )}

      {state.phase === "available" && (
        <>
          <p
            className="mt-1 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {t("settings.updates.available", {
              version: latestVersion,
              currentVersion: state.currentVersion,
            })}
          </p>
          {state.releaseNotes && <ReleaseNotes notes={state.releaseNotes} />}
          {state.canInstall ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.updates.canInstallDescription")}
            </p>
          ) : prereleaseState.activeChannel === "beta" ? (
            // On a beta install the stable cask is not staged, so `brew upgrade`
            // refuses the token; the route back is Revert, not a manual DMG.
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.updates.prerelease.stableBlockedByBeta")}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.updates.installInstructions")}
              </p>
              <CommandBlock
                command={
                  'xattr -dr com.apple.quarantine "/Applications/FixLang.app"'
                }
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {state.canInstall && (
              <Button
                onClick={() =>
                  void run(
                    () => updateApi().installUpdate(),
                    msg("settings.updates.installFailed"),
                    // The only stable request that claims main's shared
                    // `installing` flag, so the only one the pre-release
                    // section has to be held shut for.
                    true,
                  )
                }
                disabled={isBusy}
                className="rounded px-3 py-1.5 text-base"
              >
                {isBusy && (
                  <Spinner className="mr-2 inline size-4 align-[-2px]" />
                )}
                {t("settings.updates.installNow")}
              </Button>
            )}
            {state.canInstall ? (
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    () => updateApi().openUpdateRelease(),
                    msg("settings.updates.openReleaseFailed"),
                  )
                }
                disabled={isBusy}
                className="rounded px-3 py-1.5 text-base text-foreground"
                aria-label={t("settings.updates.downloadButton")}
              >
                {t("settings.updates.downloadButton")}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void run(
                    () => updateApi().openUpdateRelease(),
                    msg("settings.updates.openReleaseFailed"),
                  )
                }
                disabled={isBusy}
                className="rounded px-3 py-1.5 text-base"
              >
                {t("settings.updates.downloadButton")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  msg("settings.updates.openReleaseFailed"),
                )
              }
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-base text-foreground"
            >
              {t("settings.updates.viewReleases")}
            </Button>
            {/* The way out of a stale offer after a manual install. */}
            <Button
              variant="outline"
              onClick={() =>
                void run(
                  () => updateApi().checkForUpdates(),
                  msg("settings.updates.checkFailed"),
                )
              }
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-base"
            >
              {t("settings.updates.checkButton")}
            </Button>
          </div>
        </>
      )}

      {state.phase === "downloading" && (
        <div className="mt-1">
          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            {downloadTotal === null ? (
              t("settings.updates.downloadingUnknownSize", {
                version: latestVersion,
              })
            ) : (
              <>
                {t("settings.updates.downloadingDescriptionPrefix", {
                  version: latestVersion,
                })}
                <span className="text-primary">
                  {t("settings.updates.downloadingSize", {
                    downloaded: formatMegabytes(downloadedBytes),
                    total: formatMegabytes(downloadTotal),
                  })}
                </span>
                {t("settings.updates.downloadingDescriptionSuffix")}
              </>
            )}
          </p>
          {/* Indeterminate until the asset size is known. */}
          <div
            role="progressbar"
            aria-label={t("settings.updates.downloadProgressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(downloadPercent === null
              ? {}
              : { "aria-valuenow": downloadPercent })}
            className="mt-2 h-1.5 w-full overflow-hidden rounded bg-secondary"
          >
            <div
              className="h-full rounded bg-primary transition-[width] duration-300"
              style={{ width: `${downloadPercent ?? 100}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === "installing" && (
        <p
          className="mt-1 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Spinner className="mr-2 inline size-4 align-[-2px]" />
          {/* Reopened mid-upgrade: main's text overrides the default "quits
              and reopens" copy, which would contradict what is happening. */}
          {state.message
            ? tm(state.message)
            : t("settings.updates.installingDescription", {
                version: latestVersion,
              })}
        </p>
      )}

      {state.phase === "restart-required" && (
        <>
          <p
            className="mt-1 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {state.message
              ? tm(state.message)
              : t("settings.updates.restartRequiredMessage", {
                  targetVersion: latestVersion,
                })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void run(
                  () => updateApi().restartForUpdate(),
                  msg("settings.updates.restartErrorMessage"),
                )
              }
              disabled={actionPending}
              className="rounded px-3 py-1.5 text-base"
            >
              {actionPending && (
                <Spinner className="mr-2 inline size-4 align-[-2px]" />
              )}
              {t("settings.updates.restartButton")}
            </Button>
          </div>
        </>
      )}

      {state.phase === "error" && (
        <>
          <p className="mt-1 text-sm text-destructive" role="alert">
            {mountLoadError
              ? tm(mountLoadError)
              : state.message
                ? tm(state.message)
                : t("settings.updates.genericError")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void run(
                  () => updateApi().checkForUpdates(),
                  msg("settings.updates.checkFailed"),
                )
              }
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-base"
            >
              {t("settings.updates.tryAgain")}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  msg("settings.updates.openReleaseFailed"),
                )
              }
              disabled={isBusy}
              className="rounded px-3 py-1.5 text-base text-foreground"
              aria-label={t("settings.updates.viewReleases")}
            >
              {t("settings.updates.viewReleases")}
            </Button>
          </div>
        </>
      )}

      {/* Boxed off so the two flows never read as one control group. */}
      <section
        aria-labelledby="prerelease-updates-heading"
        className="mt-4 rounded border border-control-border bg-secondary/40 p-3"
      >
        <h3
          id="prerelease-updates-heading"
          className="text-base font-medium text-card-foreground"
        >
          {t("settings.updates.prerelease.title")}
        </h3>

        {prereleaseState.activeChannel === "beta" && (
          <p className="mt-1 text-sm text-primary">
            {t("settings.updates.prerelease.channelBetaNote")}
          </p>
        )}

        {prereleaseState.phase === "unsupported" && (
          <p
            className="mt-1 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {t("settings.updates.prerelease.unsupported")}
          </p>
        )}

        {prereleaseState.phase === "idle" && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.updates.prerelease.idleDescription")}
          </p>
        )}

        {prereleaseState.phase === "checking" && (
          <p
            className="mt-1 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            {t("settings.updates.prerelease.checking")}
          </p>
        )}

        {prereleaseState.phase === "up-to-date" && (
          <p
            className="mt-1 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {t("settings.updates.prerelease.upToDate")}
          </p>
        )}

        {prereleaseState.phase === "available" && (
          <>
            <p
              className="mt-1 text-sm text-success"
              role="status"
              aria-live="polite"
            >
              {t("settings.updates.prerelease.available", {
                version: prereleaseVersion,
              })}
            </p>
            {prereleaseState.releaseNotes && (
              <ReleaseNotes notes={prereleaseState.releaseNotes} />
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {canSwitchToPrerelease
                ? t("settings.updates.prerelease.switchDescription")
                : prereleaseState.activeChannel === "beta"
                  ? t("settings.updates.prerelease.betaChannelUpgradeHint")
                  : t("settings.updates.prerelease.manualSwitchInstructions")}
            </p>
            {/* No one-click path exists: a manual DMG install has no cask to
                switch and the service refuses beta -> beta, so a button here
                could only report a refusal. */}
            {!canSwitchToPrerelease && (
              <a
                href={GITHUB_RELEASES_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void window.electronAPI.openExternalLink(GITHUB_RELEASES_URL);
                }}
                className="mt-2 inline-block text-sm text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("settings.updates.downloadButton")}
              </a>
            )}
          </>
        )}

        {prereleaseState.phase === "downloading" && (
          <div className="mt-1">
            <p
              className="text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Spinner className="mr-2 inline size-4 align-[-2px]" />
              {prereleaseDownloadTotal === null ? (
                t("settings.updates.downloadingUnknownSize", {
                  version: prereleaseVersion,
                })
              ) : (
                <>
                  {t("settings.updates.downloadingDescriptionPrefix", {
                    version: prereleaseVersion,
                  })}
                  <span className="text-primary">
                    {t("settings.updates.downloadingSize", {
                      downloaded: formatMegabytes(prereleaseDownloadedBytes),
                      total: formatMegabytes(prereleaseDownloadTotal),
                    })}
                  </span>
                  {t("settings.updates.downloadingDescriptionSuffix")}
                </>
              )}
            </p>
            <div
              role="progressbar"
              aria-label={t("settings.updates.downloadProgressLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(prereleaseDownloadPercent === null
                ? {}
                : { "aria-valuenow": prereleaseDownloadPercent })}
              className="mt-2 h-1.5 w-full overflow-hidden rounded bg-secondary"
            >
              <div
                className="h-full rounded bg-primary transition-[width] duration-300"
                style={{ width: `${prereleaseDownloadPercent ?? 100}%` }}
              />
            </div>
          </div>
        )}

        {prereleaseState.phase === "installing" && (
          <p
            className="mt-1 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            {prereleaseState.message
              ? tm(prereleaseState.message)
              : t("settings.updates.prerelease.switchDescription")}
          </p>
        )}

        {/* No Restart button: the service publishes `restart-required` to both
            states, so the stable section's button is already on screen. */}
        {prereleaseState.phase === "restart-required" && (
          <p
            className="mt-1 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {prereleaseState.message
              ? tm(prereleaseState.message)
              : t("settings.updates.restartRequiredMessage", {
                  targetVersion: prereleaseVersion,
                })}
          </p>
        )}

        {prereleaseState.phase === "error" && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {prereleaseMountLoadError
              ? tm(prereleaseMountLoadError)
              : prereleaseState.message
                ? tm(prereleaseState.message)
                : t("settings.updates.prerelease.genericError")}
          </p>
        )}

        {canRevertToStable && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("settings.updates.prerelease.revertDescription")}
          </p>
        )}

        {(canSwitchToPrerelease || showPrereleaseCheck || canRevertToStable) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {canSwitchToPrerelease && (
              <Button
                onClick={() =>
                  void runPrerelease(
                    () => updateApi().switchToPrerelease(),
                    msg("settings.updates.prerelease.switchErrorMessage"),
                    true,
                  )
                }
                disabled={prereleaseIsBusy}
                className="rounded px-3 py-1.5 text-base"
              >
                {/* The spinner marks the button that was actually pressed —
                    every control here shares one disabled flag, so spinning
                    on that would point at the wrong action. */}
                {channelActionPending && (
                  <Spinner className="mr-2 inline size-4 align-[-2px]" />
                )}
                {t("settings.updates.prerelease.switchButton")}
              </Button>
            )}
            {showPrereleaseCheck && (
              <Button
                variant={canSwitchToPrerelease ? "outline" : "primary"}
                onClick={() =>
                  void runPrerelease(
                    () => updateApi().checkForPrerelease(),
                    msg("settings.updates.prerelease.genericError"),
                    false,
                  )
                }
                disabled={prereleaseIsBusy}
                className="rounded px-3 py-1.5 text-base"
              >
                {prereleaseCheckRunning && !channelActionPending && (
                  <Spinner className="mr-2 inline size-4 align-[-2px]" />
                )}
                {t("settings.updates.prerelease.checkButton")}
              </Button>
            )}
            {canRevertToStable && (
              <Button
                variant="outline"
                onClick={() =>
                  void runPrerelease(
                    () => updateApi().revertToStable(),
                    msg("settings.updates.prerelease.revertErrorMessage"),
                    true,
                  )
                }
                disabled={prereleaseIsBusy}
                className="rounded px-3 py-1.5 text-base text-foreground"
              >
                {/* Same rule as the Switch button above — the spinner marks
                    the control that was pressed, and `runPrerelease` claims
                    `channelActionPending` for a revert too. The flag cannot
                    point at the wrong button here: Switch needs
                    `activeChannel === "stable"` and Revert needs `"beta"`, so
                    the two are never on screen at once. */}
                {channelActionPending && (
                  <Spinner className="mr-2 inline size-4 align-[-2px]" />
                )}
                {t("settings.updates.prerelease.revertButton")}
              </Button>
            )}
          </div>
        )}

        {prereleaseActionNotice && (
          <p
            className="mt-2 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {tm(prereleaseActionNotice)}
          </p>
        )}
      </section>

      <div className="mt-4">
        <h3 className="text-base font-medium text-card-foreground">
          {t("settings.updates.howToTitle")}
        </h3>

        <h4 className="mt-2 text-sm font-semibold text-card-foreground">
          {t("settings.updates.homebrewTitle")}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.updates.homebrewUpdateHint")}
        </p>
        <CommandBlock command="brew update && brew upgrade --cask fixlang" />

        {/* Two sentences bracket the untranslated Homebrew output rather than
            interpolate it, so JA word order need not follow EN's. */}
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.tapMissingIntro")}
        </p>
        <code className="mt-1 block rounded bg-secondary px-2 py-1 font-mono text-sm text-card-foreground">
          No Cask with this name exists
        </code>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.tapMissingAction")}
        </p>
        <CommandBlock command="brew tap anhdd-kuro/tap" />
        <CommandBlock command="brew install --cask anhdd-kuro/tap/fixlang" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.adoptExistingIntro")}
        </p>
        <code className="mt-1 block rounded bg-secondary px-2 py-1 font-mono text-sm text-card-foreground">
          --force
        </code>
        <CommandBlock command="brew install --cask --force anhdd-kuro/tap/fixlang" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.futureUpgrades")}
        </p>
        <CommandBlock command="brew upgrade --cask anhdd-kuro/tap/fixlang" />

        <h4 className="mt-3 text-sm font-semibold text-card-foreground">
          {t("settings.updates.manualTitle")}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.updates.manualInstructionsIntro")}
        </p>
        <code className="mt-1 block rounded bg-secondary px-2 py-1 font-mono text-sm text-card-foreground">
          /Applications
        </code>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.manualBlockedNotice")}
        </p>
        <CommandBlock
          command={'xattr -dr com.apple.quarantine "/Applications/FixLang.app"'}
        />

        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.unsignedNotice")}
        </p>
      </div>
    </section>
  );
};
