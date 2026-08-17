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

/** Author GitHub profile — opened from the About tab header icon. */
const GITHUB_PROFILE_URL = "https://github.com/anhdd-kuro";

/**
 * Where the manual "Download from GitHub" link in the pre-release section
 * points. `PrereleaseState` carries no per-release URL the way the stable
 * flow's `openUpdateRelease()` does (main's `releaseUrl` is scoped to the
 * stable channel only), so a manual pre-release install always lands on the
 * releases index rather than a specific tag.
 */
const GITHUB_RELEASES_URL = "https://github.com/anhdd-kuro/fix-lang/releases";

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
 * The host a click on this link would actually reach, or null when a click
 * reaches nothing (the handler below dispatches `http(s)` only, so a `mailto:`
 * or a relative href is inert and has no destination to disclose).
 *
 * A markdown author picks the label and the href independently, and this panel
 * dispatches the href — so
 * `[https://github.com/anhdd-kuro/fix-lang](https://evil.example.com/phish)`
 * shows the project's own repository and opens somewhere else on a plain left
 * click, in the one place a user is primed to download and run an unsigned
 * macOS binary. The label is fully attacker-chosen, so NOTHING here reads it:
 * an earlier attempt asked whether the label "looked like a URL" before
 * disclosing the destination, and a single leading zero-width space — or a
 * space, a quote, a bullet, an image — put the attack straight back. Any
 * allow-list of label shapes loses that game; this one is not played.
 *
 * `URL.host`, not the raw href and not `hostname`:
 * - Raw href is attacker-chosen text. `https://github.com@evil.example.com/…`
 *   is a URL whose authority is `evil.example.com` and whose `github.com` is a
 *   USERNAME; echoing it verbatim would print that lie with the app's own
 *   authority. Parsing collapses it to the authority that actually resolves.
 * - `host` keeps a non-default port, which `hostname` drops — `github.com:8080`
 *   is not the host a reader means by "github.com".
 * - Shown whole, never elided: the deceptive half of `github.com.evil.example.com`
 *   is the END, so an ellipsis would hide precisely what this exists to show.
 *
 * RESIDUAL GAPS, stated rather than implied:
 * 1. This names the host, not the path. `github.com/attacker/fix-lang` under a
 *    `github.com/anhdd-kuro/fix-lang` label annotates as `(github.com)` and is
 *    NOT disclosed in the visible text; only `title` carries the whole URL.
 *    Rendering the whole URL is the attacker-controlled-text problem above.
 * 2. It names a host; it does not judge one. `URL` applies IDNA ToASCII, so a
 *    mixed-script homograph surfaces as visible `xn--` punycode, but an ASCII
 *    look-alike (`githulb.com`, `github-releases.com`) still reads plausibly.
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
    // One parse decides BOTH what a click dispatches and what the annotation
    // names, so the two can never describe different URLs.
    const host = dispatchedLinkHost(href);
    return (
      <a
        href={href}
        // The whole destination is also reachable on hover, for every link —
        // the click dispatches `href`, so `href` is the only honest tooltip.
        title={href}
        onClick={(e) => {
          e.preventDefault();
          if (host !== null && href) {
            void window.electronAPI.openExternalLink(href);
          }
        }}
        className="text-primary underline hover:no-underline"
      >
        {/* The author's own label, always, exactly as written: emphasis, code
            spans and inline marks all survive because nothing replaces them.
            The disclosure below is ADDITIVE, which is what makes it safe to
            apply to every link — a link that carried no annotation would
            teach the reader that its absence means "trusted". */}
        {children}
        {host !== null && (
          <span className="font-mono text-xs text-muted-foreground">{` (${host})`}</span>
        )}
      </a>
    );
  },
  // Release notes are untrusted GitHub content; never auto-load remote
  // images (would leak the user's IP / act as a tracking pixel).
  img: () => null,
};

/**
 * GitHub release notes. Shown both for an offered update and for a release
 * Homebrew has not synced yet — in either case the user is deciding whether
 * they want that version.
 */
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
 * The pre-release phases whose own JSX below renders `prereleaseState.message`.
 * A renderer fact, not a promise main makes: `PrereleaseState` is flat, so any
 * phase MAY carry a descriptor, and main's initial `unsupported` state already
 * carries one this section never shows. Anything reasoning about "the user can
 * already see that sentence" has to ask this, and the test that walks all nine
 * phases through the live component is what keeps the set honest.
 */
const MESSAGE_RENDERING_PRERELEASE_PHASES = new Set<PrereleaseState["phase"]>([
  "error",
  "installing",
  "restart-required",
]);

