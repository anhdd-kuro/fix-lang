---
name: fixlang-release-homebrew
description: "Use when cutting a FixLang release, editing .github/workflows/release.yml, working on the Homebrew tap (anhdd-kuro/homebrew-tap: scripts/sync-fixlang.mjs, sync-fixlang.yml, the generated Casks/fixlang.rb and fixlang@beta.rb), or touching the in-app update service, its in-flight claim, or release-notes rendering. Examples: \"release 0.3.0\", \"brew install fails\", \"tap sync red\", \"cask conflicts_with\", \"node:sqlite bundle error in release\", \"new blank line at EOF\", \"casks must be in a tap\", \"brew upgrade proof\", \"release notes render wrong\". Covers release trigger, orphan-tag resume, cask generation + brew style/audit traps, the TWO cask tokens the tap must emit, the single in-flight flag, and untrusted release notes."
---

# FixLang — Release + Homebrew Distribution Traps

Two repos. App = `anhdd-kuro/fix-lang`. Tap = `anhdd-kuro/homebrew-tap` (separate).
GitHub Releases = source of truth. Tap copies validated metadata only. Apple Silicon / arm64 only. App unsigned, not notarized — never automate Gatekeeper/`xattr`.

**TWO cask tokens, not one.** `fixlang` (stable) and `fixlang@beta` (pre-release),
emitted by **one** sync run so they cannot drift, each declaring `conflicts_with`
the other so brew itself refuses both at once. This is not decoration: it is the
only channel mechanism Homebrew offers (no cask downgrade exists), and the app
switches channels by uninstalling one token and installing the other. Ship one
cask, or two without the mutual `conflicts_with`, and both install on every
machine — the app then reads `activeChannel: "both"` and **refuses both the
switch and the Revert**, i.e. the escape hatch is gone for everyone, and no test
in THIS repository can catch it because the tap is a different repo. Everywhere
below that says `fixlang` in a Caskroom path or a brew argv, the code takes a
**token parameter**. Before touching the tap, the update service, or anything
that names a cask: read [Pre-release channel](../fixlang-prerelease-channel/SKILL.md).

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
Error: Cannot bundle Node.js built-in "node:sqlite" imported from "src/features/history/store/historyDb.ts"
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

### TRAP 0-A — two apps, one bundle id. `open -b` reopen wrong one.

Symptom: upgrade succeed, app come back **older** (brew put 0.5.0 in `/Applications`, app say 0.4.5). Not a brew failure — brew log show `🍺 successfully upgraded`, `/Applications/FixLang.app` really is new.

Cause: `bun run pack:mac` build in checkout carry same `com.fixlang.app`. Helper end with `open -b <id>`; brew just did `Removing App` + `Moving App`, so LaunchServices registration for `/Applications` can be gone that instant → id resolve to stray build → old app open. Intermittent (race), so it look random.

Find every copy:
```bash
mdfind 'kMDItemCFBundleIdentifier == "com.fixlang.app"' | while read -r p; do echo "$(defaults read "$p/Contents/Info.plist" CFBundleShortVersionString)  $p"; done
```

Fixes now in tree — keep all four:
- Helper reopen **path**, not id: `open -a "<pending.appPath>"`, id only fallback (`buildReopenCommand`). Path pass `isSafeBundlePath` before it reach `/bin/sh`.
- `reconcilePendingInstall` compare `toVersion` **and** `appPath`. Old test was `currentVersion !== fromVersion` = "any change is success" → report a DOWNGRADE as installed update. Path mismatch → `wrong-bundle` → `restart-required` + `wrongBundleMessage`.
- Restart open `pending.appPath` instead of `process.execPath`. Re-exec from stray copy relaunch stray copy forever.
- `pack:mac` build as `com.fixlang.app.dev` / `FixLang Dev` so it never compete again. `pack:mac:prod` for production identity. Dev build still share `userData` — `app.getName()` read packaged `package.json` `name`, which CLI `-c.productName` do not touch.

Log evidence: `Homebrew update to 0.4.8 started`, then seconds later `App updated to 0.4.5 via Homebrew`. Target version and reported version disagree = this trap, not a failed upgrade.

### TRAP 0 — app checks GitHub, installs from the tap. Those disagree for hours.

Settings → About reads **GitHub Releases**. **Update now** runs **the tap cask**. Right after a release the app offers vX while the cask still has vX-1.

