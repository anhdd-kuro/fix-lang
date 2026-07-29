# Usage Cache and UI Consistency Design

## Scope

This release fixes the requested reasoning controls, Usage cache behavior, log
filter styling, User Guide example action, and popup copy action. Component
folder moves are limited to components touched by this work and any new shared
component; this avoids a repository-wide import churn.

## UI structure

- Render each reasoning effort label beneath its corresponding slider stop.
- Set the built-in Prompt optimization and Business writing presets to
  `minimal`; stored user-customized presets remain unchanged.
- Add or reuse shared `Select` and `Button` primitives instead of local native
  control styling.
- Match User Guide's **View example** action to the Import button variant.
- Use the shared primary Button for popup copy actions and increase separation
  from the close action.
- Move touched components into component-owned folders with an `index.ts`
  entrypoint where that keeps consumer imports stable.
- Audit renderer button elements and migrate remaining application buttons when
  they can use the shared Button without changing semantics.

## Usage data flow

The Usage hooks will keep cache entries in module-level state keyed by provider,
profile, and date range. An entry stores data, its fetch timestamp, and any
in-flight promise. Mounting a panel:

1. returns fresh cached data without an IPC request;
2. joins an existing in-flight request instead of starting another;
3. fetches only when the entry is absent or older than the 60-second TTL.

Explicit refresh bypasses freshness while retaining in-flight deduplication.
Profile changes invalidate provider entries so one profile cannot see another
profile's account data.

## OpenAI warning handling

Live logs show `/usage/completions` succeeding while `/costs` intermittently
returns `unavailable` and later succeeds using the same `openai-admin` key.
Therefore this is not treated as a credential mismatch. The client will retain
partial successful results, preserve useful failure classification, and avoid
amplifying transient failures through duplicate tab-mount requests. Tests will
pin partial success and deduplicated fetch behavior.

## Verification

- Focused unit tests for preset defaults, slider mapping/markup contracts,
  Usage cache TTL and in-flight deduplication, shared control consumers, and
  partial OpenAI Usage results.
- Button source guard over renderer consumers.
- `bun run lint`, `bun run test`, `bun run i18n:check`, `bun run build`, and
  `bun run check:bundle`.
- Live UI check for the reasoning labels, log-level Select, User Guide button,
  popup action spacing, tab-switch caching, console errors, and horizontal
  overflow.
- Fresh-agent review before the implementation commit.

## Release

After the PR passes checks, bump to the next stable patch version, merge to
`main`, wait for the GitHub release artifacts, manually dispatch the Homebrew
tap sync, and verify that the public cask reports the released version.
