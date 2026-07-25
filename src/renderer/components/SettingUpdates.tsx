import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { msg, type Message } from "~/shared/i18n/message";
import CopyButton from "./CopyButton";
import { Spinner } from "./Spinner";
import { useI18n } from "../i18n/useI18n";
import type { UpdateState } from "~/shared/update";

/** Author GitHub profile — opened from the About tab header icon. */
const GITHUB_PROFILE_URL = "https://github.com/anhdd-kuro";

/**
 * Compact Octocat mark used as the About-tab profile link.
 */
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

/**
 * A shell command shown as a copyable code block. The command text is the
 * single source of truth for both the display and the clipboard value, so the
 * user always copies exactly what they see.
 */
const CommandBlock = ({ command }: { command: string }) => {
  const { t } = useI18n();
  return (
    <div className="relative mt-1 rounded border border-border bg-secondary/60">
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
 * Compact markdown component overrides so GitHub release notes fit the
 * About panel and match its muted styling. No raw HTML is enabled —
 * react-markdown escapes it by default, which keeps untrusted release-note
 * content XSS-safe.
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
  p: ({ children }) => <p className="mt-1 text-sm text-muted-foreground">{children}</p>,
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
  li: ({ children }) => <li className="text-sm text-muted-foreground">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-secondary px-1 py-0.5 font-mono text-sm">
      {children}
    </code>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-card-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) {
          void window.electronAPI.openExternalLink(href);
        }
      }}
      className="text-primary underline hover:no-underline"
    >
      {children}
    </a>
  ),
  // Release notes are untrusted GitHub content; never auto-load remote
  // images (would leak the user's IP / act as a tracking pixel).
  img: () => null,
};

const initialState: UpdateState = {
  phase: "unsupported",
  currentVersion: "",
};

const updateApi = () => window.electronAPI;

const displayVersion = (version: string | undefined): string =>
  version?.startsWith("v") ? version : `v${version ?? ""}`;

/**
 * App-update controls for Settings → General. The main process validates
 * GitHub metadata; this component only renders safe state and opens releases.
 */
