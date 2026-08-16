---
name: fixlang-prerelease-channel
description: "Use when touching the pre-release channel or the revert-to-stable path: the two cask tokens, `.github/workflows/prerelease.yml`, `src/main/update/prereleaseVersion.ts`, the channel-switch helper in `homebrew.ts`, the pre-release half of `updateService.ts`, or the Pre-release section of `SettingUpdates.tsx`. Examples: \"cut a beta\", \"Revert button missing\", \"switch left no app installed\", \"beta not offered\", \"marker says installed but user is still on beta\". Covers switch ordering, token-parameterised probes, the marker token, the helper traps, and what this feature deliberately cannot do."
---

# FixLang — Pre-release channel & revert traps

Read [Release + Homebrew](../fixlang-release-homebrew/SKILL.md) first — everything
there still applies. This file is only the part the **second** cask token adds.

Two tokens, one at a time: `STABLE_CASK_TOKEN = "fixlang"`, `BETA_CASK_TOKEN =
"fixlang@beta"` (`src/main/update/homebrew.ts`). Casks declare `conflicts_with`
each other, so brew itself refuses both.

## TRAP 1 — no cask downgrade exists. Sibling tokens are the ONLY mechanism.

Homebrew cask has **no** `--version`, no channel primitive; `brew
version-install` is formula-only; install-from-URL is blocked and
install-from-local-file is trust-gated, default-off, and silently undone by the
next routine `brew upgrade`. So "go back to stable" cannot be a downgrade. It is
an **uninstall of one token and an install of the other** — the same mechanism
`google-chrome@beta` and `zed@preview` use.

Consequences people trip over:
- A revert installs a **LOWER** version by design. Any code that assumes the
  target is newer is wrong here (that is why card 04 exists).
- Cask "outdated" is an **inequality**, not a less-than. Rolling the tap's stable
  cask backwards would "upgrade" every user downward. That lever exists; it is
  explicitly NOT the mechanism. Do not propose it as a shortcut.
- `brew install` on an already-installed cask **silently upgrades**. Never
  distinguish install from upgrade by exit behaviour.

## TRAP 2 — switch ORDER is the whole correctness story

`buildChannelSwitchScript` (`homebrew.ts`) emits, in this order and no other:

```
wait for FixLang to exit  →  fetch target  →  uninstall CURRENT token
  →  install TARGET token  →  retry once  →  restore ORIGINAL token  →  reopen
```

- **Install first fails** — the app bundle path is already occupied.
- **Uninstall LAST deletes the app you just installed** — cask uninstall removes
  artifacts by **PATH, not by identity**, and both tokens ship the same
  `/Applications/FixLang.app`. This is the whole reason the order is pinned by
  string-index assertions rather than by comment.
- The restore step names the **ORIGINAL** token. The assertion has to check the
  two tokens **apart** (`fixlang` present AND `fixlang@beta` absent) — a naive
  substring check passes on both, because `fixlang` is a prefix of `fixlang@beta`.
  Same trap for `install` inside `uninstall`.
- **Never `--zap`, never `--force`, no `zap` stanza in either cask.** A plain
  cask uninstall leaves `userData` alone — that property is what makes a channel
  switch non-destructive. There is a test asserting neither string appears
  anywhere in the emitted script.
- Download happens **while the app is alive** (`brew fetch`), same as the stable
  path, so the no-app window is a local file move, not a multi-minute download.
- **The uninstall window is real and was accepted knowingly.** Between uninstall
  and install there is no app. If the restore also fails, there is no running app
  left to report through — helper log + notification are the only channels. This
  is the worst failure mode in the feature; treat it as such in review.

## TRAP 3 — the helper's `trap` is load-bearing in three separate ways

`buildHelperScript` is shared by the ordinary upgrade and the channel switch.

- **One `trap reopen_fixlang EXIT`, armed AFTER the `pgrep` wait loop.** Above
  that line the app is still on the user's screen, so an abort there must reopen
  nothing. Below it the app is gone and the trap is the only thing that brings it
  back on any failing step. Arming it earlier double-opens; arming it later loses
  the recovery.
