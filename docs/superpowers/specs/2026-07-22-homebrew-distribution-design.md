# Homebrew Tap Distribution Design

**Date:** 2026-07-22
**Status:** Approved design; implementation not started

## Goal

Allow Apple Silicon users to install FixLang and receive newer published releases:

```sh
brew install --cask anhdd-kuro/tap/fixlang
brew update && brew upgrade --cask anhdd-kuro/tap/fixlang
```

GitHub Releases remains the only application-artifact source. Homebrew does not build, sign, notarize, or alter FixLang; it downloads the immutable DMG FixLang publishes.

## Current-state boundary and bootstrap

At this design's creation, FixLang `main` is version `0.1.0` with no release workflow. Draft PR #67 contains the unsigned-release workflow and version `0.2.0`. No FixLang release or `v*` tag exists, and there is no `anhdd-kuro/homebrew-tap` repository.

Create the public tap safely before the first release. Merge PR #67 only with explicit user authorization, wait for the genuine public `v0.2.0` release, then manually dispatch the tap sync. Never publish a fake version just to exercise the cask. A later genuine release, such as `v0.2.1`, is required to prove a production `brew upgrade` end-to-end; until then, prove structure, idempotency, validation, and no-downgrade behavior.

## Architecture and ownership

Create public `anhdd-kuro/homebrew-tap` with default branch `main`:

```text
homebrew-tap/
├── Casks/fixlang.rb
├── .github/workflows/sync-fixlang.yml
└── README.md
```

| Component | Owner | Responsibility |
| --- | --- | --- |
| FixLang release workflow | `anhdd-kuro/fix-lang` | Publish immutable public `FixLang-X.Y.Z-arm64.dmg` and `SHA256SUMS.txt`. |
| Tap sync workflow | `anhdd-kuro/homebrew-tap` | Discover, validate, render, test, and commit the cask. |
| Cask | `anhdd-kuro/homebrew-tap` | Declare one verified FixLang release for Homebrew. |
| User installation | Homebrew user | Install, update, approve tap trust if requested, and make the unsigned-app trust decision. |

`sync-fixlang.yml` is pull-based: it runs on a six-hour schedule and with `workflow_dispatch`. The FixLang repository never writes to the tap. Six hours is the maximum normal discovery delay, not a promise of instant publication.

## Token boundary and security model

The tap workflow receives only its own repository `GITHUB_TOKEN` with `contents: write`. It uses this token solely to commit to `anhdd-kuro/homebrew-tap`. It uses no PAT, deploy key, GitHub App, secret, or cross-repository write permission. FixLang public metadata and Git history are read without persisted checkout credentials.

All release metadata and bytes are untrusted until validation finishes. The workflow must:

- pin third-party Actions by commit SHA and request minimal permissions;
- render Ruby from a fixed local template, never unchecked remote text;
- accept only stable `X.Y.Z`: no leading zeroes except zero, no suffix, and each component a JavaScript safe integer; compare with `BigInt`, never lexically or with floating point;
- verify the tag commit is an ancestor of current FixLang `origin/main`, rather than trusting `target_commitish`;
- parse `SHA256SUMS.txt` as data, require one exact asset entry, compute the downloaded DMG's checksum, and never execute checksum-file content;
- mount the DMG read-only, never launch its app, and always detach it through an exit trap; and
- serialize schedule and manual runs with a workflow concurrency group.

The cask checksum protects the Homebrew download; ancestry rejects a release from an arbitrary FixLang branch. Neither replaces code signing or notarization, so the cask preserves an explicit user-controlled Gatekeeper caveat.

## Source selection and validation

The workflow runs on an Apple Silicon macOS runner. It lists public GitHub Releases for FixLang, ignores drafts and prereleases, parses stable tags, and selects the greatest valid semantic version. If that greatest candidate fails any artifact, checksum, bundle, architecture, or ancestry check, the run fails; it never silently falls back to an older release.

Before rendering, the selected release must satisfy every check below. A failed check creates no cask commit.

