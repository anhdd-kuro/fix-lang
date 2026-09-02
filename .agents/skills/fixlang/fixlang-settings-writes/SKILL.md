---
name: fixlang-settings-writes
description: Traps in every settings panel that persists a store over IPC — whole-object writes, optimistic rollback, status-line ownership, and the renderer test harness that hides all three. Read before editing any SettingX.tsx persist path.
---

# Settings panel writes — gotchas

Every `Setting*.tsx` panel persists by sending the **whole settings object**
over IPC (`setSelectionGuards`, `setAutocompleteSettings`, `setCorrectSettings`,
…) and main writes it with `store.set(...)`. There is no field-level merge.
Everything below follows from that one fact.

Cost of learning it the hard way: PR #193 shipped this panel once and then took
**six** follow-up commits, five of them the same class of defect in the same
file, each one a defect in the previous round's fix.

## The shape that keeps being wrong

```ts
// The pattern that is still live in SettingAutocomplete.tsx:189 — DO NOT COPY
const persist = async (previous: T, next: T) => {
  setSettings(next);                       // optimistic
  const result = await window.electronAPI.setX(next);
  if (result.success) { flashSaved(); return; }
  setSettings(previous);                   // rollback
  setStatus(saveError);
};
// caller: persist(settings, { ...settings, field })   ← base AND rollback from this render
```

Four independent defects live in those six lines, and they are only visible
when two writes overlap. **The two app-picking paths overlap routinely** — a
drop resolves through main, and `dialog.showOpenDialog` is called with **no
parent window** (`features/guards/main/guards.ts`), so it is not modal and the
panel stays fully editable for as long as the dialog sits open.

**1. `next` built from the render snapshot clobbers.** A whole-object write
assembled from this render's value erases anything that landed since. Add an
app, then change a number before the add returns: the number's payload carries
the pre-add list and the app is silently unblocked. **Build the payload from
the store's latest known value, read when the write RUNS, not when the user
clicked.**

**2. No rewind target computed by a writer is trustworthy.** `previous` may
itself be another writer's optimistic state, so rolling back to it installs a
value the store never held. Two failures in inverse order are enough to strand
the panel on a phantom. **On failure, ask the store what it actually holds
(`get*Settings()`), never rewind to a captured value.**

**3. A rejected value must not survive into the next write.** Between "write
failed" and "re-read returned", the panel still holds the rejected value, and
the next edit builds its whole-object payload around it — that write succeeds
and *makes the rejection real*. This one persisted a deny-list removal the
store had refused.

**4. Completions are not ordered.** An older success settling last overwrites
a newer failure's message, and the live region announces `Saved.` for a write
that failed.

## The rule: serialize, don't referee

Revisions, latest-value refs, and superseded-reconcile checks were all attempts
to referee overlapping writes. Each one shipped and each one was broken. The
answer that held is **one write per store in flight at a time**, with each
payload computed by an updater invoked when its turn comes
(`runGuardWrite`/`runSecretWrite` in `SettingSecurity.tsx`). A reconcile can no
longer be superseded because nothing else is running while it happens, and the
next write's base is post-recovery by construction.

Two corollaries that were each their own defect:

- **A successful setter re-earns trust on its own.** After a failed write whose
  re-read also failed, the base is untrusted. A later successful write *is*
  authoritative — the store now holds what the panel holds — so restore trust
  there. Otherwise Restore defaults succeeds against an unreadable store,
  reports `Saved.`, and leaves every later edit refused.
- **Restore defaults must bypass the read gate** (`derivesFromBase: false`). It
  ignores current settings entirely, so gating it on a readable store disables
  the one control whose job is to escape an unreadable one.

## Status-line ownership

One `saveStatus` line, many async writers. Each user mutation claims a token at
**the user's action** and reports only if it still owns it. Two ways this was
got wrong:

- **Claim at every mutation, not just the two obvious wrappers.** Capacity
  warnings, chooser/drop failures, and Restore defaults all bypassed it.
- **A late-landing action must NOT re-claim.** A drop or a dialog pick that
  resolves minutes later is an *old* action finishing; re-claiming makes it the
  newest owner and lets it narrate `Saved.` over an edit the user made since.
  Pass the original token down (`addDeniedBundleIds(ids, ownsStatus)` takes it
  as a **required** argument — an optional one invites exactly this mistake).

Known consequence, deliberately accepted: a superseded write now says *nothing*,
including for capacity overflow and failure. Newest-claim-wins buys "no wrong
messages" at the price of "a late partial failure may go unreported."

## Guard-rail semantics: refuse partial application

At a security boundary, applying **some** of what the user asked and reporting
success is worse than refusing. A drop where one item fails to resolve is
refused whole (matching `resolveAppBundleIds` in main) — filtering the
unresolvable ones would block a subset and report success, and the item that
vanished could be the one the user meant to block, discovered only by not being
protected by it.

⚠️ The deny-list **capacity** path still does the opposite (partial add plus an
explanatory message) and is knowingly inconsistent with this. Raised on the PR
four times, never answered. Do not "fix" it silently in either direction.

## Testing this — the harness hides the bug

No `@testing-library/react` is installed; tests drive `react-dom/client` + `act`
directly (`SettingSecurity.test.ts`, `AutocompletePanel.test.ts`).

- **A dispatched `MouseEvent` does not reach a controlled checkbox's
  `onChange`.** Only `el.click()` runs the activation behaviour that flips
  `checked`, which is what React reads. Two test attempts silently made **zero**
  writes and reported green. Same trap for text/number fields: set the value via
  the native `HTMLInputElement.prototype.value` setter, then dispatch `input`.
- **Assert `toHaveBeenCalledTimes(n)` on the IPC mock**, not only the final DOM
  text. A test that asserts end state passes when the interaction never happened.
- **Assert the payload, not just the count.** `mock.calls[1][0]` is where the
  phantom shows up; a count-only assertion trips on the queue instead and never
  reaches the defect.
- **`act`-per-click serializes overlapping writes away.** Use a manually
  resolvable `deferred<T>()` for the first write, or the interleaving under test
  cannot occur and the test pins nothing. A test that "passes against the
  pre-fix code" is not a regression test — say so in the file or delete it.
- **Every regression test must be observed FAILING with only its own fix
  reverted**, one fix at a time, and the failure message must name the defect.
  `toContain("full")` once passed against reverted code because the word also
  occurs in unrelated copy nearby.

## Two mechanical traps in this file's neighbourhood

- Editing `SettingSecurity.tsx` shifts its five `<Button>` sites and breaks
  `ButtonSourceGuard.test.ts`. A pure insertion moves all five by the same
  delta — remap by `(file, ordinal)`, columns unchanged, then take the new
  sha256 from the `Received:` value. See the `button-guard-inventory-refresh`
  memory.
- **Never `git checkout --` a file to undo an experimental patch.** It reverts
  the whole file to HEAD, not your patch. Copy to the scratchpad first and
  restore with `cp`. This destroyed a full session's work on this file once.