- **The reopen is a shell FUNCTION (`reopen_fixlang`), not inline trap text.** A
  trap body is *quoted shell*. Spelling the `open -a "<path>"` command inside the
  trap would make the trap the one place a bundle path's quoting can escape.
- **`abort_without_reopen` on `HUP INT TERM`, and its `trap - EXIT` is
  load-bearing.** Delete that one line and the handler's own `exit` fires the
  EXIT trap anyway — which reopens the app at T+1 while an orphaned `brew`
  replaces the bundle at T+4, i.e. reopening *inside the switch's no-app window*.
  This regression was INTRODUCED by the fix for the previous bullet; it is not
  hypothetical.
- Non-interactive bash **ignores SIGINT/SIGQUIT entirely** — an "early reopen on
  INT" observation is just the normal end-of-script reopen. `TERM` and `HUP` are
  the live signals.

**CAVEAT, on record:** the signal tests assert a property of `/bin/sh`. They bite
on macOS bash (proved by mutation) but hold **trivially** under dash on the Linux
CI runner, because dash never runs `EXIT` traps for fatal signals. **A green
Linux run is not proof.** Said so in the test's doc comment; do not "simplify" it
away on the strength of CI.

Quoting is verified against 15 hostile `appPath` values (backtick, `$()`, `${}`,
backslash, newline, tab, quote, leading dash all fall back to the bundle id;
space, `'`, `*`, `;`, `&&`, `|` each arrive as one inert argv).

## TRAP 4 — every Caskroom path and brew argv must carry an EXPLICIT token

`caskroomPath`, `caskVersionPath`, `parseCaskVersion`, `getInstallableVersion`,
`isVersionInstalled`, `downloadUpdate`, `getDownloadedBytes` all take the token.
Miss one and a beta user's updater goes **dead silently** — the probe answers
about `Caskroom/fixlang`, which does not exist for them.

- `isCaskToken` is a **closed allow-list** over the two constants, checked
  **before** any `path.join` or argv. A token that is not one of the two is
  refused, not sanitised.
- `detectActiveCaskChannel(brewBinary)` is **two directory probes and no
  subprocess** → `"stable" | "beta" | "both"`. It is wired as an optional
  injected `UpdateServiceOptions` collaborator, not a `HomebrewUpgrader` member;
  `index.ts`'s `chooseBoundCaskToken` binds the upgrader from its answer.
- The subtle mutant that survives a full-suite run: leave the guard intact and
  swap **one** accessor's effective token for the bound one. 5069 tests stayed
  green. Any test for this must **bind one token and call the accessor with the
  other** — binding and calling with the same token proves nothing.
- **Both tokens installed is an explicit handled state**, not an error: switching
  is disabled and the panel names both tokens plus the uninstall command.
  Guessing which one is live risks uninstalling the wrong bundle.

## TRAP 5 — `/releases/latest` never returns a prerelease

By definition. So pre-release discovery needs a **second, paginated** endpoint
returning an **array**, with its own item-by-item validator
(`githubReleaseSource.ts`).

- A non-array response is rejected whole; a bad item is **dropped**, never fails
  the batch (draft, `prerelease !== true`, tag outside `v<X.Y.Z-beta.N>`, or a
  missing / not-uploaded / non-positive-size DMG asset).
- **The `Link` header is untrusted input.** `isReleaseListUrl` requires
  origin+pathname to equal the endpoint exactly — `evil.example.com`, `file://`
  and `javascript:` were all fetched and returned as authoritative before that.
  A rejected target **stops paging with a warn**, it does not throw, so a hostile
  header cannot discard a valid page-1 result.
- Same rule for real failures: a 403 on page 2 must not throw away a beta already
  validated on page 1. The 3-page cap logs `{pages, foundBeta}` — truncating
  silently into `null` is indistinguishable from "nothing qualified".