1. The tag is exactly `vX.Y.Z`, with `X.Y.Z` passing the strict safe-integer parser.
2. The release is public, non-draft, and non-prerelease.
3. There is exactly one non-empty asset named `FixLang-X.Y.Z-arm64.dmg` and exactly one non-empty `SHA256SUMS.txt`. Extra assets are allowed but ignored.
4. The DMG is downloaded from the immutable URL `https://github.com/anhdd-kuro/fix-lang/releases/download/vX.Y.Z/FixLang-X.Y.Z-arm64.dmg`; `hdiutil verify` succeeds.
5. `SHA256SUMS.txt` has exactly one valid SHA-256 line for that exact filename, and it matches a locally computed digest of the downloaded DMG.
6. The read-only mounted image contains `FixLang.app`; its `CFBundleShortVersionString` equals `X.Y.Z`, its `CFBundleIdentifier` is exactly `com.fixlang.app`, and `lipo -archs` reports an `arm64` slice for the packaged executable.
7. Resolving `vX.Y.Z^{commit}` from the public FixLang Git repository proves the tag commit is an ancestor of current `origin/main`.

The expected bundle identifier is the workflow constant `com.fixlang.app`, taken from FixLang's packaging configuration; it is not inferred from the downloaded app. Temporary download and mount paths are cleaned through an exit trap, including best-effort disk-image detachment.

## Idempotency and no-downgrade policy

The workflow parses the literal version from existing `Casks/fixlang.rb` using the same strict parser.

- With no public stable FixLang release, it succeeds as an explicit no-op and creates no commit. This is the normal pre-`v0.2.0` state.
- With no cask and a validated release, it creates the first cask.
- With a release equal to the literal cask version, it succeeds as a no-op and never rewrites that version's checksum.
- With a release below the cask version, it succeeds as a no-op and reports a refused downgrade.
- Only a strictly greater validated version can replace the cask. A malformed existing cask is a hard failure, not authority to overwrite it.

This makes retries idempotent and prevents delayed API responses, retagging attempts, or an accidentally older release from rolling users back.

## Cask contract

For validated `X.Y.Z`, render only `Casks/fixlang.rb` from the fixed template:

```ruby
cask "fixlang" do
  version "X.Y.Z"
  sha256 "<validated lowercase SHA-256>"

  url "https://github.com/anhdd-kuro/fix-lang/releases/download/vX.Y.Z/FixLang-X.Y.Z-arm64.dmg"
  name "FixLang"
  desc "AI-powered writing correction for selected text"
  homepage "https://github.com/anhdd-kuro/fix-lang"

  depends_on arch: :arm64
  app "FixLang.app"

  caveats do
    unsigned_accessibility
    <<~EOS
      FixLang is currently unsigned. If macOS blocks an app you downloaded
      from this trusted release, run:

        xattr -dr com.apple.quarantine "/Applications/FixLang.app"
    EOS
  end
end
```

Only the validated version and checksum are substituted. The cask has a literal version and SHA-256 plus an immutable versioned GitHub URL. It must not use `auto_updates`, `livecheck`, `preflight`, `postflight`, or automated quarantine removal. In particular, it never runs `xattr`. `unsigned_accessibility` communicates possible Accessibility attention after replacement; the manual `xattr` caveat keeps Gatekeeper bypass explicit and user-controlled.

## Sync workflow sequence

1. Check out the tap with persisted credentials disabled, acquire the concurrency lock, and read public FixLang release and Git data.
2. Select and validate the release: strict semver, exact assets, checksum, `hdiutil`, mounted app version and bundle identifier, arm64 executable, and tag ancestry to `main`.
3. Compare the result with the literal cask version and exit cleanly for no-release, equal-version, or downgrade cases.
4. Render only `Casks/fixlang.rb` from the fixed template.
5. Run `brew style --cask`, `brew audit --cask`, and `brew fetch --cask` against the rendered cask. Failure restores the working tree and prevents a commit.
6. Commit that one cask file directly to `main` with `chore(cask): update fixlang to X.Y.Z`, then push using only the tap token.
7. In a fresh checkout/tap context, install by remote tap name—not the local working tree—using `brew install --cask anhdd-kuro/tap/fixlang --appdir <temporary-appdir>`. Verify `FixLang.app` exists only in that temporary app directory; run normal `brew uninstall --cask fixlang`; verify the temporary app is removed.

