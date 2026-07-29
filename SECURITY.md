# Security Policy

FixLang is a local macOS menu-bar app maintained by one person in their spare time.
This document states what is supported, how to report a vulnerability, and what
FixLang does and does not try to defend against.

## Supported versions

| Version                | Supported |
| ---------------------- | --------- |
| Latest release         | ✅        |
| Any earlier release    | ❌        |

Fixes ship in the newest GitHub release. There are no backports.

FixLang has no self-updater. If you installed through Homebrew, the
`anhdd-kuro/tap` cask is synced from verified releases on a schedule and can lag a
published release by up to about six hours — so a freshly released fix may not be
installable through `brew upgrade` for a few hours after the release exists.
Please reproduce on the latest release before reporting.

## Reporting a vulnerability

Report privately through GitHub:

**[Report a vulnerability](https://github.com/anhdd-kuro/fix-lang/security/advisories/new)**
— or open the repository's *Security* tab and choose *Report a vulnerability*.

Please do not open a public issue for a security problem.

Useful things to include: the FixLang version, macOS version, which providers the
affected profile had connected, and the smallest reproduction you can manage.
Never paste a real API key into a report — describe its shape instead.

### What to expect

- I aim to acknowledge a report within **7 days**.
- Please allow up to **90 days** before public disclosure, so a fix can ship and
  reach Homebrew users.
- Reporters are credited in the release notes unless you ask not to be.
- There is no bug bounty. This is an unpaid personal project.

## Threat model

FixLang keeps user data on the machine. API keys, transform history, and logs
never leave the device except as requests to the AI providers a profile has
explicitly connected, and each provider only ever receives its own key.

**In scope** — a report here is actionable:

- **API key handling and log redaction.** Any path where a stored key reaches
  disk unredacted, appears in logs or an error dialog, or is transmitted to a
  provider it does not belong to.
- **The IPC / preload boundary.** Any IPC channel that acts on renderer-supplied
  input without validating it, or an exposed bridge function that returns more
  than it should.
- **The update path.** Command injection into the Homebrew upgrade helper,
  resolution of `brew` from anywhere other than the two pinned prefixes
  (`/opt/homebrew/bin/brew`, `/usr/local/bin/brew`), or manipulation of the
  pending-update marker that causes an unintended install.
- **Rendering untrusted model output.** Provider responses and captured text are
  rendered as Markdown. Anything in that content that can execute, navigate,
  reach the shell, or exfiltrate from inside a FixLang window.

**Out of scope:**

- An attacker who already controls your macOS user account or has read access to
  your home directory. FixLang stores data under `~/Library/Application Support`
  and cannot defend against that position — see *Known limitations* below.
- The behaviour, availability, or data handling of the AI providers you choose to
  connect. Their terms govern text you send them.
- Missing code signing and notarization. This is a known, deliberate property of
  the current distribution — see below.
- Anything requiring a modified FixLang build, or physical access to an unlocked
  machine.

## Known limitations

These are properties of the current design, not undisclosed bugs. They are listed
so you can decide whether to install FixLang.

- **Builds are unsigned and un-notarized.** Releases are arm64 DMGs built without
  an Apple Developer identity, so macOS Gatekeeper will warn on first launch and
  you must allow the app yourself. There is no signature for you to verify
  against — only the published `SHA256SUMS.txt`. Never automate a Gatekeeper or
  `xattr` bypass.
- **FixLang requires macOS Accessibility permission.** That is how it reads your
  current text selection and identifies the frontmost app. It is a broad
  privilege: granting it means trusting this app with what you have selected in
  other applications.
- **Transform and PromptGen history is not encrypted at rest.** It is stored in a
  SQLite database under `~/Library/Application Support`, readable by anything
  running as your user. If you transform sensitive text, that text is on disk in
  plaintext until you clear the history.
- **Your text is sent to the providers you connect.** Cloud providers (OpenAI,
  OpenRouter, Amazon Bedrock) receive the selected text plus the frontmost
  application's name. Local providers (Ollama, LM Studio) keep it on your
  machine. Choose per preset accordingly.
- **API keys are stored with the macOS Keychain** via Electron `safeStorage`. If
  Keychain encryption is unavailable, key storage fails rather than falling back
  to plaintext.
- **Logs are redacted, but redaction is pattern-based.** Known key formats and
  provider-masked key echoes are stripped. A key in an unrecognized future format
  could in principle survive redaction; reports of a concrete case are in scope.

## Scope of this policy

This policy covers the FixLang application in this repository and the release
artifacts published from it. It does not cover forks or modified builds.