- **The abort timer must span `await response.json()`, not just the fetch.**
  Clearing it when `fetchLatest` resolves left `getLatestPrerelease` pending past
  13 s on a stalled body, so `checkForPrerelease`'s `finally` never ran and its
  re-entrancy guard **LATCHED** — panel stuck on "checking" with a dead button
  until restart, and no error published. The try/finally now spans request,
  status check, `json()` and the `Link` read on **every** page.
- `throw` = the probe failed; `null` = the scan succeeded and nothing qualified.
  Do not collapse them at the consumer — that makes the error phase unreachable.
- **Pre-release discovery is NOT part of the routine check.** It runs only on the
  explicit button press, so ordinary users never pay a second unauthenticated
  GitHub request per check (the rate limit is shared per address).

## TRAP 6 — the marker must tell a ROLLBACK apart from a success

`pendingInstall.ts` gained `caskToken` (the **target**) and optional
`fromCaskToken` (the source, recovered from `fromVersion` when absent, so markers
already on disk still reconcile).

- **`"rolled-back"` fires only when `currentVersion !== fromVersion`** — because
  mid-flight the source cask is legitimately still installed, and treating that
  as a rollback would report an in-flight switch as failed. Pinned by a test that
  an in-flight switch still reads `in-progress`.
- Without that outcome, a revert whose restore reinstalled the tap's *current*
  beta (`2.0.0-beta.4`, not the `.3` the user had — the NORMAL case on that
  channel) reported **`installed`**: marker cleared, log said "App updated via
  Homebrew", panel said up-to-date, while the user who asked to LEAVE the channel
  was still on it, under a build they never chose.
- **A revert's marker is token-identical to an ordinary stable upgrade** — both
  target `fixlang`. Routing must also consult **`fromVersion`**; the token alone
  cannot tell them apart.
- Reconcile probes the **target token's** Caskroom path, never the stable one.
  `updateService.ts` calling `isVersionInstalled` without `pending.caskToken`
  means a correct beta install reports `failed` after `UPGRADE_GRACE_MS`.
- Bundle-identity is tested **before** `toVersion` equality, or a leftover copy at
  exactly the reverted-to version masks `wrong-bundle`.
- `parseCaskToken` is a **closed allow-list**, not a pattern: hostile marker
  content defaults to the stable literal or is rejected whole.

## TRAP 7 — two version parsers, on purpose

`prereleaseVersion.ts` owns the beta grammar (`X.Y.Z-beta.N`, nothing else — no
`rc`, no `-beta` without an identifier, no `beta.01`, no `v` prefix, no
`BETA`). `parseStableVersion` stays **module-private** in its own file
specifically so the wrong one cannot be reached. Grammars are disjoint; a third
comparator is the failure mode to avoid, which is why
`compareVersionOrder` is exported as a discoverable alias — a grep for
`compareVersion` now finds the real one instead of spawning a rival.

Live consequence: **the tap-lag gate parses both sides with `parseStableVersion`,
which returns `null` for any beta**, and it is written `if (offered && target)`,
so a null **disables the gate silently**. CLAUDE.md marks that gate never-delete;
know that on the beta channel it is not doing its job.

## TRAP 8 — the dev loop does not typecheck, and prettier will eat the file

- **`bun run lint` is ESLint-only and there is NO typecheck script.** A type
  error surfaces first at `bun run build`. An ES2024 `isWellFormed()` call passed
  **both** vitest and eslint while failing `tsc --noEmit` (TS2550). Run
  `bunx tsc --noEmit` before calling anything in this area done.
- **Do not run `bunx prettier --write` on these files.** There is no prettier
  config, formatting is not lint-enforced, and it reformats them wholesale —
  burying the real diff.
- `bun run test`, never `bun test`.

## Known limitations — accepted, not oversights

