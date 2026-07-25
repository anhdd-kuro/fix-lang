# Archived: Automatic Main Release Design

Date: 2026-07-21
Status: Superseded

This document originally proposed deriving a release from a stable
`package.json` version on `main`. Its retained rationale is that release tags
must be version-matched, monotonic, and never moved or replaced; a failed
publication should be resumable without silently changing a released artifact.

The signed-distribution proposal is superseded. The active workflow validates a
strict stable version before creating its matching tag, then publishes only an
unsigned arm64 DMG and `SHA256SUMS.txt` through a draft-first GitHub Release.
The workflow does not build automatic-update payloads or use Apple credentials.

For the current maintainer workflow and user installation guidance, see the
root [README](../../../README.md#publishing-a-macos-release).
