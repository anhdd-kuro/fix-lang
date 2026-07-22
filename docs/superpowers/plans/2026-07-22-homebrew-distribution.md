# Homebrew Tap Distribution Implementation Plan

> **For implementation agents:** This plan deliberately uses an independent public
> `anhdd-kuro/homebrew-tap` repository. Do not add a Homebrew cask, a tap token,
> or a cross-repository workflow to FixLang. Execute stages in order and keep
> ownership boundaries intact.

**Goal:** Apple Silicon users can install a verified public FixLang release and
receive later releases through:

```sh
brew install --cask anhdd-kuro/tap/fixlang
brew update && brew upgrade --cask anhdd-kuro/tap/fixlang
```

**Architecture:** FixLang continues to publish immutable unsigned arm64 DMGs
and `SHA256SUMS.txt` from GitHub Releases. The tap pulls and validates the newest
eligible public release, then writes its own cask using only the tap's
`GITHUB_TOKEN`. Homebrew never builds, signs, notarizes, or auto-installs
FixLang.

**Prerequisite and stop rule:** PR [#67](https://github.com/anhdd-kuro/fix-lang/pull/67)
must be merged into `main`, and the user must explicitly authorize publishing
the real `v0.2.0` release. Until that public release is verified, bootstrap and
test the tap's **no-release** behavior only. Do not manufacture a tag, DMG, or
cask merely to make a test pass.

## Deliverables and ownership

| Owner | Repository / paths | Deliverable | Must not modify |
| --- | --- | --- | --- |
| Bootstrap agent | isolated `/private/tmp/fixlang-homebrew-tap-*` worktree | public `anhdd-kuro/homebrew-tap` with its initial history | FixLang files, the user’s existing dirty files, `AGENTS.md` |
| Tap-logic agent | `scripts/sync-fixlang.mjs`, `scripts/sync-fixlang.test.mjs`, optional test fixtures under `scripts/fixtures/` | dependency-free strict version, release-selection, cask parse/render, and decision logic | workflow, README, generated cask |
| Tap-workflow agent | `.github/workflows/sync-fixlang.yml` | secure scheduled/manual orchestration and platform validation | sync script behavior/tests, README |
| Tap-docs agent | `README.md` | exact user commands, trust/Gatekeeper limits, maintainer usage | workflow, scripts, Cask |
| Cask-sync agent | `Casks/fixlang.rb` only, created after a verified public release | literal versioned cask produced by the workflow | bootstrap/test/workflow/docs files |
| FixLang-docs agent | `README.md` and only directly related docs in FixLang | Homebrew install/update guidance after remote tap verification | FixLang release workflow and package configuration |
| Fresh review agent | read-only review of both repositories | independent findings plus verification evidence | no edits unless delegated a follow-up |

The initial tap has no tracked `Casks/fixlang.rb`: an empty directory cannot be
tracked, and committing a placeholder cask would violate the no-cask-before-
release rule. The workflow creates `Casks/` only when it has validated a real
public release.

## Stage 0 — Readiness gate and isolated bootstrap

**Owner:** Bootstrap agent. **Working location:** a new uniquely named
directory under `/private/tmp`, never the FixLang checkout.

1. Record the starting state as evidence: FixLang branch/commit, PR #67 state,
   `package.json` version, public release/tag list, and whether
   `anhdd-kuro/homebrew-tap` already exists. Treat GitHub and the current
   worktree as authoritative; do not rely on a previous chat claim.
2. If PR #67 is unmerged, stop before a public release. It is still safe to
   create/test the no-release tap infrastructure. If it is merged but explicit
   authorization to publish `v0.2.0` has not been given, stop at that same
   release boundary and request the authorization through the structured user
   input tool.
3. Create a clean temporary bootstrap repository, for example
   `/private/tmp/fixlang-homebrew-tap-YYYYMMDDHHMMSS`, with `main` as its
   initial branch. Do not clone into, write inside, or clean another checkout.
4. Add only the initial tap files listed in Stage 1. Run their local tests
   before making the repository public.
5. Create `anhdd-kuro/homebrew-tap` as a **public** GitHub repository with
   default branch `main`, add it as `origin`, and push the initial commit.
   This is an external, irreversible visibility change: perform it only under
   the user’s existing implementation authorization; if that authorization is
   no longer clear, require explicit confirmation first. Do not create a PAT,
   deploy key, GitHub App, repository secret, or cross-repository permission.

**Initial commit:** `chore(tap): bootstrap FixLang cask synchronization`.

**Evidence:** the public repository URL; default branch `main`; a clean
temporary worktree; pushed commit SHA; and `git show --stat` proving the commit
contains only the initial tap infrastructure.

## Stage 1 — Define the tap’s testable local contract (RED first)

**Owner:** Tap-logic agent. **Files owned:**

```text
scripts/sync-fixlang.mjs
scripts/sync-fixlang.test.mjs
scripts/fixtures/                 # only if small static JSON/text fixtures improve clarity
```

Use the runner-provided Node runtime and the built-in `node:test` plus
`node:assert/strict`; do not install Bun, Ruby gems, npm packages, jq packages,
or test-only Actions. The production entry point must be importable by the test
file, with I/O adapters injected so behavior can be tested without GitHub,
Homebrew, network, disk-image, or Git state.

### RED checkpoint

Create `scripts/sync-fixlang.test.mjs` first and run:

```sh
node --test scripts/sync-fixlang.test.mjs
```

The initially failing tests must prove every pure-policy branch below before
implementation begins:

1. `X.Y.Z` accepts only strict stable components: `0` or a nonzero digit then
   digits; rejects leading zeroes, prerelease/build suffixes, missing parts,
   whitespace, negatives, and components outside JavaScript safe integers.
2. Version comparison uses `BigInt` component ordering, including values where
   lexical/Number ordering would be wrong.
3. Release selection ignores draft/prerelease/malformed tags and chooses the
   greatest valid public candidate. If that greatest candidate later fails
   validation, the workflow fails rather than selecting an older candidate.
4. With no valid public release, the decision is a successful no-op and no
   render/commit action is permitted.
5. An existing literal cask at the same version is a no-op; a candidate below
   it is a no-op with an explicit refused-downgrade reason; a malformed or
   missing literal `version` is a hard error; only a greater version permits an
   update.
6. `SHA256SUMS.txt` parsing requires exactly one syntactically valid lowercase
   SHA-256 entry for the exact DMG basename and rejects duplicate, absent,
   malformed, or wrong-file entries. It returns data, never a shell fragment.
7. Cask rendering changes only a fixed version and validated lowercase digest;
   the output has the required literal URL, arm64 dependency, app stanza, and
   caveats, and has none of `auto_updates`, `livecheck`, `preflight`,
   `postflight`, or executable `xattr` behavior.

### GREEN implementation

Implement the small exported pure functions and a CLI wrapper that receives
already-fetched release/Git data and writes an output decision suitable for the
workflow. Keep remote calls and macOS commands in the workflow, not hidden in
JavaScript. The renderer must be a fixed local string/template; remote release
title/body/URLs/checksum text must never be interpolated into Ruby except for
the already validated version and digest.

The rendered cask contract is exactly:

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

Run the same test command again as the GREEN checkpoint. Add a focused
regression test before every bug fix in this logic.

**Commit:** `test(tap): define FixLang cask sync policy` for RED tests, then
`feat(tap): implement FixLang cask sync policy` for GREEN. If a temporary
initial test commit would leave the public default branch red, keep RED local
and publish only once GREEN passes; retain the two commits in the source
history when practical.

**Evidence:** captured failing RED output, green `node --test` output, and a
diff showing no credentials, network dependencies, or generated cask.

## Stage 2 — Implement secure synchronization and release validation

**Owner:** Tap-workflow agent. **File owned:**

```text
.github/workflows/sync-fixlang.yml
```

Use a single workflow with these triggers:

```yaml
on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:
```

Set workflow-level `permissions: { contents: read }`, then grant only the job
that commits the cask `contents: write`. Set `concurrency.group` to a stable
tap-specific name and `cancel-in-progress: false`. Pin every third-party Action
by immutable commit SHA; use `actions/checkout` with
`persist-credentials: false`. The only credential is the tap repository’s
`secrets.GITHUB_TOKEN`, used for direct commits to this repository.

Implement these workflow steps, keeping command boundaries explicit and
`set -euo pipefail` in shell blocks:

1. Check out `homebrew-tap` on `main` with full history. Fetch FixLang public
   Git history without persisted credentials. Query public GitHub Releases
   (GitHub CLI with `GH_TOKEN` restricted to the tap token is sufficient) and
   pass machine-readable data to Stage 1’s policy CLI.
2. On the no-release decision, write a clear summary such as `No valid public
   stable FixLang release; no cask changed`, exit 0, and demonstrate via
   `git diff --exit-code` that it made no commit. This must work before
   `v0.2.0` exists.
3. For a selected release, revalidate the strict `vX.Y.Z` tag and require
   exactly one non-empty `FixLang-X.Y.Z-arm64.dmg` and one non-empty
   `SHA256SUMS.txt` asset. Additional assets are ignored. Download from the
   versioned immutable GitHub URL, not browser download redirects or an API
   URL copied from release metadata.
4. Parse the checksum file through the tested parser. Compute the DMG digest
   locally with `shasum -a 256`; require equality before any cask write. Never
   source, evaluate, or execute checksum contents.
5. Run `hdiutil verify`. Mount only after checksum validation using a unique
   temporary mountpoint, `-readonly -nobrowse -noverify`; install an `EXIT`
   trap before attaching so it always attempts detach and cleanup. Do not open
   or launch `FixLang.app`.
6. Inspect the mounted `FixLang.app/Contents/Info.plist` with
   `/usr/libexec/PlistBuddy`. Require `CFBundleShortVersionString == X.Y.Z` and
   `CFBundleIdentifier == com.fixlang.app`. Locate the packaged executable and
   require `lipo -archs` to contain an `arm64` slice.
7. Resolve `vX.Y.Z^{commit}` from the fetched FixLang repository and require
   `git merge-base --is-ancestor <tag-commit> origin/main`. Do not trust
   `target_commitish`.
8. Read the existing literal `Casks/fixlang.rb` through the tested parser and
   apply the exact no-op/no-downgrade policy. If a newer release passes all
   validation, invoke the local renderer to write **only**
   `Casks/fixlang.rb`.
9. Before committing, run:

   ```sh
   node --test scripts/sync-fixlang.test.mjs
   brew style --cask Casks/fixlang.rb
   brew audit --cask Casks/fixlang.rb
   brew fetch --cask Casks/fixlang.rb
   git diff --check
   ```

   A failure must leave no commit. Restore only the generated Cask file in the
   ephemeral runner checkout, never use force push or history rewrite.
10. Directly commit the one file with
    `chore(cask): update fixlang to X.Y.Z` and push `main` with the tap token.
    Assert the staged path list contains exactly `Casks/fixlang.rb`.

**Commit:** `ci(tap): synchronize verified FixLang releases`.

**Evidence:** workflow YAML has the required trigger, concurrency, SHA-pinned
Actions, least permissions, and no secret/PAT references. A manual pre-release
run shows an explicit successful no-op; no Cask path and no commit exist.

## Stage 3 — Remote-consumer install/uninstall smoke test and recovery

**Owner:** Tap-workflow agent (same file as Stage 2; do not split ownership).

After the direct cask commit/push succeeds, execute the test from a clean
temporary directory and use the remote name, not `brew install --cask
./Casks/fixlang.rb` or a local tap path:

```sh
temporary_appdir="$(mktemp -d)"
brew install --cask anhdd-kuro/tap/fixlang --appdir "${temporary_appdir}"
test -d "${temporary_appdir}/FixLang.app"
brew uninstall --cask fixlang
test ! -e "${temporary_appdir}/FixLang.app"
```

Use an exit trap to run normal `brew uninstall --cask fixlang` only if the
test installed the cask, then remove the unique temporary directory. Never
use `sudo`, `--zap`, `xattr`, `/Applications`, or an existing user app path.
The workflow must log the actual `--appdir` and prove it is under the temporary
directory before invoking Homebrew.

If this remote-consumer test fails after the cask was committed, make a normal
direct revert commit that restores the prior cask state (or removes the first
cask), push it using the same tap-only token, and fail the workflow. Do not
force-push, amend published history, or silently leave the broken cask live.

**Evidence:** workflow log shows the remote tap install, temporary app exists,
normal uninstall succeeds, and the temporary app is gone. The log must prove
there was no `/Applications/FixLang.app` target and no prohibited option.

## Stage 4 — Publish the first real cask only after public v0.2.0

**Owners:** FixLang maintainer for release authorization/publication; tap
workflow agent for synchronization. This is an external-action gate, not an
engineering substitute.

1. Confirm PR #67 merged to FixLang `main`, with the exact release workflow
   and package version present in the merged commit.
2. Request and receive explicit user authorization to publish the real
   `v0.2.0`; record the authorization in task commentary/evidence. Do not infer
   it from approval of this plan or tap creation.
3. Publish through the FixLang workflow. Verify the public release—not merely
   a tag or draft—contains non-empty `FixLang-0.2.0-arm64.dmg` and
   `SHA256SUMS.txt`, and preserve the resulting URLs/checksums in run evidence.
4. Manually dispatch `sync-fixlang.yml`. It must select `v0.2.0`, pass the
   complete Stage 2 validation chain, generate `Casks/fixlang.rb`, commit only
   that file, and pass Stage 3 remote install/uninstall.
5. Inspect the public cask as fetched from `main`. Verify the literal version,
   checksum, versioned URL, `depends_on arch: :arm64`, `app "FixLang.app"`,
   `unsigned_accessibility`, and explicit manual quarantine caveat. Confirm
   forbidden `auto_updates`, `livecheck`, `preflight`, `postflight`, and
   executable `xattr` behavior are absent.

**Expected cask commit:** `chore(cask): update fixlang to 0.2.0`.

**Evidence:** public Release URL and assets; successful sync run; public cask
commit SHA; `brew style`, `brew audit`, `brew fetch`, and remote temporary
install/uninstall output; and an inspection proving the installed app is not
under `/Applications`.

## Stage 5 — Add FixLang user documentation after the tap works

**Owner:** FixLang-docs agent. **Files owned:** `README.md` and, only if needed
for a reciprocal link, a directly related existing user-facing documentation
file. Do not modify the release workflow, package configuration, updater, or
unrelated files.

After Stage 4 evidence exists, add a concise install/update section containing
the exact commands:

```sh
brew install --cask anhdd-kuro/tap/fixlang
brew update && brew upgrade --cask anhdd-kuro/tap/fixlang
```

Document that Homebrew may ask to trust the third-party cask and users can
review it or run the optional narrow command:

```sh
brew trust --cask anhdd-kuro/tap/fixlang
```

State clearly that FixLang is unsigned, Homebrew does not bypass Gatekeeper or
grant Accessibility permission, and the user—not the cask—may choose to run
the documented manual `xattr` command if macOS blocks the app. Do not promise
automatic in-app updating.

**Commit:** `docs: document Homebrew installation`.

**Evidence:** rendered README contains correct public tap commands and the
unsigned-app/trust caveats, with no claim that `brew upgrade` has already been
proven in production.

## Stage 6 — Genuine future upgrade proof

`v0.2.0` can prove remote installation and idempotency, but cannot prove an
upgrade from one public cask version to another. Mark the following as
**explicitly unproven** until a later genuine release such as `v0.2.1` exists:

```sh
brew update && brew upgrade --cask anhdd-kuro/tap/fixlang
```

When a later real, immutable FixLang release is authorized and published:

1. Dispatch the tap workflow and require its greater-version branch to publish
   the new cask after the full Stage 2 validation and Stage 3 remote smoke
   test.
2. In a clean consumer context that first installed the earlier public cask,
   run the user-facing update/upgrade command against the remote tap and
   temporary `--appdir`. Verify the bundle version changes from the old public
   version to the new public version.
3. Use normal `brew uninstall --cask fixlang`, then verify the temporary app is
   removed. Do not use `--zap`, `xattr`, or `/Applications` in this proof.

**Expected cask commit:** `chore(cask): update fixlang to 0.2.1` (or the actual
later valid version).

**Evidence:** public releases for both versions; public cask history showing a
monotonic change; a clean-context remote `brew upgrade` log; before/after
`CFBundleShortVersionString`; and cleanup evidence. Until this stage completes,
report “install and synchronization verified; production upgrade pending a
genuine later release,” never “upgrade verified.”

## Stage 7 — Independent review and completion audit

**Owner:** a fresh agent with no implementation ownership. It must inspect the
current public tap, FixLang `main`, workflow history, and test logs rather than
accepting earlier agent summaries.

Review checklist:

- [ ] The public repository exists, defaults to `main`, and uses no
  cross-repository credentials, PAT, deploy key, GitHub App, or secret.
- [ ] All listed actions are pinned to commit SHA; workflow permissions are
  least privilege; checkout does not persist credentials; concurrency prevents
  overlapping writers.
- [ ] Tests were RED before logic, are dependency-free, pass, and cover strict
  semver/BigInt, newest-candidate failure, no release, equal/lower version,
  malformed cask, checksum parsing, and safe rendering.
- [ ] No release produces no cask commit. A failed newest candidate cannot
  fall back. Malformed casks cannot be overwritten. Equal/lower releases
  cannot rewrite a checksum or downgrade users.
- [ ] The validation order is release/assets → checksum → DMG verify/mount →
  plist/identifier/arm64 → tag ancestry → cask render → Homebrew quality →
  one-file commit → remote consumer smoke test.
- [ ] The Cask has the exact required immutable URL and safe caveat contract;
  it does not auto-update, run hooks, or run `xattr`.
- [ ] The smoke test used remote `anhdd-kuro/tap/fixlang`, a unique temporary
  `--appdir`, normal uninstall, and never touched `/Applications/FixLang.app`.
- [ ] A smoke-test failure would create a direct revert commit and fail; no
  recovery force-pushes, retags, or replaces public assets.
- [ ] FixLang documentation was added only after a working public cask and
  makes no overclaim about a production upgrade.
- [ ] Every changed repository is clean apart from knowingly unrelated user
  changes; commits match the stage boundaries and contain no secrets,
  generated app artifacts, or user files.

Run the appropriate final verification suite:

```sh
# homebrew-tap
node --test scripts/sync-fixlang.test.mjs
brew style --cask Casks/fixlang.rb
brew audit --cask Casks/fixlang.rb
brew fetch --cask Casks/fixlang.rb
git diff --check

# FixLang README-only integration
bun run lint
bun run test
git diff --check
```

The review may approve only if all completed stages have direct evidence. It
must separately report the future-real-release upgrade limitation if Stage 6
has not happened. Address P0–P2 findings, repeat the affected checks, then
make the final documentation commit/review report. Do not claim the overall
goal complete until Stage 6’s genuine upgrade evidence exists.

## Commit and evidence ledger

| Stage | Repository | Commit | Required proof |
| --- | --- | --- | --- |
| Bootstrap | `homebrew-tap` | `chore(tap): bootstrap FixLang cask synchronization` | public repo/main, isolated bootstrap, clean push |
| RED contract | `homebrew-tap` | `test(tap): define FixLang cask sync policy` | failing then passing `node --test` evidence |
| GREEN contract | `homebrew-tap` | `feat(tap): implement FixLang cask sync policy` | policy coverage/no dependencies |
| Workflow | `homebrew-tap` | `ci(tap): synchronize verified FixLang releases` | pinned/minimal workflow plus pre-release no-op |
| First cask | `homebrew-tap` | `chore(cask): update fixlang to 0.2.0` | real public release and remote install/uninstall |
| User docs | `fix-lang` | `docs: document Homebrew installation` | README after tap works |
| Later cask | `homebrew-tap` | `chore(cask): update fixlang to <later version>` | remote genuine `brew upgrade` proof |

## Plan self-review

- **Missing dependencies:** Node’s built-in test runner and Homebrew/macOS
  tooling are available on the selected macOS runner; no package install is
  required. GitHub CLI access is public-read plus the tap’s own token write
  scope. The first cask remains gated on an actual public FixLang release.
- **Ownership:** script tests/logic, workflow, docs, generated cask, and
  FixLang README are non-overlapping. The only same-file ownership is workflow
  implementation plus smoke-test recovery, intentionally kept together so the
  transaction cannot drift.
- **External approvals:** making a public repository and direct tap commits are
  within the implementation authorization but must not be assumed if revoked;
  publishing `v0.2.0` explicitly requires separate user authorization. No PAT
  or cross-repo credential is permitted.
- **Goal proof:** “install” requires public cask plus remote temporary
  installation; “update” requires two genuine public releases and a remote
  `brew upgrade` before/after version check. The plan forbids treating mocked
  versions, cask rewrites, or a single-release install as upgrade proof.