- **`unknown` channel is not representable.** When brew lives outside
  `/opt/homebrew` and `/usr/local`, `findBrewBinary` returns `null` **by design**,
  and a machine running the **beta** cask then publishes `activeChannel: "stable"`
  + `canSwitch: false` — byte-identical to a manual-DMG stable install. That user
  gets **no beta note and no Revert button**: the feature's escape hatch is
  silently absent for them. Not fixable in the renderer — the pair is ambiguous by
  construction. The correct fix is an `"unknown"` member on
  `PrereleaseActiveChannel` (`src/features/update/shared/prerelease.ts`), which
  reopens the state/validator/panel work.
- **`release.yml`'s `v*.*.*` tag trigger also matches beta tags.** GitHub forbids
  `tags` and `tags-ignore` in the same `on.push`, and narrowing the stable glob
  would break the byte-frozen stable path. Cost is alarm fatigue only: the run
  fails fast at the stable version pattern and publishes nothing — and in
  practice it rarely fires at all, because the beta tag is created via `gh api`
  under `GITHUB_TOKEN` and GitHub does not fire workflows for refs pushed with
  that token.
- **`normalizeReleaseNotes` exists twice and the copies have DIVERGED.** The
  shared leaf `src/main/update/releaseAsset.ts` backs off a split surrogate pair,
  closes an open code fence and appends a truncation marker. The still-private
  copy at `updateService.ts:304` does none of that. Deliberate and visible rather
  than discovered: whoever migrates `updateService.ts` to the leaf inherits the
  fix.
- The `open -b` / one-bundle-id hazards from
  [Release + Homebrew](../fixlang-release-homebrew/SKILL.md) TRAP 0-A and 0b
  apply to channel switching **unchanged** — Homebrew tracks tokens and artifact
  paths and cannot see bundle identifiers at all, so both tokens produce the same
  id at the same path.

## ⚠️ MAINTAINER ACTION REQUIRED — a security control that does not exist yet

`.github/workflows/prerelease.yml`'s publish job declares:

```yaml
    environment: prerelease
```

That is the only in-repo review anchor a beta branch can carry — a beta tag is by
definition not an ancestor of `main`, so the stable workflow's tag-ancestry check
has no equivalent here. **It gates NOTHING until someone creates a GitHub
environment named `prerelease`, in repository settings, with required
reviewers.** An environment that exists with no protection rules approves
everything silently.

Until that is configured, **any write-holder can publish an unreviewed public
prerelease by pushing to `beta/anything`.** Mitigated in code, open in practice.

## Cutting a beta

1. Branch `beta/<something>` off `main`.
2. Set `package.json` version to `X.Y.Z-beta.N`. **Never merge that value back to
   `main`** — the main branch's manifest stays plain stable, which is what keeps
   the monotonic-version guard and `releaseConfiguration.test.ts` green unchanged.
3. Push. `.github/workflows/prerelease.yml` runs lint → test → `i18n:check` →
   build → `check:bundle` → DMG + the same mount-and-inspect validation as stable,
   then publishes with `--prerelease`.
4. `.github/release-tag-ruleset.json` excludes `refs/tags/v*-beta.*` from update
   and deletion, so a botched beta tag can be deleted and recut. Stable `v*` tags
   keep full protection — do not widen that exclusion.
5. The tap emits **both** casks from one sync run, with the mutual
   `conflicts_with` generated on both sides so the pair cannot drift. No published
   prerelease is a no-op for the beta cask.

**The tap goes first.** The app cannot be verified end to end before the beta
cask token exists.

## Checklist before finishing pre-release work

- [ ] Every new Caskroom path / brew argv takes an explicit token, guarded by
      `isCaskToken` before the join
- [ ] Any token test **binds one token and calls with the other**
- [ ] Emitted script still has fetch < uninstall < install, restore names the
      ORIGINAL token, and contains neither `--zap` nor `--force`
- [ ] `trap - EXIT` still present in `abort_without_reopen`
- [ ] Marker routing consults `fromVersion`, not the token alone
- [ ] `bunx tsc --noEmit` clean (lint will not tell you)
- [ ] `bun run i18n:check` green — every new key needs a REAL Japanese
      translation; a byte-identical copy of the English is rejected