export const SettingUpdates = () => {
  const { t, tm } = useI18n();
  const [state, setState] = useState<UpdateState>(initialState);
  const [actionPending, setActionPending] = useState(false);
  // Locale-free descriptor for the ONE error message the mount effect below
  // can produce (`getUpdateState()` rejecting before any live event arrives).
  // Kept as separate state from `state.message` (also a `Message` descriptor
  // on the shared `UpdateState` type from `~/shared/update`, but one only
  // ever set by `run()` below or a live broadcast) so a mount-time IPC
  // failure is never confused with a service-reported error state. Cleared
  // whenever fresher state arrives (a live broadcast, the initial snapshot,
  // or a later `run()` failure) so it can never shadow newer information.
  const [mountLoadError, setMountLoadError] = useState<Message | null>(null);

  useEffect(() => {
    const api = updateApi();
    let mounted = true;
    let receivedLiveState = false;

    // Subscribe before requesting the snapshot so a newer event cannot be
    // overwritten if the initial IPC response arrives later.
    const unsubscribe = api.onUpdateStateChanged((next) => {
      receivedLiveState = true;
      if (mounted) {
        setActionPending(false);
        setMountLoadError(null);
        setState(next);
      }
    });

    void api.getUpdateState()
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

  const run = async (
    request: () => Promise<unknown>,
    failureMessage: Message,
  ) => {
    if (actionPending) return;

    setActionPending(true);
    try {
      const result = await request();
      if (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === false
      ) {
        throw new Error(failureMessage.key);
      }
    } catch {
      setMountLoadError(null);
      setState((current) => ({
        ...current,
        phase: "error",
        message: failureMessage,
      }));
    } finally {
      setActionPending(false);
    }
  };

  const isBusy =
    actionPending || state.phase === "checking" || state.phase === "installing";
  const latestVersion = displayVersion(state.availableVersion);

  return (
    <section aria-labelledby="app-updates-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="app-updates-heading" className="text-base font-medium text-card-foreground">
            {t("settings.updates.title")}
          </h2>
          {state.currentVersion && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.updates.versionLabel", { version: state.currentVersion })}
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
        <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
          {t("settings.updates.unsupported")}
        </p>
      )}

      {state.phase === "idle" && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.updates.idleDescription")}
          </p>
          <button
            type="button"
            onClick={() =>
              void run(
                () => updateApi().checkForUpdates(),
                msg("settings.updates.checkFailed"),
              )
            }
            disabled={isBusy}
            className="mt-2 rounded bg-primary px-3 py-1.5 text-base text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy && (
              <Spinner className="mr-2 inline size-4 align-[-2px]" />
            )}
            {t("settings.updates.checkButton")}
          </button>
        </>
      )}

      {state.phase === "checking" && (
        <>
          <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
            {t("settings.updates.checking")}
          </p>
          <button
            type="button"
            disabled
            className="mt-2 rounded bg-primary px-3 py-1.5 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            {t("settings.updates.checkButton")}
          </button>
        </>
      )}

      {state.phase === "up-to-date" && (
        <>
          <p className="mt-1 text-sm text-success" role="status" aria-live="polite">
            {t("settings.updates.upToDate")}
          </p>
          <button
            type="button"
            onClick={() =>
              void run(
                () => updateApi().checkForUpdates(),
                msg("settings.updates.checkFailed"),
              )
            }
            disabled={isBusy}
            className="mt-2 rounded bg-primary px-3 py-1.5 text-base text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy && (
              <Spinner className="mr-2 inline size-4 align-[-2px]" />
            )}
            {t("settings.updates.checkButton")}
          </button>
        </>
      )}

      {state.phase === "available" && (
        <>
          <p className="mt-1 text-sm text-success" role="status" aria-live="polite">
            {t("settings.updates.available", {
              version: latestVersion,
              currentVersion: state.currentVersion,
            })}
          </p>
          {state.releaseNotes && (
            <div className="mt-1 text-sm text-muted-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={releaseNotesComponents}
              >
                {state.releaseNotes}
              </ReactMarkdown>
            </div>
          )}
          {state.canInstall ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.updates.canInstallDescription")}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.updates.installInstructions")}
              </p>
              <CommandBlock
                command={'xattr -dr com.apple.quarantine "/Applications/FixLang.app"'}
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {state.canInstall && (
              <button
                type="button"
                onClick={() =>
                  void run(
                    () => updateApi().installUpdate(),
                    msg("settings.updates.installFailed"),
                  )
                }
                disabled={isBusy}
                className="rounded bg-primary px-3 py-1.5 text-base text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy && <Spinner className="mr-2 inline size-4 align-[-2px]" />}
                {t("settings.updates.installNow")}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  msg("settings.updates.openReleaseFailed"),
                )
              }
              disabled={isBusy}
              className={
                state.canInstall
                  ? "rounded border border-border px-3 py-1.5 text-base text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  : "rounded bg-primary px-3 py-1.5 text-base text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {t("settings.updates.downloadButton")}
            </button>
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  msg("settings.updates.openReleaseFailed"),
                )
              }
              disabled={isBusy}
              className="rounded border border-border px-3 py-1.5 text-base text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("settings.updates.viewReleases")}
            </button>
          </div>
        </>
      )}

      {state.phase === "installing" && (
        <p
          className="mt-1 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Spinner className="mr-2 inline size-4 align-[-2px]" />
          {t("settings.updates.installingDescription", { version: latestVersion })}
        </p>
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
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().checkForUpdates(),
                  msg("settings.updates.checkFailed"),
                )
              }
              disabled={isBusy}
              className="rounded bg-primary px-3 py-1.5 text-base text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("settings.updates.tryAgain")}
            </button>
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  msg("settings.updates.openReleaseFailed"),
                )
              }
              disabled={isBusy}
              className="rounded border border-border px-3 py-1.5 text-base text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("settings.updates.viewReleases")}
            </button>
          </div>
        </>
      )}

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

        {/* Two independent sentences bracket the literal Homebrew output
            (never translated — it's what the user's terminal actually shows)
            instead of interpolating it mid-sentence, so JA word order isn't
            forced to match the EN clause order. */}
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
        <CommandBlock command={'xattr -dr com.apple.quarantine "/Applications/FixLang.app"'} />

        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.updates.unsignedNotice")}
        </p>
      </div>
    </section>
  );
};
