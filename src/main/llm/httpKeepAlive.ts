/**
 * @file httpKeepAlive.ts
 * @description Long-lived keep-alive HTTP dispatcher shared by every cloud
 * provider request (OpenAI, OpenRouter) and by the connection prewarmer
 * (`./prewarm`).
 *
 * Node's global `fetch` is backed by undici, which already pools connections
 * per origin — but its default agent's keep-alive window is only a few
 * seconds, long enough to survive one multi-turn conversation, too short to
 * survive the gap between two hotkey presses. A dedicated `undici.Agent` with
 * a multi-minute `keepAliveTimeout` keeps the socket to api.openai.com /
 * openrouter.ai alive across that gap, so a hotkey pressed minutes after the
 * last one can reuse an already-warm connection instead of paying
 * DNS + TCP + TLS again.
 *
 * One agent for both cloud providers: they are different origins, and
 * undici's `Agent` pools per-origin internally, so sharing an instance never
 * mixes their sockets.
 *
 * `dispatcher` is a non-standard `RequestInit` extension undici adds to
 * Node's global `fetch` (confirmed against the installed `undici` version's
 * `types/fetch.d.ts`, and against a live request through this exact repo's
 * Node runtime) — `lib.dom`'s `RequestInit` type doesn't know about it, hence
 * the local extension below instead of widening to `unknown`.
 */
import { Agent } from "undici";
import type { Dispatcher } from "undici";

/** Long enough that back-to-back hotkey presses minutes apart reuse a socket. */
const KEEP_ALIVE_TIMEOUT_MS = 5 * 60 * 1000;

/** Upper bound undici enforces regardless of what a server's response asks for. */
const KEEP_ALIVE_MAX_TIMEOUT_MS = 10 * 60 * 1000;

const keepAliveAgent: Dispatcher = new Agent({
  keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
  keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
});

type RequestInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

/**
 * Drop-in replacement for `globalThis.fetch`, bound to {@link keepAliveAgent}.
 * Pass this as the `fetch` option to `createOpenAI` / `createOpenRouter` so
 * every AI SDK request — and the prewarm probe in `./prewarm` — shares the
 * same pooled, long-lived sockets. Scoped deliberately: only callers that pass
 * this function opt into the keep-alive agent, so unrelated fetch traffic
 * (Homebrew/GitHub update checks, etc.) is unaffected.
 */
export const keepAliveFetch: typeof fetch = (input, init) =>
  fetch(input, { ...(init ?? {}), dispatcher: keepAliveAgent } as RequestInitWithDispatcher);
