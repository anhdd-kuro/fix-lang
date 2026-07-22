# Archived: In-App Update Design

Date: 2026-07-21
Status: Superseded

This document originally explored a fully automatic macOS update path. Its
useful rationale was to make update status discoverable in Settings, keep
release metadata untrusted until validated, and provide a clear user action
when a newer stable version exists.

The proposed download, restart, and in-place installation flow was superseded.
FixLang now checks the latest stable GitHub Release only, verifies the expected
arm64 DMG metadata, and opens the matching release page so the user installs the
update manually.

The current design intentionally distributes an unsigned arm64 DMG together
with `SHA256SUMS.txt`. It does not use an updater runtime or updater metadata.
For current behavior, installation, and release instructions, see the root
[README](../../../README.md#app-updates).
