# FixLang In-App Update Design

Date: 2026-07-21
Status: Approved design, pending written-spec review

## Goal

Add a dependable macOS update flow to FixLang that is discoverable from
Settings, reports each step clearly, and applies releases without asking users
to replace the application manually.

The experience follows TokenTracker's useful interaction pattern—manual check,
explicit confirmation, visible download progress, install/restart, and a GitHub
fallback—while using Electron's maintained update stack instead of custom DMG
mount-and-copy code.

## Decisions

- Publish update artifacts from the existing `anhdd-kuro/fix-lang` GitHub
  repository and make that repository public before the first updater-enabled
  release.
- Use `electron-updater` with electron-builder's GitHub provider.
- Support stable GitHub Releases only. Draft and prerelease builds are not part
  of the stable update channel.
- Keep all update network, download, verification, and install operations in the
  Electron main process.
- Check silently once after startup in packaged builds, but never download,
  install, or restart without a user action.
- Place the user-facing controls in Settings -> General rather than adding a new
  settings tab.
- Preserve the current macOS DMG for manual installation and add/use the ZIP and
  generated `latest-mac.yml` as the automatic-update payload and metadata.
- Require Developer ID signing and Apple notarization for published macOS
  releases. The release workflow must fail rather than publish an update that
  cannot be installed reliably.
- Ship the first updater-enabled release as Apple Silicon (`arm64`) only. The
  current native `node-mac-permissions` build is architecture-specific;
  universal/x64 packaging requires a separate build-and-device verification
  effort.

## User Experience

Settings -> General gains an **App updates** section immediately before the
destructive reset-settings section. A top border separates the app-wide update
controls from profile-specific settings. It uses the same typography, borders,
buttons, theme tokens, and inline status patterns as the existing General
settings.

The section always shows the installed version. Its state and action change as
follows:

| State | Message | Primary action |
| --- | --- | --- |
| Idle | `FixLang vX.Y.Z` | `Check for updates` |
| Checking | `Checking for updates...` | Disabled checking button |
| Current | `FixLang is up to date.` | `Check again` |
| Available | `FixLang vA.B.C is available.` plus asset size when known | `Download update` |
| Downloading | Percentage and transferred size when known | Disabled progress action |
| Downloaded | `FixLang vA.B.C is ready to install.` | `Restart to update` |
| Error | A plain-language failure message | `Try again` |
| Unsupported | Updates require an installed, packaged macOS build | Disabled |

When an update is available, a secondary `View release` link opens the exact
GitHub Release in the system browser. It remains available after an error so a
user can fall back to the DMG.

The section uses `role="status"`/`aria-live="polite"` for state changes,
`role="alert"` for errors, and a native `<progress>` element (or equivalent
accessible progressbar semantics) for download progress. Percentage announcements
are throttled so screen readers are not flooded. State changes never move focus.
Busy actions are disabled to prevent duplicate checks or downloads.

The startup check updates the shared state only. It does not open Settings,
steal focus, show a modal, or begin a download. Opening Settings later shows the
latest state immediately.

## Architecture

### Shared contract

`src/shared/update.ts` defines the renderer-safe update state and result types.
The public state contains only display-safe metadata:

- phase: `unsupported`, `idle`, `checking`, `up-to-date`, `available`,
  `downloading`, `downloaded`, or `error`
- current version
- available version, release date, asset size, and release URL when present
- download percent, bytes transferred, total bytes, and speed when present
- user-facing error text when present

No filesystem paths, tokens, request headers, or arbitrary feed URLs cross IPC.

### Main-process update service

`src/main/update/updateService.ts` owns `electron-updater` and the update state
machine. It is initialized once after `app.whenReady()` and exposes narrow
methods to:

- return the current snapshot
- check for a stable update
- download the currently offered update
- restart and install a completed download
- subscribe/unsubscribe renderer windows to state changes

