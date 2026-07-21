# Automatic Main Release Design

## Goal

Publish a signed FixLang release automatically when a commit pushed to `main`
introduces a new stable version in `package.json`. Maintainers should not need to
create the matching Git tag manually.

## Trigger and version rules

The release workflow continues to accept both pushes to `main` and stable tags
matching `v*.*.*`.

For a `main` push, the workflow reads `package.json` and derives the release tag
as `v<version>`:

- If the tag does not exist, the workflow creates it at the pushed commit and
  proceeds with the release in the same workflow run.
- If the tag already points to the pushed commit or one of its ancestors and its
  release is public, the version has already been released and the workflow
  exits successfully without rebuilding it. If the release is missing or still
  a draft, the workflow resumes publication from that protected tag.
- If the tag exists outside the pushed `main` history, the workflow fails rather
  than moving or replacing the tag.

For a manual tag push, the workflow keeps the current tag/package version match
check and additionally requires the tagged commit to be contained in `main`.
This preserves a recovery path while preventing releases from feature branches.

Only stable semantic versions accepted by the existing `v*.*.*` release pattern
are supported. Prerelease channels remain out of scope.

## Workflow structure

A preparation job checks out full history, resolves whether a release is needed,
and exposes the release tag and commit to the publishing job. When a `main` push
needs a new tag, it creates a lightweight Git reference through the GitHub API
using the workflow token. The same run then performs the existing install, lint,
test, build, signing, notarization, artifact validation, and draft-to-public
promotion steps.

Keeping tag creation and publication in one run is intentional: pushes made with
the repository `GITHUB_TOKEN` do not start a second workflow, so splitting these
operations would require an additional long-lived token or GitHub App.

The workflow uses release-level concurrency to prevent simultaneous pushes from
publishing competing versions. GitHub does not allow its Actions integration to
be a bypass actor on this personal repository. The repository's `v*` tag ruleset
therefore permits new tags, while continuing to prevent existing release tags
from being updated or deleted. Workflow validation still rejects mismatched or
off-`main` tags before publication.

## Failure handling

- Invalid or mismatched versions fail before dependencies or signing work begins.
- A conflicting existing tag is never overwritten or moved.
- A tag outside `main` is rejected.
- Existing public releases are never replaced; the current draft-only recovery
  behavior remains unchanged.
- Signing, notarization, upload, or artifact verification failures leave a draft
  release and do not make it public.

## Documentation and verification

The README release instructions will describe version-bump-driven publication,
the optional manual-tag recovery path, and required Apple secrets.

Verification includes YAML parsing, script-level tests for new/already-released/
conflicting-tag decisions, the project lint and test commands, and a fresh code
review. The workflow itself will not be triggered during implementation because
publishing a production release requires a deliberate version bump on `main` and
configured Apple credentials.
