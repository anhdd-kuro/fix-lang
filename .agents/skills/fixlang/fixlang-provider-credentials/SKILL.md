---
name: fixlang-provider-credentials
description: "Use when adding a provider, touching API/admin key storage, the provider capability registry, or credential logging. Examples: \"add a provider\", \"why is this admin key 401ing\", \"store an extra secret for a provider\", \"is this log line leaking a key\". Covers src/main/llm/providers/, src/shared/providers.ts, src/shared/providerKeyShapes.ts, src/stores/profileSecretStore.ts, src/shared/logging.ts."
---

# FixLang — Provider & Credential Gotchas

Code: `src/main/llm/providers/` (one folder per `ProviderId` + `index.ts` registry), `src/shared/providers.ts`, `src/shared/providerKeyShapes.ts`, `src/shared/bedrockEndpoint.ts`, `src/stores/profileSecretStore.ts`, `src/main/ai.request/shared.ts`, `src/shared/logging.ts`.

Providers: `openai`, `openrouter`, `bedrock`, `ollama`, `lmstudio`. Model ref plumbing: see [Model refs](../fixlang-model-refs/SKILL.md).

## The capability registry is the only dispatch table

Each provider owns a folder plus ONE entry in `providers/index.ts` (`supportsAdminKey`, `supportsUsage`, `fetchModels?`, `makeRequest?`). `ai.request/shared.ts` dispatches THROUGH the registry, so a new provider adds no branch there.

Two load-bearing details:

- Behaviour slots resolve their module via **lazy `import()`**. `~/main/llm` is imported for the Ollama client alone; eager loading drags the provider SDKs, notifications, and `electron-store` in with it.
- Credential facts are DERIVED from the tables in `~/shared/providers`, never restated. A second source of truth for "does this provider take an admin key" drifts from `secretKindsForProvider`.
- A provider with no `fetchModels` is not unsupported: Ollama and LM Studio are discovered by reachability probe, whose "empty vs unreachable" distinction lives in `fetchProviderModels`.

## Secret slots are per profile, per provider, per KIND

`SecretKind` is `"api" | "provisioning" | "secret"`; `secretKindsForProvider` derives the slots. `provisioning` exists only where `PROVIDER_SUPPORTS_PROVISIONING_KEY` is true (OpenAI Admin API key, OpenRouter provisioning key) — that table drives the settings field, profile-delete cleanup, AND the disconnect warning, so flipping it is what adds a provider. `secret` exists only for Bedrock (access key ID lands in `api`, secret access key in `secret`); Bedrock's region is NOT a secret — it lives in `providerEndpoints.bedrock.host` and is sanitized by `shared/bedrockEndpoint.ts` (`us-east-1` default, port unused).

Every accessor in `provisioningKeyStore` and all three IPC channels take an explicit `ProviderId` — never defaulted. A missed argument silently reads or writes ANOTHER provider's key.

## Provider-scoped storage ≠ a provider-correct value

A key pasted into the wrong slot used to store fine and show "Key set" (existence is all `hasProfileSecret` can see without decrypting), then 401 forever. `shared/providerKeyShapes.ts` classifies a key by prefix and `findKeyShapeMismatch(provider, kind, raw)` refuses a positively-identified foreign one at BOTH the `connect-provider` handler and `setProfileSecret` (the chokepoint a future writer cannot skip). Slot-level, not provider-level: OpenAI's admin endpoints reject a project key and its chat endpoints reject an admin key, so both wrong-slot-same-account cases are refused too.

An **unrecognized** format is still accepted on purpose — refusing it would lock out legacy `sk-…` keys, LM Studio's arbitrary local key, and any future format.

Each admin-key field carries a "where to get this key" link to the provider's own console; label/placeholder/link keys sit together in `ADMIN_KEY_MESSAGE_KEYS` (`renderer/components/providerCards.ts`) and open via `openExternalLink`. Main only permits http/https, so a mistyped scheme makes the link a silent no-op — `providerCards.test.ts` asserts against it.

## Credential REQUESTS are logged, keys never are

Every admin request (`provider.openai.admin`, `provider.openrouter.admin`) and model-list fetch (`provider.models`) logs the key's *shape label*, plus `storedKeyBelongsToAnother{Provider,Slot}` when a pre-guard key is still on disk. That flag is the whole diagnosis for an otherwise opaque `Unauthorized`.

Log the shape, never the value, and keep labels free of an `sk-…` prefix: `redactLogMessage` would rewrite them to `[REDACTED]`.

**A provider 401 body quotes the submitted key back partially starred** (`Incorrect API key provided: sk-abc12*********wxyz`), and the `sk-…` pattern alone CANNOT catch that — the star run interrupts it one character before its 6-char minimum, so a short visible prefix used to reach the persisted JSONL. `redactLogMessage` now strips the whole masked token first (`MASKED_SECRET_RUN`), and `logModelFetch` additionally splits the exact key out of provider error text, because a key with no recognizable prefix (LM Studio's) matches no pattern at all.

## Cost honesty per provider

`ai.request/cost.ts` prices a request by matching the served model id against the cached OpenRouter price map (exact, then fuse.js under `FUZZY_SCORE_THRESHOLD`). Rules that must not be "improved" into a fabricated number:

- `openai` short-circuits to **N/A** — direct OpenAI discovery ships no pricing, and fuzzy-matching its bare ids against the OpenRouter catalogue would invent prices.
- `ollama` / `lmstudio` / any `isLocal` → status `zero`, renders `$0.00`, never N/A.
- Everything else (OpenRouter, Bedrock) is estimated only on a confident match; no match, unpriced, or parse failure → N/A, never `$0`.
