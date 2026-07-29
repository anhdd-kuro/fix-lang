# Contributing to FixLang

Thanks for taking an interest. FixLang is a personal project, so please open an
issue before starting anything large — it may already be planned, or deliberately
out of scope.

## Licensing and the sign-off requirement

FixLang is licensed under **GPL-3.0-or-later** (see [LICENSE.md](LICENSE.md)).

Every commit must carry a `Signed-off-by` line:

```bash
git commit -s -m "fix: correct hotkey reload on profile switch"
```

That line certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
— in short: you wrote the patch, or you have the right to submit it under the
project's license.

By submitting a contribution you also agree that, in addition to GPL-3.0-or-later,
you grant the project maintainer a perpetual, worldwide, non-exclusive,
royalty-free licence to use, reproduce, modify, and distribute your contribution
**under any licence terms**, including relicensing the project. This keeps a
future licence change or dual-licence possible without having to track down every
past contributor. You keep your copyright; you are only granting permission.

If you cannot agree to that, say so in the pull request — the contribution can
still be discussed, it just cannot be merged as-is.

## Development

Requires **bun** (lockfile is `bun.lock`; do not use npm or pnpm) and macOS.

```bash
bun install
bun run dev
```

Before opening a pull request:

```bash
bun run lint
bun run test
bun run i18n:check
```

If you added or changed a runtime dependency, also run:

```bash
bun run build && bun run check:bundle
bun run notices:generate
```

The packaged app ships no `node_modules` — every runtime dependency must be
inlined into `out/` by Vite. `check:bundle` is the only check that catches a
dependency Vite left external; `dev`, `test`, and `lint` all pass regardless.

`notices:generate` rewrites `resources/THIRD-PARTY-NOTICES.md` and
`resources/THIRD-PARTY-LICENSES.txt` from the full runtime dependency closure —
currently 250 packages, so do not edit either file by hand. Both ship inside the
application bundle, and the release workflow fails if either is missing from
`app.asar`, because they are the only copy of those licence texts a recipient of
the DMG ever receives.

For UI changes, verify in `bun run dev` before packaging.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), branched from `main`
as `feature/*` or `fix/*`:

```
feat(settings): add per-preset reasoning effort
fix(hotkeys): relinquish default preset hotkey on collision

Signed-off-by: Your Name <you@example.com>
```

## Adding user-facing text

All user-facing strings are translatable. English is the source of truth; add the
key to `src/shared/i18n/locales/en/{namespace}.json` and, where you can, the
Japanese equivalent under `ja/`. Keys are type-checked at compile time. Use `t()`
in the renderer and `mainT()` in the main process.

## Adding a theme

Themes are generated from JSON under `src/themes/json/` — run
`bun run themes:generate` after changes, then `bun run test`.

If you add a theme sourced from someone else's work, run `bun run notices:generate`
so its copyright holder and licence land in
[resources/THIRD-PARTY-NOTICES.md](resources/THIRD-PARTY-NOTICES.md). Themes taken
from `shikijs/tm-themes` resolve automatically from that project's upstream
NOTICE; a theme from anywhere else needs its licence added to the generator. A
theme with no identifiable licence will not be merged.

## Security

Do not open a public issue or pull request for a security vulnerability. Follow
[SECURITY.md](SECURITY.md).
