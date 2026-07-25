---
name: fixlang-release-homebrew
description: "Use when cutting a FixLang release, editing .github/workflows/release.yml, or working on the Homebrew tap (anhdd-kuro/homebrew-tap: scripts/sync-fixlang.mjs, sync-fixlang.yml, the generated Casks/fixlang.rb). Examples: \"release 0.3.0\", \"brew install fails\", \"tap sync red\", \"node:sqlite bundle error in release\", \"new blank line at EOF\", \"casks must be in a tap\", \"brew upgrade proof\". Covers release trigger, orphan-tag resume, cask generation + brew style/audit traps."
---

# FixLang — Release + Homebrew Distribution Traps

Two repos. App = `anhdd-kuro/fix-lang`. Tap = `anhdd-kuro/homebrew-tap` (separate).
GitHub Releases = source of truth. Tap copies validated metadata only. Apple Silicon / arm64 only. App unsigned, not notarized — never automate Gatekeeper/`xattr`.

## Cut release

Bump `package.json` version to strictly higher stable semver. PR to `main`. Merge.
Push to `main` fires `.github/workflows/release.yml`:
- `prepare` (ubuntu): semver + monotonic + tag-ancestry checks, creates `v<version>` tag.
- `release` (macos-14): lint, test, build, `electron-builder --mac --arm64`, validate DMG (hdiutil + PlistBuddy version/bundle-id + arm64), publish `FixLang-<v>-arm64.dmg` + `SHA256SUMS.txt` from draft → public.

Verify after: checksum in `SHA256SUMS.txt` == GitHub asset digest; bundle `CFBundleShortVersionString` == version; `CFBundleIdentifier` == `com.fixlang.app`; arch arm64; tag on main.

Docs-only push to main re-fires workflow but NO-OPS: `prepare` sees `release_is_public(v<version>)` → `should_publish=false`. Safe.

## TRAP 1 — release Test step: `node:sqlite` bundle fail (macos runner Node)

Symptom (release job Test step only, passes locally):
```
Error: Cannot bundle Node.js built-in "node:sqlite" imported from "src/stores/historyDb.ts"
```
Cause: `macos-14` runner default Node (~20) omits `node:sqlite` from `module.builtinModules`. vite/rolldown then refuse to externalize it for the jsdom (client) test env → 2 suites fail to load (`historyRepo.test.ts`, `correction-preset-options.test.ts`). Local Node 24 lists it → 405/405 pass. Same bun/vite/vitest both sides — Node version is the only diff. `bun run test` runs vitest under `node` (shebang), not bun, so runner Node matters.

Fix (already in release.yml): pin Node 24 in the `release` job right after Set up Bun:
```yaml
      - name: Set up Node
        uses: actions/setup-node@<v4 sha>
        with:
          node-version: "24"
```
If bumping the app's min Node again, re-check this pin. Keep macos runner Node >= where `node:sqlite` is a listed builtin.

## Retry a failed release — orphan tag resume

`prepare` creates the tag BEFORE `release` builds. Failed build = tag exists, no public release ("orphan tag"). `prepare` is idempotent (release.yml ~147-170): if tag exists, is ancestor of pushed SHA, tagged package version matches, and no public release → **resumes** publication. It REFUSES to move a tag.

So to retry: push a NEW commit to `main` (descendant of the tagged commit). Workflow-only fix (e.g. Node pin) still takes effect because the JOB DEFINITION comes from the pushed commit while the `release` job checks out the SOURCE from the tag. Do NOT delete/move the tag.

## Homebrew tap sync (`anhdd-kuro/homebrew-tap`)

Workflow `sync-fixlang.yml` runs on schedule + `workflow_dispatch`. Steps: discover releases (GH_TOKEN, cleared after), `decideCaskSync` (newer-release → update), render cask, `git add`, whitespace check, `brew style/audit/fetch`, commit, push, smoke install/uninstall in temp appdir.
NOTE: no-release / no-op runs exit BEFORE render+style. The render/style/audit path is only exercised on a REAL first/newer release — latent bugs there hide until then.

Cron is `17 */6 * * *` — **up to 6h between a GitHub release and the cask carrying it**. Dispatch manually to skip the wait:
```bash
gh workflow run sync-fixlang.yml --repo anhdd-kuro/homebrew-tap
```

### TRAP 0 — app checks GitHub, installs from the tap. Those disagree for hours.

Settings → About reads **GitHub Releases**. **Update now** runs **the tap cask**. Right after a release the app offers vX while the cask still has vX-1.