const phaseRendersPrereleaseMessage = (
  phase: PrereleaseState["phase"],
): boolean => MESSAGE_RENDERING_PRERELEASE_PHASES.has(phase);

const initialState: UpdateState = {
  phase: "unsupported",
  currentVersion: "",
};

/**
 * Mirrors `initialState` above, but for the SEPARATE pre-release flow — see
 * `PrereleaseState`'s doc comment for why this never shares a field, a
 * broadcast channel, or a piece of local state with the stable flow.
 */
const initialPrereleaseState: PrereleaseState = {
  phase: "unsupported",
  activeChannel: "stable",
};

const updateApi = () => window.electronAPI;

const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Passed to `t()` as a pre-formatted string: it already carries a unit and one
 * decimal, and `t()` would otherwise re-format the bare number.
 */
const formatMegabytes = (bytes: number): string =>
  `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;

const displayVersion = (version: string | undefined): string =>
  version?.startsWith("v") ? version : `v${version ?? ""}`;

/**
 * Whether two descriptors would render the identical sentence — the test the
 * pre-release ownership rule (see `runPrerelease`) is stated in terms of.
 *
 * Shallow over `params` by contract: `MessageParams` values are `string |
 * number` only, so there is nothing deeper to walk. An absent descriptor on
 * either side is never "the same": a section showing nothing has not already
 * said what the notice is about to say.
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

/**
 * App-update controls for Settings → General. The main process validates
 * GitHub metadata; this component only renders safe state and opens releases.
 */
export const SettingUpdates = () => {
  const { t, tm } = useI18n();
  const [state, setState] = useState<UpdateState>(initialState);
  const [actionPending, setActionPending] = useState(false);
  // The stable twin of `channelActionPending` below, and carved out of
  // `actionPending` for the same reason. `actionPending` covers EVERY stable
  // request — Check, Download, Install, Restart — but only `installUpdate`
  // claims main's shared `installing` flag, which is the single thing the
  // pre-release section has to wait out. Reading the broad flag froze the
  // pre-release Check button for the length of an ordinary stable check.
  const [installActionPending, setInstallActionPending] = useState(false);
  // Locale-free descriptor for the ONE error message the mount effect below
  // can produce (`getUpdateState()` rejecting before any live event arrives).
  // Kept as separate state from `state.message` (also a `Message` descriptor
  // on the shared `UpdateState` type from `~/features/update/shared/update`, but one only
  // ever set by `run()` below or a live broadcast) so a mount-time IPC
  // failure is never confused with a service-reported error state. Cleared
  // whenever fresher state arrives (a live broadcast, the initial snapshot,
  // or a later `run()` failure) so it can never shadow newer information.
  const [mountLoadError, setMountLoadError] = useState<Message | null>(null);

  // SECOND, independent piece of state — see `PrereleaseState`'s doc comment
  // for why a pre-release check must never write into `state`/`setState`
  // above. Its own `actionPending` and `mountLoadError` mirror the stable
  // ones one-for-one, for the same reasons.
  const [prereleaseState, setPrereleaseState] = useState<PrereleaseState>(
    initialPrereleaseState,
  );
  const [prereleaseActionPending, setPrereleaseActionPending] = useState(false);
  const [prereleaseMountLoadError, setPrereleaseMountLoadError] =
    useState<Message | null>(null);
  // Only a switch or a revert — never a pre-release check — so the stable
  // section's `isBusy` below can freeze exactly while main holds its shared
  // `installing` flag, and not a moment longer.
  const [channelActionPending, setChannelActionPending] = useState(false);
  // A refusal main REPORTED BACK instead of publishing. A declined confirm is
  // a complete no-op in the service (nothing published, nothing written,
  // nothing quit), so this is the ONLY place the user can be told the switch
  // was cancelled. Neutral rather than an alert: every message that reaches
  // here describes an action that simply never started.
  const [prereleaseActionNotice, setPrereleaseActionNotice] =
    useState<Message | null>(null);
  /**
   * The LIVE `PrereleaseState`, which the closure variable above is not: main
   * publishes its failure from inside the IPC handler and returns the same
   * descriptor when the invoke reply resolves, so the async tail of
   * `runPrerelease` runs against a render-old snapshot and cannot tell whether
   * the box beside it is already showing what it is about to repeat.
   *
   * Written by `applyPrereleaseState` rather than during render on purpose:
   * React has not necessarily re-rendered between the broadcast and the
   * resolution, so a render-time assignment would still be one state behind.
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
    // Optional-called the same way the rest of the renderer reaches newer
    // bridge methods (see `App.tsx`'s `onOpenDashboardTab?.()`): this
    // component also mounts inside the About tab, and a throwing effect
    // there would tear down the user guide alongside it. A bridge that
    // cannot answer leaves the section on `unsupported`, which is exactly
    // what a build without the pre-release channel should show.
    if (
      typeof api.onPrereleaseStateChanged !== "function" ||
      typeof api.getPrereleaseState !== "function"
    ) {
      return;
    }

    let mounted = true;
    let receivedLivePrereleaseState = false;

    // Same "subscribe before fetch" discipline as the stable effect above,
    // applied to the separate `updates:prerelease-state` channel.
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
    /**
     * True for the one stable request that claims main's shared `installing`
     * flag. Mirrors `runPrerelease`'s `isChannelOperation` exactly, and exists
     * for the same reason: the broad pending flag cannot tell the pre-release
     * section which stable action is running, and only this one blocks it.
     */
    isInstallRequest = false,
  ) => {
    if (actionPending) return;

    // Shared by both failure paths below (a rejected request and a
    // resolved-but-`success: false` result) so a translation key never has to
    // be smuggled through as an `Error` message just to reach one handler.
    //
    // `reported` is main's own descriptor and is preferred whenever there is
    // one — the same rule `runPrerelease` follows below, and for the same
    // reason. Every `installUpdate` failure names WHICH failure it was (the
    // tap is behind, the download died, the helper would not start), publishes
    // that `Message`, and returns it alongside; the broadcast lands first and
    // this runs second, so a call-site-bound generic here overwrites the
    // specific answer with a wrong noun. The bound message is the fallback for
    // a REJECTED request, where no descriptor came back to prefer.
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
   * The pre-release twin of `run()`. Both prefer main's returned descriptor
   * over the call-site-bound one; the differences left are where the message
   * lands and which flag the request claims:
   *
   * - the stable flow has ONE place to render a failure, so `run()` writes
   *   main's descriptor into `state.message`. This section has two — the
   *   phase box and `prereleaseActionNotice` — so it needs the ownership rule
   *   spelled out below;
   * - `isChannelOperation` marks the two requests — switch and revert — that
   *   claim main's shared `installing` flag, which is what `isBusy` below
   *   needs and a plain pre-release check must not trigger.
   *
   * OWNERSHIP RULE for a channel-op failure message: whichever channel main
   * used owns it. A descriptor main PUBLISHED is already on screen in the
   * phase box, so the notice must stay silent — otherwise one sentence sits
   * in an `alert` and a `status` at once and a screen reader announces it
   * twice. The notice carries only what main reported back WITHOUT
   * publishing: the early guards (a declined confirm, `canSwitch` false,
   * `installing` held, a phase mismatch) are no-ops in the service, so a
   * returned descriptor is the sole trace of them that can ever be shown.
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
        // The ownership rule in action. Compared against the LIVE state, not
        // the render-old closure: main's broadcast lands before this
        // resolution, so the ref already holds whatever it published.
        const notice = reported ?? failureMessage;
        // Suppress ONLY when the published phase actually puts that descriptor
        // on screen. `message` is a plain optional field on a flat state, so a
        // phase can carry one it never renders (main's initial `unsupported`
        // state does exactly that today) — suppressing against those would
        // leave the sentence nowhere at all, the same silent no-op the notice
        // exists to prevent.
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
    // A channel switch claims main's SHARED `installing` flag before its
    // confirm dialog awaits, while `UpdateState` still reads
    // `phase: "available"`, `canInstall: true` — and that dialog has no
    // parent window, so this panel stays clickable behind it. Without these
    // three terms the user can press Install, watch `installUpdate()` resolve
    // `{ success: true }`, publish nothing, and then have the app quit into a
    // channel switch the stable section never mentioned.
    channelActionPending ||
    prereleaseState.phase === "downloading" ||
    prereleaseState.phase === "installing";
  const latestVersion = displayVersion(state.availableVersion);
  const downloadedBytes = state.downloadedBytes ?? 0;
  // Absent when the release metadata carried no usable asset size; the bar
  // then runs indeterminate rather than inventing a denominator.
  const downloadTotal =
    state.totalBytes !== undefined && state.totalBytes > 0
      ? state.totalBytes
      : null;
  const downloadPercent =
    downloadTotal === null
      ? null
      : Math.min(100, Math.round((downloadedBytes / downloadTotal) * 100));

  // The INVERSE of `isBusy`'s channel terms, and the half the stable flow
  // cannot signal for itself. `checkForPrerelease` bails on the SAME shared
  // `installing` flag a switch claims, but — unlike `switchToPrerelease` and
  // `revertToStable` — it returns the UNCHANGED `PrereleaseState` with no
  // `success` field, and `runPrerelease` only recognises `{ success: false }`.
  // So a check pressed during a stable install is dropped in silence: no
  // spinner, no notice, no error. These three terms are what keeps the button
  // from looking alive while it cannot act.
  //
  // Deliberately NOT symmetric with `isBusy`: `state.phase === "checking"` is
  // absent because a stable check claims `checking`, never `installing`, and a
  // channel op needs no term of its own because it already sets
  // `prereleaseActionPending` on its way through `runPrerelease`.
  //
  // For the same reason the stable term is `installActionPending` and not the
  // broad `actionPending`: that flag is claimed by a stable Check too, and its
  // window COINCIDES with the `checking` phase this list excludes on purpose —
  // the promise only resolves once main clears `checking` — so the broad flag
  // silently reinstates the very freeze the exclusion prevents.
  //
  // `restart-required` is the term that is easiest to miss and the worst to
  // omit. `publishRestartRequired` claims `installing` and NOTHING clears it —
  // the bundle on disk is already the new one, so there is nothing left to
  // finish — which makes the refusal permanent rather than momentary. It is
  // also reached on the ordinary success path: a stable update that lands
  // after the app quits leaves the next launch in `restart-required` with the
  // pre-release state untouched at `idle`, so without this term the button
  // RE-ARMS at exactly the transition that makes it useless.
  const prereleaseIsBusy =
    prereleaseActionPending ||
    prereleaseState.phase === "checking" ||
    prereleaseState.phase === "downloading" ||
    prereleaseState.phase === "installing" ||
    installActionPending ||
    state.phase === "downloading" ||
    state.phase === "installing" ||
    state.phase === "restart-required";
  // What the SPINNER means, which is not what `prereleaseIsBusy` means. The
  // busy flag is mostly borrowed stable-flow terms, and one of them —
  // `restart-required` — never clears, so spinning on it would park a
  // permanent spinner on a button with nothing running behind it. Only work
  // this section started spins: the pending flag covers the window before
  // main answers, and the `checking` phase covers the window after, because
  // the state broadcast clears the pending flag on its way in.
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
  // Likewise `revertToStable`'s. Offered in every settled phase, not just an
  // offer: getting off a misbehaving beta is the whole point of the button.
  //
  // `unsupported` is excluded for the same reason `showPrereleaseCheck` below
  // excludes it, and it matters MORE here: this is the one channel action that
  // deliberately asks no confirmation, so its predicate is the whole gate in
  // front of a detached Homebrew uninstall-then-install and an app quit. No
  // main-process code publishes `unsupported` alongside `activeChannel: "beta",
  // canSwitch: true` today — `isPrereleaseState` never cross-validates the
  // three, so nothing but this line makes that stay true.
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
          {/* A release exists that Homebrew cannot install yet. Reported here
              rather than as an offer, because the button would have nothing
              to do. */}
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
            {/* Only alongside the tap-pending notice: main has pointed the
                release URL at that published tag, and the message itself tells
                the user the DMG is the way to get it now. Without a message
                there is nothing newer on GitHub to open. */}
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
            // `canInstall` is false on a beta install for a Homebrew-specific
            // reason: the stable cask is not staged, so `brew upgrade` would
            // refuse the token outright. Falling through to the DMG branch
            // below would tell a Homebrew user to replace their bundle by
            // hand; their actual route back to stable is the Revert button in
            // the Pre-release section right below this one.
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
            {/* Still offered here: a newer release can land while this panel
                sits on an older "available" result, and re-checking is also
                the way out of a stale offer after a manual install. */}
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
          {/* Indeterminate until the release asset size is known, so the bar
              never implies precision the byte counts do not have. */}
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
          {/* Reopened mid-upgrade: main sends the "still working" text so the
              default "quits and reopens" copy cannot contradict what is
              actually happening. */}
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

      {/* A SECOND, self-contained flow below the stable one, boxed off so the
          two never read as one control group: its own state, its own check
          button, its own result line. A pre-release check must never rewrite
          a word of the section above. */}
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
            {/* No one-click path exists here — a manual DMG install has no
                cask to switch, and the service refuses a beta -> beta switch
                — so this is a plain link to the releases index rather than a
                button that would only report a refusal. */}
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

        {/* The Restart button deliberately lives in the stable section only:
            the service publishes `restart-required` to BOTH states and
            `restartForUpdate` is gated on the stable phase, so a second
            button here would be a duplicate of the one already on screen. */}
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
