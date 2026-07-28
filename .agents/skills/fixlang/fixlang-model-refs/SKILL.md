---
name: fixlang-model-refs
description: "Use when touching stored model ids, provider routing, cost lookup, cache strategy, or SQLite history rows. Covers the composite `<providerId>::<rawModelId>` ref and where the prefix must be stripped. Examples: \"prompt caching stopped working\", \"model priced wrong\", \"request went to the wrong provider\"."
---

# FixLang — Composite Model Ref Gotcha

Code: `src/shared/modelRef.ts` (parse/format/resolve), `src/shared/providers.ts` (provider identity).

## Two id shapes. Know which one you hold

- **Composite ref** — `<providerId>::<rawModelId>`, e.g. `openrouter::google/gemma-2-9b-it`. Lives in **config only**: `selectedModel`, preset `model`, feature models.
- **Raw id** — what the provider's API expects, e.g. `google/gemma-2-9b-it`. Goes to **SQLite history** (`model`, `resolved_model`) and **downstream API calls**.

Separator is `::`, split on the **first** occurrence. Safe against Ollama tags (`llama3.2:3b`) and OpenRouter paths (`openai/gpt-4o`).

## Prefix leak into a `startsWith` check = silent wrong answer

No error. No log. Just a wrong result. This bit twice:

- **`cache-strategy.ts`** — a ref reaching `startsWith("anthropic/")` matches nothing, falls to `UNSUPPORTED`, prompt caching stops. Bill goes up quietly.
- **`cost.ts`** — a ref misses the exact price lookup, drops into fuzzy matching. Fuzzy does not fail — it **mis-prices**, confidently, with `status: "ok"`.

Call `stripModelRefPrefix` first. No-op on a bare id, single-pass by design — safe to apply unconditionally, must not be looped.

**Ids carrying a family word survive by luck.** `openrouter::anthropic/claude-3.5-sonnet` still resolves, because `includes("claude")` rescues it. Only ids classified *solely* by a `startsWith` arm break: `google/gemma-*`, `openai/o*`, non-Claude Anthropic ids. So a test written against a Claude id passes against broken code — write the test against a Gemma or o-series id.

## Never infer provider from a raw id

`resolveModelRef` on a **prefixed** ref checks that provider and stops. It does not scan others. Widening it routes `ollama::gpt-4o` to OpenAI and bills the OpenAI key.

A **bare** id scans `PROVIDER_ORDER` and takes the first hit — that is a migration tolerance, not a feature. `PROVIDER_ORDER` is therefore resolution precedence as well as display order; reordering it reroutes un-migrated refs.

## Provider dispatch goes through the registry, not a branch

`makeAIRequest` resolves the ref, then calls `providerCapabilities(provider).makeRequest` — the per-provider implementations live in `src/main/llm/providers/<id>/request.ts`. Adding a provider means a folder plus a registry entry; adding another `if (provider === …)` in `ai.request/shared.ts` is the thing this replaced.

Two edges hold that shape up, and both are load-bearing:

- **Nothing under `providers/` may import `ai.request/shared.ts`.** `shared.ts` imports the registry, so the reverse edge is a runtime import cycle in the CommonJS main bundle. Request/response types therefore come from `ai.request/requestTypes.ts`.
- **The registry's `fetchModels`/`makeRequest` slots resolve their module through a lazy `import()`.** `~/main/llm` re-exports the registry and is imported for the Ollama client alone; making those slots eager drags the OpenAI/OpenRouter SDKs, notifications, and `electron-store` in with it — which breaks unit tests that only wanted the registry. A test mocking the Ollama client must mock `~/main/llm/providers/ollama/client`, not the `~/main/llm` barrel.

`ollama`/`lmstudio` have **no** `fetchModels` slot on purpose: they are discovered by reachability probe, and that probe's "empty vs unreachable" distinction (which decides whether `[]` may overwrite the cached slice) cannot survive an `(apiKey) => Model[]` signature. It stays in `fetchProviderModels`.

## Checklist

- [ ] Pattern-matching a model id? `stripModelRefPrefix` first
- [ ] Writing SQLite or calling a provider API? Raw id, never the ref
- [ ] New provider behaviour? Registry entry under `providers/<id>/`, not a branch in `shared.ts`
- [ ] Storing to config? Canonical ref from `resolveModelRef`, never the caller's input
- [ ] Test uses an id with no rescuing family word (`gemma`, `o3-mini`), not a Claude id