`brew upgrade --cask fixlang` **exits 0** in that window:
```
Warning: Not upgrading fixlang, the latest version is already installed
```
Exit 0 = the detached helper walks on to `open -b com.fixlang.app`. Observed symptom: **click Update now → app quits → app reopens → same version, no error.** Looks like a dead button. Real log evidence lives in `userData/logs/homebrew-update.log` (brew's own warning) and `userData/logs/<date>/fixlang.jsonl` (`Homebrew update did not change the app version`).

Guard, in `updateService.installUpdate` (`src/main/update/updateService.ts`): probe `HomebrewUpgrader.getInstallableVersion()` (= `brew update --quiet` then `brew info --cask fixlang --json=v2` → `casks[].version`) and publish `error` + `tapBehindMessage` instead of quitting when the tap is behind. Rules:
- Probe **must not reject** — a broken probe returns null and the install proceeds. Blocking on an unknown answer would break the button whenever brew is slow or odd.
- Only a **parsed strictly-lower** version blocks. null / non-semver → proceed.
- `installing = true` is claimed **before** the first `await` (probe takes ~1-3s warm; a second click must not start a second upgrade).
- The probe needs `brew update` first: the local tap clone is what `brew info` reads, and its staleness is the whole point.

WHY THIS WAS MISSED FIRST TIME: every test injects a fake upgrader/`startDetached`, so no test ever runs real brew; `homebrew.test.ts` only asserts the generated script's text. And `canInstall` answers "did brew install this app?" — not "can brew supply the version being offered?" The two read as the same question until the tap lags. It also could not be exercised end-to-end at build time: proving the button needs a release *newer* than the one being cut.

Marker reconciliation (`pending-update.json`) does catch this on relaunch, but a subsequent update check overwrites that `error` state with `available` again — so the user just sees the button re-arm. Don't rely on reconcile alone as the user-facing report.

### TRAP 2 — cask write doubles newline

`renderCask()` returns string ending in exactly one `\n`. Write with `jq -je` (join-output, no appended newline), NOT `jq -er`. `jq -r`/`-er` appends its own `\n` → `end\n\n` → `git diff --cached --check` fails:
```
Casks/fixlang.rb:NN: new blank line at EOF.
```
(Scalar `jq -er '.kind'`/`.version` in `$( )` are fine — command substitution strips the newline. Only the file WRITE must use `-je`.)

### TRAP 3 — `brew style/audit/fetch` need a registered tap

Recent Homebrew rejects a bare cask file path:
```
Homebrew requires casks to be in a tap, rejecting: Casks/fixlang.rb
```
Fix (in sync-fixlang.yml): symlink checkout into taps dir, validate by qualified token, remove symlink BEFORE smoke step:
```bash
readonly HOMEBREW_TAP_LINK="$(brew --repository)/Library/Taps/anhdd-kuro/homebrew-tap"
mkdir -p "$(dirname "$HOMEBREW_TAP_LINK")"
ln -sfn "$GITHUB_WORKSPACE" "$HOMEBREW_TAP_LINK"
brew style --cask anhdd-kuro/tap/fixlang
brew audit --cask anhdd-kuro/tap/fixlang
brew fetch --cask anhdd-kuro/tap/fixlang
rm -f "$HOMEBREW_TAP_LINK"
```
Must `rm` the link: the later smoke step refuses to run if `anhdd-kuro/tap` is already tapped.

### TRAP 4 — generated cask must pass brew style + audit

`renderCask` in `scripts/sync-fixlang.mjs` must emit:
- URL with Ruby interpolation `#{version}`, NOT literal version. Literal → audit error "Use `sha256 :no_check` when URL is unversioned". `#{version}` is injection-safe: version validated as strict semver first. (In the JS template literal, write `#{version}` literally — JS uses `${...}`, so `#{...}` passes through.)
- `depends_on :macos` (after `depends_on arch: :arm64`, same group) — else style OSDependsOn offense.
- One blank line before `app "FixLang.app"` — StanzaGrouping.
- Keep real `sha256` (never `:no_check`). No `auto_updates`, `livecheck`, `preflight`, `postflight`, no automatic `xattr`.
Update the pinned contract test (`scripts/sync-fixlang.test.mjs`) byte-for-byte when changing renderCask output.

## Reproduce brew checks LOCALLY (skip slow CI loops)

```bash
REPO=<tap checkout>
node "$REPO/scripts/sync-fixlang.mjs" <<< '{"action":"decide-cask","release":{"version":"X.Y.Z","digest":"<64hex>"},"existingCask":null,"allowInitialCreate":true}' | jq -je '.cask' > "$REPO/Casks/fixlang.rb"
LINK="$(brew --repository)/Library/Taps/anhdd-kuro/homebrew-tap"
mkdir -p "$(dirname "$LINK")"; ln -sfn "$REPO" "$LINK"
brew style --cask anhdd-kuro/tap/fixlang
brew audit --cask anhdd-kuro/tap/fixlang
brew fetch  --cask anhdd-kuro/tap/fixlang
rm -f "$LINK"; rm -f "$REPO/Casks/fixlang.rb"   # cleanup
```

## Prove `brew upgrade` (needs two real releases)

Never fabricate a version. With a genuine higher release available:
```bash
export HOMEBREW_CASK_OPTS="--appdir=$SOME_TEMP_DIR"   # keep out of /Applications
brew tap anhdd-kuro/tap https://github.com/anhdd-kuro/homebrew-tap
brew install --cask anhdd-kuro/tap/fixlang            # OLD version (before tap syncs new)
# ... publish new release + sync tap cask ...
brew update && brew upgrade --cask fixlang            # OLD -> NEW
# verify CFBundleShortVersionString changed
brew uninstall --cask fixlang; brew untap anhdd-kuro/tap   # cleanup
```
Never touch `/Applications`, never launch the app, no `sudo`, no `xattr`, no `--zap` in automation.

## Public install (what users run)

```bash
brew install --cask anhdd-kuro/tap/fixlang   # auto-taps anhdd-kuro/tap
brew update && brew upgrade --cask fixlang    # later releases
```
