---
name: fixlang-provider
description: "Step-by-step guide to adding or changing an AI provider, plus the credential/cost invariants that outlive the recipe. Use when adding a provider, touching API/admin key storage, the capability registry, model discovery, credential logging, or per-provider cost rules. Examples: \"add a provider\", \"why is this admin key 401ing\", \"store an extra secret for a provider\", \"is this log line leaking a key\", \"why does this model show N/A cost\". Covers src/main/llm/providers/, src/features/providers/shared/providers.ts, providerKeyShapes.ts, store/profileSecretStore.ts, src/main/ai.request/{shared,cost}.ts."
---

# FixLang — Providers

Providers: `openai`, `openrouter`, `anthropic`, `bedrock`, `ollama`, `lmstudio`.

Read part 1 to add or change a provider; part 2 is why the code is shaped that way. Model ref plumbing (`<providerId>::<rawId>`) lives in [Model refs](../fixlang-model-refs/SKILL.md).

## Part 1 — Add a provider

Nine steps. The compiler catches steps 1–5 (every table is an exhaustive `Record<ProviderId, …>`); nothing catches 6–8. Order matters only in that step 1 makes the rest type-check.

### Step 1 — Declare the id

`src/features/providers/shared/providers.ts`, six edits in one file:

| Table | What to add |
|---|---|
| `PROVIDER_IDS` | the id |
| `PROVIDER_ORDER` | the id, **position is a billing decision** — see below |
| `PROVIDER_LOG_LABELS` | diagnostics-only English name (user-facing names come from i18n) |
| `PROVIDER_REQUIRES_API_KEY` | true unless the provider can connect without a key |
| `PROVIDER_SUPPORTS_API_KEY` | true if a key can be stored at all — a superset of the row above, and the gap between them is exactly LM Studio's optional local key (`requires: false`, `supports: true`) |
| `PROVIDER_SUPPORTS_PROVISIONING_KEY` | true ONLY if you are also shipping a Usage sub-tab that reads it |

`PROVIDER_ORDER` is `resolveModelRef`'s precedence for BARE (un-prefixed) ids. Placing a new provider ABOVE an existing one hands it every legacy ref both can serve — a different key, a different bill, no error. `anthropic` sits below `openrouter` for exactly that reason. Default to appending below any provider whose catalogue overlaps yours.

Do NOT set `PROVIDER_SUPPORTS_PROVISIONING_KEY` "for later": that table drives the settings field, profile-delete cleanup, and the disconnect warning, so a true with no reader is a credential stored for nothing.