The service depends on a small injected updater-driver interface. Production
wraps the real `electron-updater` singleton; unit tests supply a deterministic
fake without loading Electron or making network requests.

The service configures:

- `autoDownload = false`
- `autoInstallOnAppQuit = false`
- GitHub provider metadata embedded by electron-builder; no runtime
  `setFeedURL()` call
- packaged-build and platform guards before network activity

Because Electron-vite deliberately emits the main process as CommonJS, the main
build externalizes `electron-updater` alongside Electron and imports it through
the library's documented CommonJS-compatible shape. This keeps its runtime
resources available to the packaged app and avoids rebundling assumptions.

Only one operation can run at a time. Repeated actions return the current state
instead of creating duplicate updater calls. `electron-updater` performs version
selection, artifact checksum verification, signature validation, download, and
installation.

Errors are normalized to concise UI messages while the original error is sent
through FixLang's existing main-process logging. Secrets and complete request
headers are never logged.

### IPC and preload

Add a dedicated update feature rather than growing the settings handler:

- `src/main/ipc/features/update.ts`
- `src/preload/features/update.ts`

The preload validates action names and callback shapes before crossing the IPC
boundary. The renderer API contains only:

- `getUpdateState()`
- `checkForUpdates()`
- `downloadUpdate()`
- `installUpdate()`
- `onUpdateStateChanged(callback)` returning an unsubscribe function
- `openUpdateRelease()` for the service-owned current release URL

The main process validates every action again. The renderer cannot supply a URL,
file path, version, or executable command.

### Renderer

`src/renderer/components/SettingUpdates.tsx` owns only presentation and user
interaction. It loads the current snapshot on mount, subscribes to state
changes, unsubscribes on unmount, and delegates all actions through the preload
API. `SettingGeneral.tsx` renders this focused component without absorbing the
updater state machine.

## Startup Behavior

After the main window and IPC handlers are ready, packaged macOS builds schedule
one background update check. A short delay keeps startup work off the critical
path. Development builds and unpackaged `dir` builds remain in `unsupported`
state and never contact the release feed.

The startup check is availability-only because `autoDownload` is disabled. The
user explicitly starts the download in Settings and explicitly restarts after
the download completes.

## Release and Distribution

### electron-builder configuration

`package.json` gains:

- the pinned `electron-updater` runtime dependency compatible with the pinned
  electron-builder version
- repository metadata for `anhdd-kuro/fix-lang`
- a GitHub `publish` provider targeting that repository
- draft release publishing so incomplete asset sets are never visible to clients
- stable artifact names that include version and architecture
- macOS signing/notarization settings appropriate for Developer ID distribution
- `electronUpdaterCompatibility: ">= 2.16"`

The implementation changes `hardenedRuntime` to `true` and adds explicit main
and inherited entitlements files for direct Developer ID distribution.

The existing `dmg` and `zip` macOS targets remain. Publishing must upload the
DMG, ZIP, blockmap/checksum metadata produced by electron-builder, and
`latest-mac.yml` from the same build so hashes cannot be mixed between releases.

### GitHub Actions

`.github/workflows/release.yml` triggers on semantic version tags matching
`v*.*.*` and runs on a pinned macOS runner. It has only `contents: write`
permission and:

1. Checks out the exact tag.
2. Installs the pinned Bun version and dependencies with the lockfile frozen.
3. Verifies that the tag without `v` exactly matches `package.json` version.
4. Runs `bun run lint`, `bun run test`, and `bun run build`.
5. Creates/uses a draft GitHub Release so updater clients cannot observe a
   partially uploaded release.
6. Imports the Developer ID certificate from GitHub Actions secrets.
7. Builds, signs, and notarizes Apple Silicon artifacts with
   `electron-builder --mac --arm64 --publish always`.
8. Verifies the signature, Gatekeeper assessment, notarization ticket, and
   existence of `latest-mac.yml`.
