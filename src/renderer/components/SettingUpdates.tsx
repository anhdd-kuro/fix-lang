import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import type { UpdateState } from "~/shared/update";

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
  const [state, setState] = useState<UpdateState>(initialState);
  const [actionPending, setActionPending] = useState(false);

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
        setState(next);
      }
    });

    void api.getUpdateState()
      .then((next) => {
        if (mounted && !receivedLiveState) setState(next);
      })
      .catch(() => {
        if (mounted && !receivedLiveState) {
          setState((current) => ({
            ...current,
            phase: "error",
            message: "Could not load update status.",
          }));
        }
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const run = async (
    request: () => Promise<unknown>,
    failureMessage: string,
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
        throw new Error(failureMessage);
      }
    } catch {
      setState((current) => ({
        ...current,
        phase: "error",
        message: failureMessage,
      }));
    } finally {
      setActionPending(false);
    }
  };

  const isBusy = actionPending || state.phase === "checking";
  const latestVersion = displayVersion(state.availableVersion);

  return (
    <section aria-labelledby="app-updates-heading">
      <h2 id="app-updates-heading" className="text-sm font-medium text-card-foreground">
        App updates
      </h2>
      {state.currentVersion && (
        <p className="mt-1 text-xs text-muted-foreground">
          FixLang v{state.currentVersion}
        </p>
      )}

      {state.phase === "unsupported" && (
        <p className="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">
          Updates are available in installed release builds.
        </p>
      )}

      {state.phase === "idle" && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Checks GitHub Releases. Updates install manually.
          </p>
          <button
            type="button"
            onClick={() =>
              void run(
                () => updateApi().checkForUpdates(),
                "Could not check for updates.",
              )
            }
            disabled={isBusy}
            className="mt-2 rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy && (
              <Spinner className="mr-2 inline size-4 align-[-2px]" />
            )}
            Check for updates
          </button>
        </>
      )}

      {state.phase === "checking" && (
        <>
          <p className="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            Checking for updates…
          </p>
          <button
            type="button"
            disabled
            className="mt-2 rounded bg-primary px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Spinner className="mr-2 inline size-4 align-[-2px]" />
            Check for updates
          </button>
        </>
      )}

      {state.phase === "up-to-date" && (
        <>
          <p className="mt-1 text-xs text-success" role="status" aria-live="polite">
            FixLang is up to date.
          </p>
          <button
            type="button"
            onClick={() =>
              void run(
                () => updateApi().checkForUpdates(),
                "Could not check for updates.",
              )
            }
            disabled={isBusy}
            className="mt-2 rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy && (
              <Spinner className="mr-2 inline size-4 align-[-2px]" />
            )}
            Check for update
          </button>
        </>
      )}

      {state.phase === "available" && (
        <>
          <p className="mt-1 text-xs text-success" role="status" aria-live="polite">
            Version {latestVersion} is available (you have v{state.currentVersion}).
          </p>
          {state.releaseNotes && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {state.releaseNotes}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Install the DMG, replace FixLang in Applications, then run{" "}
            <code>xattr -dr com.apple.quarantine &quot;/Applications/FixLang.app&quot;</code>{" "}
            if macOS blocks it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  "Could not open the release page.",
                )
              }
              disabled={isBusy}
              className="rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download from GitHub
            </button>
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  "Could not open the release page.",
                )
              }
              disabled={isBusy}
              className="rounded border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              View releases
            </button>
          </div>
        </>
      )}

      {state.phase === "error" && (
        <>
          <p className="mt-1 text-xs text-destructive" role="alert">
            {state.message ?? "Could not update FixLang."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().checkForUpdates(),
                  "Could not check for updates.",
                )
              }
              disabled={isBusy}
              className="rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() =>
                void run(
                  () => updateApi().openUpdateRelease(),
                  "Could not open the release page.",
                )
              }
              disabled={isBusy}
              className="rounded border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              View releases
            </button>
          </div>
        </>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-medium text-card-foreground">
          How to update
        </h3>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            Homebrew (Apple Silicon): run{" "}
            <code>brew update &amp;&amp; brew upgrade --cask fixlang</code>.
          </li>
          <li>
            Manual (DMG): download the latest release from GitHub (see the
            buttons above), open the DMG, and replace FixLang in{" "}
            <code>/Applications</code>. If macOS blocks the unsigned app, run{" "}
            <code>
              xattr -dr com.apple.quarantine &quot;/Applications/FixLang.app&quot;
            </code>
            .
          </li>
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">
          FixLang releases are unsigned and not notarized — updates are
          installed manually, the app never installs them automatically.
        </p>
      </div>
    </section>
  );
};