`secretKindsForProvider` (`store/profileSecretStore.ts`) derives the secret slots from those two key tables — it needs no edit unless the provider stores a SECOND secret (Bedrock's `secret` slot is the only case).

### Step 2 — Refuse foreign keys

`src/features/providers/shared/providerKeyShapes.ts`, if the key has a recognizable prefix:

1. Add the shape to `ProviderKeyShape` and a prefix row to `SHAPE_PREFIXES` (match order matters — a longer prefix that shares a stem must be tested first, as `sk-or-` is before any bare `sk-`).
2. Add `"<id>:api"` to `EXPECTED_PREFIX`.
3. Add `"<id>:api"` to `FOREIGN_SHAPES` listing every OTHER shape, **and add your new shape to the other providers' lists**. A one-way entry only refuses the paste in one direction.

One shape per provider is usually enough even when the provider mints several kinds: `sk-ant-` covers both `sk-ant-api…` and `sk-ant-admin…`, because FixLang stores only the request key and an admin key is equally foreign everywhere else.

Skip this step entirely for a provider whose key has no stable prefix — an unrecognized format is accepted on purpose.

### Step 3 — Write the provider folder

`src/main/llm/providers/<id>/` with `models.ts` and `request.ts`. Copy `bedrock/` for a key-based cloud provider; copy `lmstudio/` for a local one.

`models.ts` — returns `Model[]`:
- Tag every entry `provider: "<id>"`. An untagged entry formats as an `openrouter::` ref.
- `created` is epoch **seconds** for cloud providers (Ollama alone reports ms, and `normalizeModelTimestamp` sorts that out). An ISO timestamp must be converted, not passed through.
- Ship NO `pricing` unless the provider's own API returns per-token prices. Inventing them makes `buildPriceMap` bill from fabricated numbers.
- Throw on a non-OK response. Provider setup runs this `strict`, so a swallowed 401 lets a revoked key connect with zero models and fail at request time instead.
- Bound the request: a 5s timeout matches the other providers, because the Connect button blocks on this call.

`request.ts` — returns the `AIRequestResponse` shape:
- Read the key with `getProfileSecret(profileId, "<id>", "api")`; missing key → `notifyRequestError` then throw.
- Use `toConversation(messages)` — AI SDK v7 rejects `system`-role entries inside `messages`.
- `usageCounts` / `sumTokenField` normalize token counts across SDK versions; `extractResolvedModel(body, modelId)` records what the provider actually served.
- The Messages/Chat APIs that have no `n` issue N separate calls (`Promise.all`), as Bedrock and Anthropic do.
- Forward `reasoning` via `reasoningForAiSdk` and let the provider package map it. Hand-translating effort into a provider-specific thinking budget breaks the moment the provider retires that parameter on a new model.

**Transport constraint that only fails in a packaged build:** `app.asar` ships no `node_modules`, so a dependency Vite cannot inline dies with `MODULE_NOT_FOUND` in the DMG while passing `dev`, `test`, and `lint`. Several official SDKs resolve `undici` through a runtime `createRequire`. Prefer `keepAliveFetch` for plain REST (that is why Anthropic's model list is a raw `GET /v1/models`), and run `bun run check:bundle` after a real `bun run build` before trusting any new SDK. See [Bundle externals](../fixlang-bundle-externals/SKILL.md).

### Step 4 — Register the capabilities

`src/main/llm/providers/index.ts`:

- Add the id to `PROVIDER_SUPPORTS_USAGE` (a genuinely new fact — not derivable from the key tables; LM Studio takes a key yet bills nothing).
- Add one `capabilities("<id>", { fetchModels, makeRequest })` entry. Both slots must resolve their module through a **lazy `import()`**: `~/main/llm` is imported for the Ollama client alone, and eager loading drags every provider SDK, notifications, and `electron-store` in with it.

Omit `fetchModels` only for a provider discovered by reachability probe (Ollama, LM Studio) — that "empty vs unreachable" distinction lives in `fetchProviderModels` and this signature cannot express it.

`ai.request/shared.ts` dispatches THROUGH this registry, so `makeAIRequest` needs no branch.

### Step 5 — Name it in the UI

- `src/main/ai.request/shared.ts` → `PROVIDER_NAME_KEYS`
- `src/renderer/components/modelSelectOptions.ts` → `PROVIDER_LABEL_KEYS`
- `src/features/i18n/shared/locales/{en,ja}/models.json` → `models.select.provider.<id>` (keys stay alphabetically sorted; `i18n:check` audits it)
- `src/features/i18n/shared/catalogIntegrity.ts` → add the brand name to `VERBATIM_ALLOWED_WORDS` when the JA value is identical to the EN one, or the integrity test reports it as untranslated

### Step 6 — Decide the cost rule

`src/main/ai.request/cost.ts`. Pick one and state why in a comment:

- Provider's discovery ships per-token prices → nothing to do, the price map handles it.
- Local → add to the `zero` short-circuit.
- Cloud with NO prices in its model list → short-circuit to **N/A**. Do not let the fuzzy matcher price it against the OpenRouter catalogue; see the measured failure in part 2.

### Step 7 — Prewarm (optional)

`src/main/llm/prewarm.ts`, `WARM_BY_PROVIDER`. Worth it for a cloud provider reachable with a cheap, non-billable, small-bodied GET. Match the provider's real auth (Anthropic needs `x-api-key` plus a pinned `anthropic-version`; a bearer token 401s and warms nothing) and drain the body, or the socket is held rather than handed over. Skip it for local providers and for SDK-signed transports like Bedrock.

### Step 8 — Only if the provider needs more than one API key

A single-key cloud provider needs **no** edits to `features/providers/main/api.ts` or `renderer/components/SettingGeneral.tsx`: the generic `else` branch of `connect-provider` and the generic API-key card already cover it. Touch them only for a second secret or an endpoint field, and follow the `bedrock` branches when you do (`readProviderStates`, `get-provider-secret-status`, `fetch-provider-models`, `connect-provider`, `providerCards.ts`'s `canConnect`, plus the endpoint sanitizer in `apiStore.ts`).

### Step 9 — Verify

```bash
bun run test && bun run lint && bun run i18n:check
bun run build && bun run check:bundle
```

Adding an id breaks a predictable set of fixtures. All of them are assertions about the provider LIST, not about your provider:

| File | What to update |
|---|---|
| `shared/providers.test.ts` | the explicit id list, the `groupModelsByProvider` groups, the `sanitizeEnabledProviders` input |
| `main/providerChannels.test.ts` | `get-provider-states` sorted keys, the full expected state object, the model-count `numbers` array |
| `renderer/components/modelSelectOptions.test.ts` | expected group order and labels |
| `i18n/shared/catalogIntegrity.test.ts` | passes once step 5's exemption is in |

Watch also for tests that used your new id as their **unknown-provider sentinel** (`api.test.ts`, `connectProvider.test.ts`, `preload/api.test.ts`, `modelRef.test.ts` all did). Re-point them at a string that can never become a provider, e.g. `"not-a-provider"` — do not delete the assertion.

Finally: connect a real key and run one transform, one Ask. Confirm the model list populates, history records token counts, and the cost column shows what step 6 decided.

## Part 2 — Invariants

### The capability registry is the only dispatch table

Each provider owns a folder plus ONE entry in `providers/index.ts` (`supportsAdminKey`, `supportsUsage`, `fetchModels?`, `makeRequest?`). Credential facts are DERIVED from the tables in `~/features/providers/shared/providers`, never restated: a second source of truth for "does this provider take an admin key" drifts from `secretKindsForProvider`.

### Secret slots are per profile, per provider, per KIND

`SecretKind` is `"api" | "provisioning" | "secret"`. `provisioning` exists only where `PROVIDER_SUPPORTS_PROVISIONING_KEY` is true (OpenAI Admin API key, OpenRouter provisioning key). `secret` exists only for Bedrock (access key ID lands in `api`, secret access key in `secret`); Bedrock's region is NOT a secret — it lives in `providerEndpoints.bedrock.host`, sanitized by `shared/bedrockEndpoint.ts` (`us-east-1` default, port unused).

Every accessor in `provisioningKeyStore` and all three IPC channels take an explicit `ProviderId` — never defaulted. A missed argument silently reads or writes ANOTHER provider's key.

### Provider-scoped storage ≠ a provider-correct value

A key pasted into the wrong slot used to store fine and show "Key set" (existence is all `hasProfileSecret` can see without decrypting), then 401 forever. `findKeyShapeMismatch(provider, kind, raw)` refuses a positively-identified foreign key at BOTH the `connect-provider` handler and `setProfileSecret` (the chokepoint a future writer cannot skip). Slot-level, not provider-level: OpenAI's admin endpoints reject a project key and its chat endpoints reject an admin key, so both wrong-slot-same-account cases are refused too.

An **unrecognized** format is still accepted on purpose — refusing it would lock out legacy `sk-…` keys, LM Studio's arbitrary local key, and any future format.

Each admin-key field carries a "where to get this key" link to the provider's own console; label/placeholder/link keys sit together in `ADMIN_KEY_MESSAGE_KEYS` (`renderer/components/providerCards.ts`) and open via `openExternalLink`. Main only permits http/https, so a mistyped scheme makes the link a silent no-op — `providerCards.test.ts` asserts against it.

### Credential REQUESTS are logged, keys never are

Every admin request (`provider.openai.admin`, `provider.openrouter.admin`) and model-list fetch (`provider.models`) logs the key's *shape label*, plus `storedKeyBelongsToAnother{Provider,Slot}` when a pre-guard key is still on disk. That flag is the whole diagnosis for an otherwise opaque `Unauthorized`.

Log the shape, never the value, and keep labels free of an `sk-…` prefix: `redactLogMessage` would rewrite them to `[REDACTED]`.

**A provider 401 body quotes the submitted key back partially starred** (`Incorrect API key provided: sk-abc12*********wxyz`), and the `sk-…` pattern alone CANNOT catch that — the star run interrupts it one character before its 6-char minimum, so a short visible prefix used to reach the persisted JSONL. `redactLogMessage` now strips the whole masked token first (`MASKED_SECRET_RUN`), and `logModelFetch` additionally splits the exact key out of provider error text, because a key with no recognizable prefix (LM Studio's) matches no pattern at all.

### Cost honesty per provider

`ai.request/cost.ts` prices a request by matching the served model id against the cached OpenRouter price map (exact, then fuse.js under `FUZZY_SCORE_THRESHOLD`). Rules that must not be "improved" into a fabricated number:

- `openai` short-circuits to **N/A** — direct OpenAI discovery ships no pricing, and fuzzy-matching its bare ids against the OpenRouter catalogue would invent prices.
- `anthropic` short-circuits to **N/A** for the same reason, and here the failure is MEASURED, not theoretical: `claude-opus-4-5` matches `anthropic/claude-opus-4.1` under `FUZZY_SCORE_THRESHOLD` and bills at 3x the real rate with `status: "ok"`. Versioned Anthropic ids differ from OpenRouter's by one character, so the matcher lands on a neighbouring version rather than failing.
- `ollama` / `lmstudio` / any `isLocal` → status `zero`, renders `$0.00`, never N/A.
- Everything else (OpenRouter, Bedrock) is estimated only on a confident match; no match, unpriced, or parse failure → N/A, never `$0`.
