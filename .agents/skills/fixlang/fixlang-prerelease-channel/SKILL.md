---
name: fixlang-prerelease-channel
description: "Use when touching the pre-release channel or the revert-to-stable path: the two cask tokens, `.github/workflows/prerelease.yml`, `src/main/update/prereleaseVersion.ts`, the channel-switch helper in `homebrew.ts`, the pre-release half of `updateService.ts`, or the Pre-release section of `SettingUpdates.tsx`. Examples: \"cut a beta\", \"Revert button missing\", \"switch left no app installed\", \"beta not offered\", \"marker says installed but user is still on beta\". Covers switch ordering, token-parameterised probes, the marker token, the helper traps, and what this feature deliberately cannot do."
---

# FixLang — Pre-release channel & revert traps

## Before your first edit (both of these are silent)

- **`bun run test` + `bun run lint` is NOT a typecheck.** `lint` is ESLint-only
  and there is no typecheck script; a type error surfaces first at
  `bun run build`. An ES2024 `isWellFormed()` call passed **both** vitest and
  eslint here while failing `tsc --noEmit` (TS2550). Run `bunx tsc --noEmit`.
  Also: `bun run test`, never `bun test`.
- **Never `bunx prettier --write` on these files.** There is no prettier config,
  and `eslint.config.js` uses `eslint-config-prettier`, which *disables*
  formatting rules rather than enforcing them — so prettier reformats against
  its own defaults, wholesale, and buries the real diff. This is the one trap in
  the feature with no detector and no recovery once it is in a commit.

Read [Release + Homebrew](../fixlang-release-homebrew/SKILL.md) first. This file is
only the part the **second** cask token adds — including two things that file owns
and this one only points at:

- **Concurrency.** Every Homebrew-driven operation in the app — stable install,
  switch, revert — arbitrates on the **one** `installing` flag. A new one does not
  get its own boolean. See "One in-flight flag" there.
- **Release notes are untrusted input on both channels**, normalized by one shared
  function. See "Untrusted release notes" there.

**Do not read "everything there still applies" as covering the cask token.** That
file predates the second token and still says `fixlang` where the code now takes a
token parameter; TRAP 4 below is what actually applies. Wherever the two disagree
about a token, this file wins — the certification above is about mechanism, not
about which cask a path names.

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
- **"`userData` is untouched" is NOT "a beta's writes are readable again on
  stable."** Both channels share one `userData`, and nothing there is
  version-tagged: stored config only migrates FORWARD (`configVersion` in
  `apiStore.ts` gates one-shot migrations and has no inverse), and every
  `electron-store` in this app is constructed with `clearInvalidConfig: true`,
  so one value failing an OLDER build's ajv schema wipes that whole store file —
  for `apiStore` that is every profile, preset and key reference. SQLite history
  is the safe one (additive guarded `ALTER TABLE`). Consequence for anyone
  shipping a beta: a stored-shape change in a beta is a one-way door for users
  who revert.
- **The confirm dialog is the ONE place that one-way door is disclosed, and the
  catalog value is the source of truth for its wording.**
  `settings.updates.prerelease.confirm.configWarning` is appended to
  `confirm.detail` by `buildPrereleaseConfirmDetail` (`src/main/update/index.ts`);
  `index.test.ts` pins that it is appended in both locales. Two rules, and this
  feature has already made each mistake once:
  - **Do not trim or delete that string.** No test asserts its *content* — only
    that the key is appended — so cutting the risk sentence out of the catalog
    value keeps the entire suite green. It is long because it is a disclosure,
    not because someone pasted twice. (Routed follow-up: a test pinning the
    content does not exist yet.)
  - **Do not restate its wording in prose, here or in `AGENTS.md`.** The catalog
    key owns the words; `README.md` carries the single user-facing retelling.
    An earlier revision of THIS file asserted the dialog "says nothing about it"
    and told the next agent that any doc crediting it with a compatibility
    warning was a known recurring defect — true when written, false from the
    commit that shipped the warning, and by then an instruction to revert the one
    doc that was correct. Three prose copies of one sentence is what bought that.
- Download happens **while the app is alive** (`brew fetch`), same as the stable
  path, so the no-app window is a local file move, not a multi-minute download.
- **The uninstall window is real and was accepted knowingly.** Between uninstall
  and install there is no app. If the restore also fails, there is no running app
  left to report through — helper log + notification are the only channels. The
  log is `userData/logs/homebrew-channel-switch.log`, a **different file** from
  the ordinary upgrade's `homebrew-update.log` (`index.ts:96-107` vs
  `index.ts:176-178`); docs that send the user to the wrong one strand them at
  the exact moment the recovery command is the only thing they have. This is the
  worst failure mode in the feature; treat it as such in review.

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

Quoting is verified by test against 17 `appPath` values in
`homebrew.test.ts`. **11 rejected** — relative path, bare `"`, a `"`+`;`
breakout, `$()`, `${}`, backtick, backslash, newline, tab, leading dash, missing
`.app` suffix — fall back to the bundle id. **6 accepted** — space, `'`, `*`,
`;`, `&&`, `|` — each arrive as one inert argv, asserted as the whole quoted
token (`open -a "<path>"`) rather than a bare substring, because a regression
that dropped the quotes would still satisfy `toContain(appPath)` while letting
those characters reach `/bin/sh` as syntax. Every one of those cases was seen
red against a deliberately broken `isSafeDoubleQuotedText` / `isSafeShellPath` /
reopen-command before being trusted.

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
- **The notes and asset fields this endpoint returns are the SAME untrusted input
  the stable path takes**, and they go through the same
  `src/main/update/releaseAsset.ts` — **one** definition of
  `normalizeReleaseNotes`, imported by both channels, not a beta-path copy. Do
  not re-fork it "for stable": the bidi strip and the truncation rules live there
  and both channels depend on them. Rules and rendering traps:
  [Release + Homebrew](../fixlang-release-homebrew/SKILL.md) → "Untrusted release
  notes".

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