`brew upgrade --cask fixlang` **exits 0** in that window:
```
Warning: Not upgrading fixlang, the latest version is already installed
```
Exit 0 = the detached helper walks on to `open -b com.fixlang.app`. Observed symptom: **click Update now → app quits → app reopens → same version, no error.** Looks like a dead button. Real log evidence lives in `userData/logs/homebrew-update.log` (brew's own warning) and `userData/logs/<date>/fixlang.jsonl` (`Homebrew update did not change the app version`).

**Real fix (do this first): make the CHECK ask brew too.** `checkForUpdates` now offer `getInstallableVersion()` for cask install — same source as button. GitHub run in parallel but only give release notes + DMG size, and only when it describe the exact version being offered (else notes/size belong to different release = lie). Published-but-unsynced release → phase `up-to-date` + `tapPendingMessage`, never an offer. Same state still carry that release's `releaseNotes` and set `releaseUrl` to its tag → panel show what changed + **Download from GitHub** button. Withhold only DMG size: it feed download bar for an install that cannot run. "Cannot install" ≠ "cannot read" — user still need to see what they wait for. Cost: routine check read local tap clone (`getInstallableVersion(false)`); `brew update` is git fetch across EVERY tap, too heavy per check — pay for it only when GitHub show something newer. Fall back to GitHub for manual DMG install, and for cask when brew probe return null.

Guard below still needed even so: brew can answer null at check time (target then come from GitHub) and answer lower at click time. Defense in depth, not dead code.

Guard, in `updateService.installUpdate` (`src/main/update/updateService.ts`): probe `HomebrewUpgrader.getInstallableVersion()` (= `brew update --quiet` then `brew info --cask fixlang --json=v2` → `casks[].version`) and publish `error` + `tapBehindMessage` instead of quitting when the tap is behind. Rules:
- Probe **must not reject** — a broken probe returns null and the install proceeds. Blocking on an unknown answer would break the button whenever brew is slow or odd.
- Only a **parsed strictly-lower** version blocks. null / non-semver → proceed.
- `installing = true` is claimed **before** the first `await` (probe takes ~1-3s warm; a second click must not start a second upgrade).
- The probe needs `brew update` first: the local tap clone is what `brew info` reads, and its staleness is the whole point.

WHY THIS WAS MISSED FIRST TIME: every test injects a fake upgrader/`startDetached`, so no test ever runs real brew; `homebrew.test.ts` only asserts the generated script's text. And `canInstall` answers "did brew install this app?" — not "can brew supply the version being offered?" The two read as the same question until the tap lags. It also could not be exercised end-to-end at build time: proving the button needs a release *newer* than the one being cut.

Marker reconciliation (`pending-update.json`) does catch this on relaunch, but a subsequent update check overwrites that `error` state with `available` again — so the user just sees the button re-arm. Don't rely on reconcile alone as the user-facing report. See TRAP 0b — reconcile has its own trap.

### TRAP 0b — old version on relaunch ≠ failed upgrade, and `open -b` can't fix it

App quit take <1s. Brew download 128MB take a minute or more. User see app vanish, no window, no progress. User reopen app by hand (Spotlight, Dock). Now old binary run again while helper still downloading.

Naive reconcile say "version unchanged → failed". That wrong, and it do three bad things at once:
1. lie to user (`Homebrew did not finish the last update`) while upgrade is fine,
2. **clear the marker**, so real outcome never reported,
3. leave button live → second click → second `brew upgrade` → dies on first one's download lock:
```
Error: anhdd-kuro/tap/fixlang: A `brew upgrade --cask fixlang` process has already
locked .../FixLang-0.4.2-arm64.dmg.incomplete.
```

Then the second half of the trap: helper end with `/usr/bin/open -b com.fixlang.app`. LaunchServices resolve that with `preferIdentical` → app already running → **just focus old process**. Bundle on disk new, running process old, forever. Looks like "update never happened".

Real trace (0.4.1 → 0.4.2), proven from `log show`:
```
00:00:38  app  Homebrew update to 0.4.2 started      (app quits 00:00:39)
00:00:44  Dock  Sending .launchAppsBrowsing          (user reopens by hand)
00:00:45  CoreServicesUIAgent  LAUNCH: Successful launched pid=53228 (quarantined)
00:00:45  app  Homebrew update did not change the app version   ← the lie
00:01:03  helper  fixlang was successfully upgraded! 0.4.1 -> 0.4.2
00:01:03  CoreServicesUIAgent  _LSLaunchRB(com.fixlang.app, opts=…preferIdentical…)  ← focus only
```
The 6s gap between the Dock click and the launch is Gatekeeper re-verifying the freshly quarantined cask bundle — every cask upgrade re-quarantines, so every first launch after an upgrade is slow.

Rules now baked into `pendingInstall.ts` + `updateService.ts`:
- Marker carries `startedAt`. Missing/garbage timestamp parses to `0` = long expired (old markers keep old behavior).
- `reconcilePendingInstall` order matters: version changed → `installed`; else Caskroom has target → `restart-required`; else inside `UPGRADE_GRACE_MS` (20 min) → `in-progress`; else `failed`.
- `in-progress` **keeps** the marker and sets `installing = true`, which also makes `checkForUpdates` bail — otherwise a check republishes `available` and re-arms the button mid-upgrade.
- Completion probe is `<prefix>/Caskroom/<token>/<version>` (plain `statSync`, no subprocess, still true after the helper exits). Version string is pattern-checked so it cannot escape the directory. **`<token>` is the marker's TARGET token, never the literal `fixlang`** — hardcoding it makes a correct beta install report `failed` after the grace period, and the prerelease skill records a one-accessor version of that mutant surviving a 5069-test run.
- Poll it every 15s while waiting, deadline `startedAt + grace` (not `launch + grace`).
- `restart-required` restarts with `app.relaunch()` + `app.exit(0)`. **Never `open -b`** — that is the trap above. `execPath` is the replaced bundle, so re-exec runs the new version.

**Shrink the window too, not just the message.** `installUpdate` now runs `brew fetch --cask fixlang` BEFORE quitting. `fetch` fill download cache only — installed bundle untouched — so safe with app open. App quit only after DMG on disk; helper then do `brew upgrade` off cache (and no `brew update`, probe already refresh tap), so app away seconds not minute. Progress read with `statSync` on `<HOMEBREW_CACHE>/downloads/*--FixLang-<v>-arm64.dmg[.incomplete]`, denominator = GitHub release asset `size`. **Never parse brew output for progress** — format drift silently, file size never lie. Digest prefix in cache filename is Homebrew internal; match on basename suffix, don't recompute it.

WHY THIS WAS MISSED: the reconcile tests only ever modeled two worlds — same version (failed) or new version (installed). "Same version, upgrade still running" was not a state anyone named, because every test injects a fake upgrader that finishes instantly, and manual verification (`brew upgrade` in a terminal) is synchronous and blocking. The bug only exists in the asynchronous, detached, user-can-interfere world.

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

## One in-flight flag — every Homebrew-driven operation shares it

`updateService.ts` arbitrates the stable install, the channel switch and the
revert on **one** `installing` boolean. **A new periodic check, auto-update, or
third Homebrew action does NOT get its own flag.** Adding one is the locally
sensible choice and it is wrong: two detached `/bin/sh` helpers can then run
against an app that has already quit, one `brew uninstall`ing while the other
`brew upgrade`s off the same download lock, with `/Applications/FixLang.app`
removed by whichever wins. Each path passes its own tests the whole time.

Three properties that look like tidying and are not:

- **The claim is read again at PUBLISH time, not only at entry**
  (`inFlightOperationOwnsState`). Both checks already refuse to *start* while
  the flag is held; that is only half. A check already in flight when an
  operation begins used to publish its stale answer over the live one — a revert
  mid-download had its byte progress replaced by "a beta is available".
- **The check abandons its answer; the operation does not refuse to start.**
  Deliberate: refusing would fail a Revert press for as long as a GitHub scan
  runs (10 s per request, up to three), and Revert is the one direction that
  exists to rescue a user from a bad build.
- **The hand-off, not the returned result, releases the claim.**
  `withInstallingClaim` passes `markHandedOff` INTO the body rather than
  inferring it from what the body resolves to, because the statement that spawns
  the detached helper is not the last one — a log line and `quitApp` follow, and
  either can throw. Releasing there re-arms a button whose next press spawns a
  second helper against casks the first already owns. A body that forgets to
  call `markHandedOff` fails **closed** (a resolved `success` still counts as a
  hand-off), which is the safe direction.

## Untrusted release notes — one normalizer, both channels

Release bodies are attacker-choosable text rendered inside the app. Two controls,
both easy to mistake for formatting:

- **`normalizeReleaseNotes` has exactly ONE definition**, in
  `src/main/update/releaseAsset.ts`, imported by the stable path
  (`updateService.ts`) and by the pre-release path (`githubReleaseSource.ts`).
  It strips bidi control characters (`U+061C`, `U+200E/200F`, `U+202A-202E`, `U+2066-2069` — written as escapes in `BIDI_CONTROL_CHARACTERS`, never pasted literally into a doc); it truncates
  at `RELEASE_NOTES_MAX_LENGTH`, backing off a split surrogate pair, closing an
  open code fence and appending a truncation marker. **Do not re-fork it per
  channel.** An earlier doc described it as duplicated-and-diverged and handed
  the next agent a migration that had already landed — "simplifying" the stable
  path back to a private copy is how the bidi strip disappears with nothing red.
  Its docblock owns the rules.
- **A link whose LABEL claims one destination while its `href` opens another is
  displayed as the href** (`SettingUpdates.tsx`). This is a security control over
  attacker-chosen input sitting in an otherwise ordinary UI component, and it
  will make some honest links render worse. **That is not a cosmetic regression
  to delete — tighten what counts as a destination claim instead.** The exact
  mechanism is deliberately not described here: it is being reworked, and a
  description would be stale on landing. The invariant is what must survive.

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