9. Publishes the draft only after every artifact and verification step succeeds.
10. Fails without publishing if signing, notarization, metadata generation, or
    upload fails.

Required repository secrets are documented without recording their values:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

The workflow maps the signing secrets to electron-builder's expected
`CSC_LINK`/`CSC_KEY_PASSWORD` environment variables and writes the App Store
Connect API key to a temporary file used by notarization. The README states that
the initial updater-enabled release supports Apple Silicon only.

### Repository visibility

The repository becomes public only after the updater code, release workflow,
and documentation have been reviewed for secrets and private material. Before
changing visibility, inspect tracked files and Git history for credentials or
other content that must not be published.

### Bootstrap release

Existing FixLang builds do not contain an updater. Users must install the first
updater-enabled signed release (`v0.2.0`) manually from its DMG. Every later
stable release can use the in-app flow. The implementation updates
`package.json` to `0.2.0`; subsequent releases must update the package version
before creating the matching `vX.Y.Z` tag.

## Failure Handling

- Offline, timeout, GitHub rate-limit, or feed errors: retain the current app,
  show a retryable error, and offer the release-page fallback when known.
- No update: show an explicit up-to-date state without a notification storm.
- Missing/malformed release metadata: treat as a check failure and do not
  download an unverified asset.
- Download failure: return to a retryable available/error state without
  restarting the app.
- Signature or checksum failure: stop installation, log the technical error,
  and direct the user to the release page.
- Install/restart failure: keep the downloaded state when possible and provide a
  retry plus manual-release fallback.
- Renderer/window closure: the main-process service retains authoritative state;
  reopening Settings resumes the correct status.

## Testing and Verification

Unit tests cover:

- state transitions for available, current, download progress, downloaded, and
  failure events
- duplicate-operation guards
- packaged/platform support guards
- sanitization of updater errors and release metadata
- IPC payload validation and listener cleanup
- renderer labels, disabled states, progress semantics, retry behavior, and
  unsubscribe-on-unmount behavior
- release information rendered as plain text, never raw HTML

Build/release verification covers:

- `bun run lint`
- `bun run test`
- `bun run build`
- local `electron-builder` packaging to confirm `app-update.yml` is embedded and
  macOS ZIP/DMG metadata is generated
- inspection of the packaged app version and bundle identifier
- GitHub Actions syntax and tag/package version validation
- a signed two-version smoke test when signing credentials are available: install
  version N, publish N+1, check, download, restart, and confirm `app.getVersion()`
  reports N+1

Automatic update installation cannot be claimed verified from an unsigned
development build. If signing credentials are not available in this workspace,
the handoff must state that the signed two-version smoke test remains a release
prerequisite.

## Documentation

README changes cover:

- where to find Settings -> General -> App updates
- what check, download, and restart actions do
- the manual GitHub Release fallback
- the one-time manual bootstrap install
- the maintainer release process, version/tag rule, signing secrets, and
  generated artifacts

No update credentials, tokens, or signing material are committed.

## Out of Scope

- Windows and Linux update UI or release validation
- beta/nightly channels and prerelease opt-in
- background download or forced restart
- differential rollout controls
- private GitHub feed authentication
- custom DMG mounting, copying, shell installers, or privilege escalation

## References

- Electron-builder auto-update documentation:
  https://www.electron.build/docs/features/auto-update/
- Electron autoUpdater macOS signing requirement:
  https://www.electronjs.org/docs/latest/api/auto-updater/
- TokenTracker update service:
  https://github.com/mm7894215/TokenTracker/blob/3244cc089558054000cfae3b9d9ac2acd620147f/TokenTrackerBar/TokenTrackerBar/Services/UpdateChecker.swift
- TokenTracker settings update row:
  https://github.com/mm7894215/TokenTracker/blob/3244cc089558054000cfae3b9d9ac2acd620147f/dashboard/src/components/settings/MenuBarSection.jsx