**The never-delete tap-lag gate must NOT reach for `parseStableVersion`.**
`runInstallUpdate` parses both `offered` and `target` with `parseCurrentVersion`
(`parseStableVersion(v) ?? parsePrereleaseVersion(v)`), and says why in code at
`updateService.ts:1350-1354`: "that this state only ever carries a stable string
is an emergent property of `checkForUpdates`, enforced nowhere near this gate."
The gate therefore works on **both** channels today. Two things keep it that
way, and both look like tidying:

- Swapping either side to the module-private `parseStableVersion` returns `null`
  for `X.Y.Z-beta.N`, and a null `offered` means "brew declined to answer" →
  proceed. That would silently disable the gate for exactly the population
  running betas, and nothing in the suite would go red.
- The two nulls are **not** one falsy check. A null `target` is our own
  published state being unparseable and hard-refuses; only a null `offered`
  proceeds. Do not fold them into `if (offered && target)`.

## TRAP 8 — the pre-release IPC surface is a second state, and preload tests cannot see it

`registerUpdateHandlers` (`src/features/update/main/update.ts`) registers the
stable channels **and** four pre-release invokes
(`updates:prerelease:{get-state,check,switch,revert}`) plus a broadcast on
`updates:prerelease-state` the tray deliberately never subscribes to. The
renderer-facing shape is `PrereleaseState` with its own validator
(`src/features/update/shared/prerelease.ts`) — a **second** state next to
`UpdateState`, not an extension of it.

- **A green preload test does not mean a handler exists.** The pre-release
  registrar shipped as an exported function with **zero call sites**: every
  channel was unregistered at runtime and Settings → Updates rejected on mount,
  while the preload suite stayed green because it mocks `ipcRenderer.invoke`,
  **and a mocked invoke resolves whether or not anything is listening**. It is
  now private and registered from inside `registerUpdateHandlers` — `src/main`'s
  single entry point — precisely so there is no second call site to forget.
- Assert channel names as **literals** in the test, not by importing them from
  the module under test; imported names agree with any typo they were meant to
  catch.

(The dev-loop traps that used to live here — no typecheck, no prettier — are now
in "Before your first edit" at the top, because they apply before you open any
of these files.)

## Known limitations — accepted, not oversights

- **`unknown` channel is not representable.** When brew lives outside
  `/opt/homebrew` and `/usr/local`, `findBrewBinary` returns `null` **by design**,
  and a machine running the **beta** cask then publishes `activeChannel: "stable"`
  + `canSwitch: false` — byte-identical to a manual-DMG stable install. That user
  gets **no beta note and no Revert button**: the feature's escape hatch is
  silently absent for them. Not fixable in the renderer — the pair is ambiguous by
  construction. The correct fix is an `"unknown"` member on
  `PrereleaseActiveChannel` (`src/features/update/shared/prerelease.ts`), which
  reopens the state/validator/panel work. **This one has a user-facing half**:
  such a user can still install `fixlang@beta` by hand and then find no Revert
  button. `README.md` → "Pre-release builds and reverting" carries the caveat and
  the manual exit command; if this limitation is ever fixed or widened, that
  README caveat moves with it.
- **`release.yml`'s `v*.*.*` tag trigger also matches beta tags.** GitHub forbids
  `tags` and `tags-ignore` in the same `on.push`, and narrowing the stable glob
  would break the byte-frozen stable path. Cost is alarm fatigue only: the run
  fails fast at the stable version pattern and publishes nothing — and in
  practice it rarely fires at all, because the beta tag is created via `gh api`
  under `GITHUB_TOKEN` and GitHub does not fire workflows for refs pushed with
  that token.
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

**Owner and closing condition.** This item is stated in four places on purpose —
`README.md` → "Publishing a pre-release" is where the repository owner can act,
and the agent-facing copies (here, `AGENTS.md`, and the comment at
`prerelease.yml`'s `release` job) exist so no agent assumes the gate works.
`README.md` owns the status. **When the environment is created with required
reviewers, edit all four in the same commit** — this heading, the `AGENTS.md`
Pre-release trigger bullet, the README section, and the workflow comment — and
say who reviews, not merely that a gate exists. A survivor of a partial edit
reads as "the publish path is unreviewed" and will block a beta cut.

## Cutting a beta

The step-by-step runbook, including the git commands, is `README.md` →
"Publishing a pre-release" — that is the copy a human maintainer will find, so
put procedure changes there, not here. **`README.md` carries the ordering
constraint below too; if you change it, change both.** What follows is the part
that only matters to someone reading the code.

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
- [ ] **No new in-flight boolean.** A new Homebrew-driven action arbitrates on
      the existing `installing` claim — see [Release +
      Homebrew](../fixlang-release-homebrew/SKILL.md) → "One in-flight flag"
- [ ] `bunx tsc --noEmit` clean (lint will not tell you)
- [ ] `bun run i18n:check` green — every new key needs a REAL Japanese
      translation; a byte-identical copy of the English is rejected