The smoke test never passes `/Applications` as `--appdir`, never uses `sudo`, and never uses `--zap`; it therefore never overwrites `/Applications/FixLang.app`. It occurs after the direct commit because it must prove the public consumer path. If it fails, cleanup still performs normal uninstall, then the workflow creates a direct revert commit restoring the previous cask state (or removing the first cask), and fails the run. This prevents a broken newly published cask from remaining the advertised state while preserving an auditable recovery history.

## User commands and trust

The tap README and, after the tap is live, FixLang README/docs state:

```sh
brew install --cask anhdd-kuro/tap/fixlang
brew update && brew upgrade --cask anhdd-kuro/tap/fixlang
```

Homebrew 6 may ask the user to trust a third-party tap before cask installation. Users can review and approve the prompt, or explicitly trust this cask first:

```sh
brew trust --cask anhdd-kuro/tap/fixlang
```

That command is optional, not a request to trust the whole tap blindly. Documentation repeats that Homebrew does not bypass Gatekeeper or grant Accessibility permission.

## Failure and recovery

| Condition | Result | Recovery |
| --- | --- | --- |
| No public stable release | Success/no-op, no commit. | Publish a real release, then dispatch. |
| GitHub API or network failure | Fail, no cask change. | Re-run after recovery. |
| Invalid version/assets/checksum/DMG/bundle/architecture/ancestry | Fail, no cask change. | Publish a new, higher corrected FixLang release; never replace public assets or move tags. |
| Same version | Success/no-op. | None; this is idempotency evidence. |
| Candidate lower than cask | Success/no-op with refusal. | Investigate; never automate a downgrade. |
| Homebrew style/audit/fetch failure | Fail, no cask commit. | Correct template or source, then dispatch. |
| Remote install/uninstall failure after commit | Revert direct cask commit and fail. | Inspect smoke-test log, correct cause, then synchronize a genuine later release. |

No recovery force-pushes, rewrites tags, replaces public assets, uses `--zap`, or targets `/Applications/FixLang.app`.

## Scope after tap creation

Initial work creates the public tap and its three files only. Once live, the minimum FixLang-repository work is README/docs installation guidance. No production FixLang updater or release-workflow change is required: PR #67's versioned unsigned arm64 DMG plus `SHA256SUMS.txt` contract is the tap's source.

## Acceptance criteria and evidence

| Requirement | Evidence |
| --- | --- |
| Public tap exists | Public tree shows cask, workflow, and README. |
| No cross-repo write access | Workflow permissions and secret settings show only tap `GITHUB_TOKEN` with `contents: write`. |
| Safe pre-release state | Dispatched workflow logs successful no-op and no commit. |
| Validation is real | Logs show selected tag, checksum equality, `hdiutil verify`, mounted version/identifier, arm64 result, and `main` ancestry. |
| Cask is correct | Committed cask has literal version/SHA/URL, arm64 dependency, app stanza, `unsigned_accessibility`, and manual `xattr` caveat; forbidden stanzas are absent. |
| Homebrew quality passes | `brew style --cask`, `brew audit --cask`, and `brew fetch --cask` pass. |
| Remote path is safe | Clean-context remote install/uninstall log uses temporary `--appdir`, normal uninstall, no `/Applications` target, and no `--zap`. |
| User path is documented | README has exact install/update commands and explains Homebrew 6 prompt plus optional explicit trust command. |
| Current behavior is honestly proven | Tests/fixtures cover no-release, same-version, malformed-cask failure, and lower-version refusal without fake versions. |
| Production upgrade is proven | A later genuine release, at least `0.2.1`, updates the public cask and is exercised with `brew upgrade --cask anhdd-kuro/tap/fixlang`; before then, this remains explicitly unproven. |

## Spec self-review

- **Placeholders:** `X.Y.Z` and the SHA placeholder occur only in the defined generic template and are workflow substitutions, not open decisions.
- **Consistency:** The tap is the sole cask writer, only its token writes there, and all validation precedes cask rendering. No-release and no-downgrade paths cannot commit.
- **Ownership:** FixLang publishes; the tap consumes; users make tap and unsigned-app trust decisions. No cross-repository authority is implied.
- **Scope:** This adds a tap and documentation only; signing/notarization and production updater/release-workflow changes are excluded.
- **Ambiguity resolved:** Invalid newest stable releases fail rather than fall back, final remote-test failures revert directly, and end-to-end upgrade proof waits for a real later release.
